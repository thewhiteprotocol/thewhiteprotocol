/**
 * E2E Test 1: Deposit wSOL
 * 
 * Wraps SOL → wSOL, then deposits into the shielded pool.
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, createSyncNativeInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { initializeSDK } from '../sdk/src';

// Deployment config - NEW PROGRAM
const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
const PENDING_DEPOSITS = new PublicKey('7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw');
const MERKLE_TREE = new PublicKey('2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD');

// Test amount: 0.1 SOL
const TEST_AMOUNT = 0.1 * LAMPORTS_PER_SOL;

function randomField(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let bn = 0n;
  for (let i = 0; i < 31; i++) {
    bn = (bn << 8n) | BigInt(bytes[i]);
  }
  return bn;
}

function bigintToBytes32(bn: bigint): number[] {
  const hex = bn.toString(16).padStart(64, '0');
  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  E2E TEST 1: Deposit wSOL');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let passed = false;
  let txSignature = '';
  
  try {
    // Initialize SDK
    await initializeSDK();
    console.log('✅ SDK initialized');
    
    const connection = new Connection(RPC, 'confirmed');
    const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
    const authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
    );
    
    console.log('👤 Depositor:', authority.publicKey.toString());
    const balance = await connection.getBalance(authority.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    
    if (balance < TEST_AMOUNT + 0.01 * LAMPORTS_PER_SOL) {
      throw new Error(`Insufficient balance. Need ${TEST_AMOUNT / LAMPORTS_PER_SOL} SOL + fees`);
    }
    
    // Generate note secrets
    const secret = randomField();
    const nullifier = randomField();
    const amount = BigInt(TEST_AMOUNT);
    
    // Compute asset ID for wSOL using SDK
    const { deriveAssetId } = await import('../sdk/src/crypto/keccak');
    const assetIdBytes = deriveAssetId(NATIVE_MINT);
    const assetIdBigInt = BigInt('0x' + Buffer.from(assetIdBytes).toString('hex'));
    
    console.log('\n📝 Note Details:');
    console.log('   Secret:', secret.toString());
    console.log('   Nullifier:', nullifier.toString());
    console.log('   Amount:', amount.toString(), 'lamports (0.1 SOL)');
    console.log('   Asset ID:', assetIdBigInt.toString());
    
    // Compute commitment using SDK
    const { hashFour } = await import('../sdk/src/crypto/poseidon');
    const commitment = hashFour(secret, nullifier, amount, assetIdBigInt);
    console.log('   Commitment:', commitment.toString());
    
    // Create depositor's wSOL account
    console.log('\n💱 Setting up wSOL account...');
    const depositorWSOL = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
    
    const ataInfo = await connection.getAccountInfo(depositorWSOL);
    if (!ataInfo) {
      console.log('   Creating wSOL ATA...');
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          depositorWSOL,
          authority.publicKey,
          NATIVE_MINT
        )
      );
      await sendAndConfirmTransaction(connection, createAtaTx, [authority]);
    }
    
    // Transfer SOL to wSOL account
    console.log('   Wrapping SOL...');
    const wrapTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: depositorWSOL,
        lamports: TEST_AMOUNT,
      }),
      createSyncNativeInstruction(depositorWSOL)
    );
    await sendAndConfirmTransaction(connection, wrapTx, [authority]);
    console.log('   ✓ wSOL Account ready:', depositorWSOL.toString());
    
    // Setup Anchor
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), { commitment: 'confirmed' });
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf8'));
    const program = new anchor.Program(idl as any, provider);
    
    // Derive all PDAs for new deployment
    const commitmentBytes = bigintToBytes32(commitment);

    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes],
      PROGRAM_ID
    );
    const [relayerRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from('relayer_registry'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    const [complianceConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('compliance'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    const [depositVk] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_deposit'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    const [commitmentIndex] = PublicKey.findProgramAddressSync(
      [Buffer.from('commitment'), POOL_CONFIG.toBuffer(), Buffer.from(commitmentBytes)],
      PROGRAM_ID
    );
    // Get the vault token account from the asset vault account data
    const assetVaultData = await program.account.assetVault.fetch(assetVault);
    const vaultTokenAccount = assetVaultData.tokenAccount;
    
    console.log('\n📋 PDAs:');
    console.log('   Pool Config:', POOL_CONFIG.toString());
    console.log('   Merkle Tree:', MERKLE_TREE.toString());
    console.log('   Pending Buffer:', PENDING_DEPOSITS.toString());
    console.log('   Asset Vault:', assetVault.toString());
    console.log('   Vault Token:', vaultTokenAccount.toString());
    console.log('   Deposit VK:', depositVk.toString());
    
    // Try to generate real proof
    let proofData: Buffer;
    try {
      const { Prover } = await import('../sdk/src/proof/prover');
      const prover = new Prover();
      const result = await prover.generateDepositProof({
        secret,
        nullifier,
        amount,
        assetId: assetIdBigInt,
        commitment
      });
      proofData = Buffer.from(result.proofData);
      console.log('\n🔐 Real proof generated:', proofData.length, 'bytes');
    } catch (e) {
      console.log('\n⚠️ Using dummy proof (circuits not available)');
      proofData = Buffer.alloc(256, 0);
    }
    
    // Execute deposit
    console.log('\n🚀 Submitting deposit transaction...');
    
    const tx = await (program.methods as any)
      .depositMasp(
        new anchor.BN(TEST_AMOUNT),
        commitmentBytes,
        Array.from(assetIdBytes),
        proofData,
        null  // encrypted_note
      )
      .accountsStrict({
        depositor: authority.publicKey,
        poolConfig: POOL_CONFIG,
        authority: authority.publicKey,
        merkleTree: MERKLE_TREE,
        pendingBuffer: PENDING_DEPOSITS,
        assetVault: assetVault,
        userTokenAccount: depositorWSOL,
        vaultTokenAccount: vaultTokenAccount,
        depositVk: depositVk,
        commitmentIndex: commitmentIndex,
        mint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    txSignature = tx;
    console.log('\n✅ Deposit successful!');
    console.log('   Tx:', txSignature);
    console.log('   Explorer:', `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);
    
    // Verify pending deposits
    console.log('\n🔍 Verifying pending deposits...');
    const pendingAccount = await program.account.pendingDeposits.fetch(PENDING_DEPOSITS);
    console.log('   Total commitments:', pendingAccount.commitments.length);
    
    // Check if our commitment is in the list
    const commitmentHex = commitment.toString(16).padStart(64, '0');
    const found = pendingAccount.commitments.some((c: any) => {
      const cHex = Buffer.from(c).toString('hex');
      return cHex === commitmentHex;
    });
    
    if (found) {
      console.log('   ✅ Commitment found in pending buffer!');
    } else {
      console.log('   ⚠️ Commitment not yet in pending buffer');
    }
    
    // Save note
    const note = {
      secret: secret.toString(),
      nullifier: nullifier.toString(),
      amount: amount.toString(),
      assetId: assetIdBigInt.toString(),
      commitment: commitment.toString(),
      mint: NATIVE_MINT.toString(),
      createdAt: new Date().toISOString(),
      settled: false,
      leafIndex: null,
      txSignature: txSignature,
      pending: true
    };
    
    const noteFile = path.join(__dirname, 'e2e-deposit-note.json');
    fs.writeFileSync(noteFile, JSON.stringify(note, null, 2));
    console.log('\n📝 Note saved to:', noteFile);
    
    passed = true;
    
  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.logs) {
      console.error('Program logs:', error.logs.slice(-10));
    }
    passed = false;
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  RESULT: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  process.exit(passed ? 0 : 1);
}

main().catch(console.error);
