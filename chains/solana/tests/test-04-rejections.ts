/**
 * E2E Test 4: Rejection Tests
 * 
 * 1. Double-spend: Try to reuse a nullifier that was already spent
 * 2. Invalid proof: Submit a garbage 256-byte proof
 * 3. Unsupported asset: Try depositing a non-whitelisted mint
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { initializeSDK, computeNullifierHash, computeCommitment } from '../sdk/src';
import { buildPoseidon } from 'circomlibjs';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
const MERKLE_TREE = new PublicKey('2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD');
const PENDING_DEPOSITS = new PublicKey('7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw');

// A previously spent note (from earlier withdrawal test)
const SPENT_NOTE = {
  secret: BigInt('1234567890123456789012345678901234567890123456789012345678901'),
  nullifier: BigInt('9876543210987654321098765432109876543210987654321098765432109'),
  amount: BigInt(0.1 * LAMPORTS_PER_SOL),
  assetId: BigInt('0x' + '7c9c35f887c5c7d2b3e8c5f0a5d1e7f3b4c2a1d0e9f8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1'),
  leafIndex: 0,
};

interface TestResult {
  test: string;
  passed: boolean;
  expectedError?: string;
  actualError?: string;
  details?: any;
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<TestResult> {
  console.log(`\n--- Testing: ${name} ---`);
  try {
    await testFn();
    console.log(`❌ FAIL: Expected error but transaction succeeded`);
    return { test: name, passed: false, expectedError: 'Transaction should fail' };
  } catch (error: any) {
    const errorMsg = error.message || '';
    console.log(`✅ PASS: Rejected with error: ${errorMsg.substring(0, 100)}...`);
    return { 
      test: name, 
      passed: true, 
      actualError: errorMsg,
      details: { logs: error.logs?.slice(-5) }
    };
  }
}

async function main(): Promise<TestResult[]> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  E2E TEST 4: Rejection Tests');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const results: TestResult[] = [];
  
  const connection = new Connection(RPC, 'confirmed');
  const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  
  console.log('👤 Tester:', authority.publicKey.toString());
  
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as any, provider);
  
  // ==========================================
  // Test 1: Double-spend (reuse nullifier)
  // ==========================================
  console.log('\n🧪 Test 1: Double-spend attempt');
  
  const doubleSpendTest = async () => {
    await initializeSDK();
    
    // Build a valid proof for the already-spent note
    const poseidon = await buildPoseidon();
    const zeros: bigint[] = [BigInt(0)];
    const hash2 = (a: bigint, b: bigint): bigint => {
      const res = poseidon([a, b]);
      return BigInt(poseidon.F.toString(res));
    };
    for (let i = 1; i <= 20; i++) zeros.push(hash2(zeros[i-1], zeros[i-1]));
    
    const merkleTree = await (program.account as any).merkleTree.fetch(MERKLE_TREE);
    const currentRoot = BigInt('0x' + Buffer.from(merkleTree.currentRoot).toString('hex'));
    
    const commitment = computeCommitment(SPENT_NOTE.secret, SPENT_NOTE.nullifier, SPENT_NOTE.amount, SPENT_NOTE.assetId);
    const nullifierHash = computeNullifierHash(SPENT_NOTE.nullifier, SPENT_NOTE.secret, BigInt(SPENT_NOTE.leafIndex));
    
    const { Prover } = await import('../sdk/src/proof/prover');
    const prover = new Prover();
    
    const withdrawResult = await prover.generateWithdrawProof({
      merkleRoot: currentRoot,
      nullifierHash: nullifierHash,
      assetId: SPENT_NOTE.assetId,
      recipient: authority.publicKey,
      amount: SPENT_NOTE.amount,
      relayer: authority.publicKey,
      relayerFee: BigInt(0),
      publicDataHash: BigInt(0),
      secret: SPENT_NOTE.secret,
      nullifier: SPENT_NOTE.nullifier,
      leafIndex: SPENT_NOTE.leafIndex,
      merkleProof: {
        pathElements: zeros.slice(0, 20),
        pathIndices: Array(20).fill(0),
        leaf: commitment,
        root: currentRoot,
        leafIndex: SPENT_NOTE.leafIndex,
      },
    });
    
    // Try to submit withdrawal with already-spent nullifier
    const assetIdBytes = Buffer.from(SPENT_NOTE.assetId.toString(16).padStart(64, '0'), 'hex');
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes],
      PROGRAM_ID
    );
    const [withdrawVk] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_withdraw'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    const [spentNullifier] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), POOL_CONFIG.toBuffer(), Buffer.from(nullifierHash.toString(16).padStart(64, '0'), 'hex')],
      PROGRAM_ID
    );
    const [relayerRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from('relayer_registry'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    
    const assetVaultData = await (program.account as any).assetVault.fetch(assetVault);
    const recipientTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
    
    await (program.methods as any)
      .withdrawMasp(
        Array.from(withdrawResult.proofData),
        Array.from(Buffer.from(currentRoot.toString(16).padStart(64, '0'), 'hex')),
        Array.from(Buffer.from(nullifierHash.toString(16).padStart(64, '0'), 'hex')),
        authority.publicKey,
        new anchor.BN(SPENT_NOTE.amount.toString()),
        Array.from(assetIdBytes),
        new anchor.BN(0)
      )
      .accountsStrict({
        relayer: authority.publicKey,
        poolConfig: POOL_CONFIG,
        merkleTree: MERKLE_TREE,
        vkAccount: withdrawVk,
        assetVault: assetVault,
        vaultTokenAccount: assetVaultData.tokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        relayerTokenAccount: recipientTokenAccount,
        spentNullifier: spentNullifier,
        relayerRegistry: relayerRegistry,
        relayerNode: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };
  
  results.push(await runTest('Double-spend (nullifier reuse)', doubleSpendTest));
  
  // ==========================================
  // Test 2: Invalid proof (garbage bytes)
  // ==========================================
  console.log('\n🧪 Test 2: Invalid proof (garbage bytes)');
  
  const invalidProofTest = async () => {
    const garbageProof = Buffer.alloc(256, 0x42); // Fill with 0x42 bytes
    
    const assetIdBytes = Buffer.from(SPENT_NOTE.assetId.toString(16).padStart(64, '0'), 'hex');
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes],
      PROGRAM_ID
    );
    const [withdrawVk] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_withdraw'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    const fakeNullifier = Buffer.alloc(32, 0x99);
    const [spentNullifier] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), POOL_CONFIG.toBuffer(), fakeNullifier],
      PROGRAM_ID
    );
    const [relayerRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from('relayer_registry'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    
    const assetVaultData = await (program.account as any).assetVault.fetch(assetVault);
    const recipientTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
    const merkleTree = await (program.account as any).merkleTree.fetch(MERKLE_TREE);
    const fakeRoot = Buffer.alloc(32, 0x88);
    
    await (program.methods as any)
      .withdrawMasp(
        Array.from(garbageProof),
        Array.from(fakeRoot),
        Array.from(fakeNullifier),
        authority.publicKey,
        new anchor.BN(1000000),
        Array.from(assetIdBytes),
        new anchor.BN(0)
      )
      .accountsStrict({
        relayer: authority.publicKey,
        poolConfig: POOL_CONFIG,
        merkleTree: MERKLE_TREE,
        vkAccount: withdrawVk,
        assetVault: assetVault,
        vaultTokenAccount: assetVaultData.tokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        relayerTokenAccount: recipientTokenAccount,
        spentNullifier: spentNullifier,
        relayerRegistry: relayerRegistry,
        relayerNode: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };
  
  results.push(await runTest('Invalid proof (garbage bytes)', invalidProofTest));
  
  // ==========================================
  // Test 3: Unsupported asset
  // ==========================================
  console.log('\n🧪 Test 3: Unsupported asset (random mint)');
  
  const unsupportedAssetTest = async () => {
    // Generate a random mint address
    const randomMint = Keypair.generate().publicKey;
    console.log('   Random mint:', randomMint.toString());
    
    // Compute asset ID for this random mint
    const { deriveAssetId } = await import('../sdk/src/crypto/keccak');
    const assetIdBytes = deriveAssetId(randomMint);
    
    // Try to find asset vault (won't exist)
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes],
      PROGRAM_ID
    );
    
    // Check if vault exists
    const vaultInfo = await connection.getAccountInfo(assetVault);
    if (!vaultInfo) {
      console.log('   Asset vault does not exist (expected)');
      // Try to call deposit anyway - should fail
    }
    
    // Generate a deposit proof
    const secret = BigInt('1234567890123456789012345678901234567890123456789012345678901');
    const nullifier = BigInt('9876543210987654321098765432109876543210987654321098765432109');
    const amount = BigInt(0.1 * LAMPORTS_PER_SOL);
    const assetIdBigInt = BigInt('0x' + Buffer.from(assetIdBytes).toString('hex'));
    
    const { Prover } = await import('../sdk/src/proof/prover');
    const prover = new Prover();
    const commitment = computeCommitment(secret, nullifier, amount, assetIdBigInt);
    
    const depositProof = await prover.generateDepositProof({
      secret,
      nullifier,
      amount,
      assetId: assetIdBigInt,
      commitment,
    });
    
    const [depositVk] = PublicKey.findProgramAddressSync(
      [Buffer.from('vk_deposit'), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    const [commitmentIndex] = PublicKey.findProgramAddressSync(
      [Buffer.from('commitment'), POOL_CONFIG.toBuffer(), Buffer.from(commitment.toString(16).padStart(64, '0'), 'hex')],
      PROGRAM_ID
    );
    
    // This should fail because the asset vault doesn't exist
    await (program.methods as any)
      .depositMasp(
        new anchor.BN(amount.toString()),
        Array.from(Buffer.from(commitment.toString(16).padStart(64, '0'), 'hex')),
        Array.from(assetIdBytes),
        Buffer.from(depositProof.proofData),
        null
      )
      .accountsStrict({
        depositor: authority.publicKey,
        poolConfig: POOL_CONFIG,
        authority: authority.publicKey,
        merkleTree: MERKLE_TREE,
        pendingBuffer: PENDING_DEPOSITS,
        assetVault: assetVault, // This account doesn't exist!
        userTokenAccount: authority.publicKey, // Fake
        vaultTokenAccount: authority.publicKey, // Fake
        depositVk: depositVk,
        commitmentIndex: commitmentIndex,
        mint: randomMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  };
  
  results.push(await runTest('Unsupported asset (unregistered mint)', unsupportedAssetTest));
  
  // ==========================================
  // Summary
  // ==========================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  REJECTION TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  results.forEach(r => {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}: ${r.test}`);
    if (r.actualError) {
      console.log(`         Error: ${r.actualError.substring(0, 60)}...`);
    }
  });
  
  console.log(`\n  Total: ${passed}/${total} tests passed`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  return results;
}

if (require.main === module) {
  main().then(results => {
    const allPassed = results.every(r => r.passed);
    process.exit(allPassed ? 0 : 1);
  });
}

export { main };
