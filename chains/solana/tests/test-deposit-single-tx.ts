/**
 * Test: Single-transaction wSOL deposit with pre-instructions
 * 
 * Creates wSOL ATA (if needed), wraps SOL, and deposits in ONE transaction.
 * This verifies the fix for AccountNotInitialized (3012) on user_token_account.
 */
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
const PENDING_DEPOSITS = new PublicKey('7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw');
const MERKLE_TREE = new PublicKey('2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD');

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
  console.log('  TEST: Single-tx wSOL deposit with pre-instructions');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = false;
  let txSignature = '';

  try {
    const connection = new Connection(RPC, 'confirmed');
    const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
    const authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
    );

    console.log('👤 Depositor:', authority.publicKey.toString());
    const balance = await connection.getBalance(authority.publicKey);
    console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');

    if (balance < TEST_AMOUNT + 0.02 * LAMPORTS_PER_SOL) {
      throw new Error(`Insufficient balance. Need ${TEST_AMOUNT / LAMPORTS_PER_SOL} SOL + fees`);
    }

    // Generate note secrets
    const secret = randomField();
    const nullifier = randomField();
    const amount = BigInt(TEST_AMOUNT);

    const { initializeSDK } = await import('../sdk/src');
    await initializeSDK();
    console.log('✅ SDK initialized');

    const { deriveAssetId } = await import('../sdk/src/crypto/keccak');
    const assetIdBytes = deriveAssetId(NATIVE_MINT);
    const assetIdBigInt = BigInt('0x' + Buffer.from(assetIdBytes).toString('hex'));

    const { hashFour } = await import('../sdk/src/crypto/poseidon');
    const commitment = hashFour(secret, nullifier, amount, assetIdBigInt);
    console.log('📝 Commitment:', commitment.toString());

    // Setup Anchor
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), { commitment: 'confirmed' });
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf8'));
    const program = new anchor.Program(idl as any, provider);

    // Derive PDAs
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes],
      PROGRAM_ID
    );
    const [depositVk] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_deposit'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );

    const assetVaultData = await program.account.assetVault.fetch(assetVault);
    const vaultTokenAccount = assetVaultData.tokenAccount;

    const depositor = authority.publicKey;
    const userTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, depositor);

    console.log('🏦 Vault Token Account:', vaultTokenAccount.toString());
    console.log('👛 User Token Account:', userTokenAccount.toString());

    // Check ATA state
    const userAtaInfo = await connection.getAccountInfo(userTokenAccount);
    const ataMissing = !userAtaInfo || !userAtaInfo.owner.equals(TOKEN_PROGRAM_ID);
    console.log('🔍 User ATA exists:', !!userAtaInfo, '| Owner is Token Program:', userAtaInfo?.owner.equals(TOKEN_PROGRAM_ID) || false);

    const preInstructions: any[] = [];

    if (ataMissing) {
      console.log('➕ Adding createATA instruction');
      preInstructions.push(
        createAssociatedTokenAccountInstruction(depositor, userTokenAccount, depositor, NATIVE_MINT)
      );
    }

    // Always wrap SOL
    console.log('💱 Adding wrap instructions (transfer + syncNative)');
    preInstructions.push(
      SystemProgram.transfer({
        fromPubkey: depositor,
        toPubkey: userTokenAccount,
        lamports: TEST_AMOUNT,
      })
    );
    preInstructions.push(createSyncNativeInstruction(userTokenAccount));

    // Generate real deposit proof
    let proofData: Buffer;
    try {
      const { Prover } = await import('../sdk/src/proof/prover');
      const prover = new Prover();
      const result = await prover.generateDepositProof({
        secret,
        nullifier,
        amount,
        assetId: assetIdBigInt,
        commitment,
      });
      proofData = Buffer.from(result.proofData);
      console.log('🔐 Real proof generated:', proofData.length, 'bytes');
    } catch (e) {
      console.error('\n⚠️ Failed to generate real proof:', e);
      throw new Error('Real proof generation failed. Circuits may be missing or incompatible.');
    }

    // Build deposit instruction via Anchor
    const depositIx = await (program.methods as any)
      .depositMasp(
        new anchor.BN(TEST_AMOUNT),
        bigintToBytes32(commitment),
        Array.from(assetIdBytes),
        proofData,
        null
      )
      .accountsStrict({
        depositor,
        poolConfig: POOL_CONFIG,
        authority: assetVaultData.authority || depositor,
        merkleTree: MERKLE_TREE,
        pendingBuffer: PENDING_DEPOSITS,
        assetVault,
        userTokenAccount,
        vaultTokenAccount,
        depositVk,
        mint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // Build and send single transaction
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = depositor;
    preInstructions.forEach((ix) => tx.add(ix));
    tx.add(depositIx);

    console.log('\n📦 Transaction instructions:');
    preInstructions.forEach((_, i) => console.log(`  ix[${i}]: pre-instruction`));
    console.log(`  ix[${preInstructions.length}]: depositMasp`);

    console.log('\n🚀 Sending transaction...');
    txSignature = await sendAndConfirmTransaction(connection, tx, [authority], {
      commitment: 'confirmed',
    });

    console.log('\n✅ Deposit successful!');
    console.log('   Tx:', txSignature);
    console.log('   Explorer:', `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`);

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
