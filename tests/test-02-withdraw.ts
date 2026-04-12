/**
 * E2E Test 2: Withdraw wSOL
 * 
 * Full flow: Clear pending → Deposit wSOL → Settle → Withdraw
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createSyncNativeInstruction } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { initializeSDK, computeNullifierHash, computeCommitment } from '../sdk/src';
import { buildPoseidon } from 'circomlibjs';
import { createHash } from 'crypto';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
const MERKLE_TREE = new PublicKey('2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD');
const PENDING_DEPOSITS = new PublicKey('7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw');

interface TestResult {
  passed: boolean;
  signature?: string;
  error?: string;
  details?: any;
}

function randomField(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let bn = 0n;
  for (let i = 0; i < 31; i++) bn = (bn << 8n) | BigInt(bytes[i]);
  return bn;
}

async function main(): Promise<TestResult> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  E2E TEST 2: Withdraw wSOL');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const result: TestResult = { passed: false };
  const details: any = {};
  
  try {
    await initializeSDK();
    console.log('✅ SDK initialized\n');
    
    const connection = new Connection(RPC, 'confirmed');
    const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
    const authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
    );
    
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), { commitment: 'confirmed' });
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf8'));
    const program = new anchor.Program(idl as any, provider);
    
    // Reset merkle tree and clear pending buffer
    console.log('Resetting state...');
    try {
      await (program.methods as any).resetMerkleTree().accounts({
        authority: authority.publicKey, poolConfig: POOL_CONFIG, merkleTree: MERKLE_TREE,
      }).rpc();
      console.log('✅ Tree reset');
    } catch (e) { console.log('⚠️  Tree reset skipped'); }
    
    try {
      await (program.methods as any).clearPendingBuffer().accounts({
        authority: authority.publicKey, poolConfig: POOL_CONFIG, pendingBuffer: PENDING_DEPOSITS,
      }).rpc();
      console.log('✅ Pending buffer cleared');
    } catch (e) { console.log('⚠️  Buffer clear skipped'); }
    console.log('');
    
    console.log('👤 User:', authority.publicKey.toString());
    
    // Setup
    const poseidon = await buildPoseidon();
    const hash2 = (a: bigint, b: bigint): bigint => {
      const res = poseidon([a, b]);
      return BigInt(poseidon.F.toString(res));
    };
    
    const { deriveAssetId } = await import('../sdk/src/crypto/keccak');
    const assetIdBytes = deriveAssetId(NATIVE_MINT);
    const assetIdBigInt = BigInt('0x' + Buffer.from(assetIdBytes).toString('hex'));
    
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes], PROGRAM_ID
    );
    const assetVaultData = await (program.account as any).assetVault.fetch(assetVault);
    const vaultTokenAccount = assetVaultData.tokenAccount;
    
    // ==========================================
    // STEP 1: Create Deposit
    // ==========================================
    console.log('\n📥 STEP 1: Creating Deposit\n');
    
    const depositAmount = BigInt(0.1 * LAMPORTS_PER_SOL);
    const secret = randomField();
    const nullifier = randomField();
    const commitment = computeCommitment(secret, nullifier, depositAmount, assetIdBigInt);
    
    console.log('📝 Commitment:', commitment.toString().substring(0, 40) + '...');
    
    const userWSOL = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
    const preInstructions = [];
    if (!await connection.getAccountInfo(userWSOL)) {
      preInstructions.push(createAssociatedTokenAccountInstruction(authority.publicKey, userWSOL, authority.publicKey, NATIVE_MINT));
    }
    preInstructions.push(
      SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: userWSOL, lamports: Number(depositAmount) }),
      createSyncNativeInstruction(userWSOL)
    );
    
    const [depositVk] = PublicKey.findProgramAddressSync([Buffer.from('vk_deposit'), POOL_CONFIG.toBuffer()], PROGRAM_ID);
    const { Prover } = await import('../sdk/src/proof/prover');
    const prover = new Prover();
    const depositProof = await prover.generateDepositProof({ secret, nullifier, amount: depositAmount, assetId: assetIdBigInt, commitment });
    
    const depositTx = await (program.methods as any)
      .depositMasp(new anchor.BN(depositAmount.toString()), Array.from(Buffer.from(commitment.toString(16).padStart(64, '0'), 'hex')), Array.from(assetIdBytes), Buffer.from(depositProof.proofData), null)
      .accountsStrict({ depositor: authority.publicKey, poolConfig: POOL_CONFIG, authority: authority.publicKey, merkleTree: MERKLE_TREE, pendingBuffer: PENDING_DEPOSITS, assetVault: assetVault, userTokenAccount: userWSOL, vaultTokenAccount: vaultTokenAccount, depositVk: depositVk, mint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .preInstructions(preInstructions)
      .rpc();
    
    console.log('✅ Deposit:', depositTx);
    details.depositTx = depositTx;
    await new Promise(r => setTimeout(r, 3000));
    
    // ==========================================
    // STEP 2: Read pending and settle FIRST deposit
    // ==========================================
    console.log('\n📦 STEP 2: Batch Settlement\n');
    
    const merkleTree = await (program.account as any).merkleTree.fetch(MERKLE_TREE);
    const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(PENDING_DEPOSITS);
    
    const oldRoot = BigInt('0x' + Buffer.from(merkleTree.currentRoot).toString('hex'));
    const startIndex = Number(merkleTree.nextLeafIndex);
    
    // Get the FIRST pending deposit (the one we just created, now at index 0)
    const pendingCommitment = pendingBuffer.deposits[0].commitment;
    const pendingCommitmentBigInt = BigInt('0x' + Buffer.from(pendingCommitment).toString('hex'));
    
    console.log('Pending commitment:', pendingCommitmentBigInt.toString().substring(0, 40) + '...');
    console.log('Our commitment:', commitment.toString().substring(0, 40) + '...');
    console.log('Match:', pendingCommitmentBigInt === commitment);
    
    // Use on-chain zeros
    const zeros: bigint[] = [];
    for (let i = 0; i <= 20; i++) zeros.push(BigInt('0x' + Buffer.from(merkleTree.zeros[i]).toString('hex')));
    
    // Build path from filled_subtrees
    const pathElements: bigint[] = [];
    for (let i = 0; i < 20; i++) pathElements.push(BigInt('0x' + Buffer.from(merkleTree.filledSubtrees[i]).toString('hex')));
    
    // Compute new root for index 0
    let newRoot = pendingCommitmentBigInt;
    for (let i = 0; i < 20; i++) newRoot = hash2(newRoot, zeros[i]);
    
    // Compute commitments hash
    const hash = createHash('sha256');
    const commitmentBuf = Buffer.from(pendingCommitmentBigInt.toString(16).padStart(64, '0'), 'hex');
    hash.update(commitmentBuf);
    const digest = hash.digest();
    digest[0] &= 0x1F;
    const commitmentsHash = BigInt('0x' + digest.toString('hex'));
    
    console.log('Generating proof...');
    const { groth16 } = await import('snarkjs');
    const circuitDir = './circuits/build/merkle_batch_update';
    
    const { proof } = await groth16.fullProve({
      oldRoot: oldRoot.toString(), newRoot: newRoot.toString(), startIndex: startIndex,
      batchSize: 1, commitmentsHash: commitmentsHash.toString(),
      commitments: [pendingCommitmentBigInt.toString()],
      pathElements: [pathElements.map(p => p.toString())],
    }, `${circuitDir}/merkle_batch_update_js/merkle_batch_update.wasm`, `${circuitDir}/merkle_batch_update.zkey`);
    
    const proofBytes = Buffer.alloc(256);
    const toHex32 = (v: string) => BigInt(v).toString(16).padStart(64, '0');
    proofBytes.write(toHex32(proof.pi_a[0]), 0, 32, 'hex');
    proofBytes.write(toHex32(proof.pi_a[1]), 32, 32, 'hex');
    proofBytes.write(toHex32(proof.pi_b[0][1]), 64, 32, 'hex');
    proofBytes.write(toHex32(proof.pi_b[0][0]), 96, 32, 'hex');
    proofBytes.write(toHex32(proof.pi_b[1][1]), 128, 32, 'hex');
    proofBytes.write(toHex32(proof.pi_b[1][0]), 160, 32, 'hex');
    proofBytes.write(toHex32(proof.pi_c[0]), 192, 32, 'hex');
    proofBytes.write(toHex32(proof.pi_c[1]), 224, 32, 'hex');
    
    const [vkPda] = PublicKey.findProgramAddressSync([Buffer.from('vk_merkle_batch'), POOL_CONFIG.toBuffer()], PROGRAM_ID);
    
    const settleTx = await (program.methods as any)
      .settleDepositsBatch({ proof: Array.from(proofBytes), newRoot: Array.from(Buffer.from(newRoot.toString(16).padStart(64, '0'), 'hex')), batchSize: 1 })
      .accounts({ authority: authority.publicKey, poolConfig: POOL_CONFIG, merkleTree: MERKLE_TREE, pendingBuffer: PENDING_DEPOSITS, verificationKey: vkPda })
      .rpc();
    
    console.log('✅ Settlement:', settleTx);
    details.settleTx = settleTx;
    await new Promise(r => setTimeout(r, 3000));
    
    // ==========================================
    // STEP 3: Withdraw
    // ==========================================
    console.log('\n💸 STEP 3: Withdrawal\n');
    
    const updatedTree = await (program.account as any).merkleTree.fetch(MERKLE_TREE);
    const currentRoot = BigInt('0x' + Buffer.from(updatedTree.currentRoot).toString('hex'));
    const nullifierHash = computeNullifierHash(nullifier, secret, BigInt(startIndex));
    
    const withdrawResult = await prover.generateWithdrawProof({
      merkleRoot: currentRoot, nullifierHash: nullifierHash, assetId: assetIdBigInt,
      recipient: authority.publicKey, amount: depositAmount, relayer: authority.publicKey,
      relayerFee: BigInt(0), publicDataHash: BigInt(0), secret: secret, nullifier: nullifier,
      leafIndex: startIndex, merkleProof: { pathElements: pathElements, pathIndices: Array(20).fill(0), leaf: commitment, root: currentRoot, leafIndex: startIndex },
    });
    
    const [withdrawVk] = PublicKey.findProgramAddressSync([Buffer.from('vk_withdraw'), POOL_CONFIG.toBuffer()], PROGRAM_ID);
    const [spentNullifier] = PublicKey.findProgramAddressSync([Buffer.from('nullifier'), POOL_CONFIG.toBuffer(), Buffer.from(nullifierHash.toString(16).padStart(64, '0'), 'hex')], PROGRAM_ID);
    const [relayerRegistry] = PublicKey.findProgramAddressSync([Buffer.from('relayer_registry'), POOL_CONFIG.toBuffer()], PROGRAM_ID);
    
    const recipientTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
    const withdrawPreInstructions = [];
    if (!await connection.getAccountInfo(recipientTokenAccount)) {
      withdrawPreInstructions.push(createAssociatedTokenAccountInstruction(authority.publicKey, recipientTokenAccount, authority.publicKey, NATIVE_MINT));
    }
    
    const withdrawTx = await (program.methods as any)
      .withdrawMasp(Buffer.from(withdrawResult.proofData), Array.from(Buffer.from(currentRoot.toString(16).padStart(64, '0'), 'hex')), Array.from(Buffer.from(nullifierHash.toString(16).padStart(64, '0'), 'hex')), authority.publicKey, new anchor.BN(depositAmount.toString()), Array.from(assetIdBytes), new anchor.BN(0))
      .accountsStrict({ relayer: authority.publicKey, poolConfig: POOL_CONFIG, merkleTree: MERKLE_TREE, vkAccount: withdrawVk, assetVault: assetVault, vaultTokenAccount: vaultTokenAccount, recipientTokenAccount: recipientTokenAccount, relayerTokenAccount: recipientTokenAccount, spentNullifier: spentNullifier, relayerRegistry: relayerRegistry, relayerNode: null, yieldRegistry: null, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .preInstructions(withdrawPreInstructions)
      .rpc();
    
    console.log('✅ Withdrawal:', withdrawTx);
    details.withdrawTx = withdrawTx;
    
    result.passed = true;
    result.signature = withdrawTx;
    result.details = details;
    
  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.logs) console.error('Program logs:', error.logs.slice(-10));
    result.error = error.message;
    result.passed = false;
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  RESULT: ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  return result;
}

if (require.main === module) {
  main().then(result => process.exit(result.passed ? 0 : 1));
}

export { main };
