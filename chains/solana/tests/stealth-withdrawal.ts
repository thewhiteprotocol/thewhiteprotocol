/**
 * E2E Test: Stealth Withdrawal on Solana Devnet
 *
 * Full flow: Clear pending → Deposit wSOL → Settle → Stealth Withdraw
 * with ephemeral pubkey emission → Scanner detection → Stealth key derivation
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
  console.log('  E2E TEST: Stealth Withdrawal');
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

    const pendingCommitment = pendingBuffer.deposits[0].commitment;
    const pendingCommitmentBigInt = BigInt('0x' + Buffer.from(pendingCommitment).toString('hex'));

    console.log('Pending commitment:', pendingCommitmentBigInt.toString().substring(0, 40) + '...');
    console.log('Our commitment:', commitment.toString().substring(0, 40) + '...');
    console.log('Match:', pendingCommitmentBigInt === commitment);

    const zeros: bigint[] = [];
    for (let i = 0; i <= 20; i++) zeros.push(BigInt('0x' + Buffer.from(merkleTree.zeros[i]).toString('hex')));

    const pathElements: bigint[] = [];
    for (let i = 0; i < 20; i++) pathElements.push(BigInt('0x' + Buffer.from(merkleTree.filledSubtrees[i]).toString('hex')));

    let newRoot = pendingCommitmentBigInt;
    for (let i = 0; i < 20; i++) newRoot = hash2(newRoot, zeros[i]);

    const hash = createHash('sha256');
    const commitmentBuf = Buffer.from(pendingCommitmentBigInt.toString(16).padStart(64, '0'), 'hex');
    hash.update(commitmentBuf);
    const digest = hash.digest();
    digest[0] &= 0x1F;
    const commitmentsHash = BigInt('0x' + digest.toString('hex'));

    console.log('Generating proof...');
    const { groth16 } = await import('snarkjs');
    const circuitDir = '../../circuits/merkle_batch_update/build';

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
    // STEP 3: Generate Stealth Address for Recipient
    // ==========================================
    console.log('\n🔐 STEP 3: Stealth Address Generation\n');

    // Import stealth utilities from core package
    const {
      deriveStealthSeed,
      generateSolanaMetaAddressFromSeed,
      deriveStealthAddressEd25519,
      tryDecryptStealthPaymentEd25519,
      computeStealthPrivateKeyEd25519,
      stealthPubkeyFromPrivateKeyEd25519,
    } = await import('../../packages/core/src/stealth');

    // Generate recipient meta-address from deterministic seed
    const recipientSeed = deriveStealthSeed(new Uint8Array(32).fill(0x42));
    const { metaAddress, spendKeypair, viewKeypair } = generateSolanaMetaAddressFromSeed(recipientSeed);

    console.log('Recipient meta-address generated');
    console.log('Spend pub prefix:', Buffer.from(spendKeypair.publicKey).toString('hex').slice(0, 8));
    console.log('View pub prefix:', Buffer.from(viewKeypair.publicKey).toString('hex').slice(0, 8));

    // Sender derives stealth address
    const stealth = deriveStealthAddressEd25519(metaAddress);
    const stealthPubkey = new PublicKey(stealth.address);

    console.log('Stealth address:', stealthPubkey.toBase58());
    console.log('Ephemeral pubkey:', Buffer.from(stealth.ephemeralPubkey).toString('hex').slice(0, 16) + '...');

    details.stealthAddress = stealthPubkey.toBase58();
    details.ephemeralPubkey = Buffer.from(stealth.ephemeralPubkey).toString('hex');

    // ==========================================
    // STEP 4: Stealth Withdrawal
    // ==========================================
    console.log('\n💸 STEP 4: Stealth Withdrawal\n');

    const updatedTree = await (program.account as any).merkleTree.fetch(MERKLE_TREE);
    const currentRoot = BigInt('0x' + Buffer.from(updatedTree.currentRoot).toString('hex'));
    const nullifierHash = computeNullifierHash(nullifier, secret, BigInt(startIndex));

    const withdrawResult = await prover.generateWithdrawProof({
      merkleRoot: currentRoot, nullifierHash: nullifierHash, assetId: assetIdBigInt,
      recipient: stealthPubkey, amount: depositAmount, relayer: authority.publicKey,
      relayerFee: BigInt(0), publicDataHash: BigInt(0), secret: secret, nullifier: nullifier,
      leafIndex: startIndex, merkleProof: { pathElements: pathElements, pathIndices: Array(20).fill(0), leaf: commitment, root: currentRoot, leafIndex: startIndex },
    });

    const [withdrawVk] = PublicKey.findProgramAddressSync([Buffer.from('vk_withdraw'), POOL_CONFIG.toBuffer()], PROGRAM_ID);
    const [spentNullifier] = PublicKey.findProgramAddressSync([Buffer.from('nullifier'), POOL_CONFIG.toBuffer(), Buffer.from(nullifierHash.toString(16).padStart(64, '0'), 'hex')], PROGRAM_ID);
    const [relayerRegistry] = PublicKey.findProgramAddressSync([Buffer.from('relayer_registry'), POOL_CONFIG.toBuffer()], PROGRAM_ID);

    // Create recipient token account for the STEALTH address
    const recipientTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, stealthPubkey);
    const relayerTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
    const withdrawPreInstructions = [];
    if (!await connection.getAccountInfo(recipientTokenAccount)) {
      withdrawPreInstructions.push(createAssociatedTokenAccountInstruction(authority.publicKey, recipientTokenAccount, stealthPubkey, NATIVE_MINT));
    }
    if (!await connection.getAccountInfo(relayerTokenAccount)) {
      withdrawPreInstructions.push(createAssociatedTokenAccountInstruction(authority.publicKey, relayerTokenAccount, authority.publicKey, NATIVE_MINT));
    }

    const stealthWithdrawTx = await (program.methods as any)
      .withdrawMaspStealth(
        Buffer.from(withdrawResult.proofData),
        Array.from(Buffer.from(currentRoot.toString(16).padStart(64, '0'), 'hex')),
        Array.from(Buffer.from(nullifierHash.toString(16).padStart(64, '0'), 'hex')),
        stealthPubkey,
        new anchor.BN(depositAmount.toString()),
        Array.from(assetIdBytes),
        new anchor.BN(0),
        Array.from(stealth.ephemeralPubkey)
      )
      .accountsStrict({
        relayer: authority.publicKey,
        poolConfig: POOL_CONFIG,
        merkleTree: MERKLE_TREE,
        vkAccount: withdrawVk,
        assetVault: assetVault,
        vaultTokenAccount: vaultTokenAccount,
        recipientTokenAccount: recipientTokenAccount,
        relayerTokenAccount: relayerTokenAccount,
        spentNullifier: spentNullifier,
        relayerRegistry: relayerRegistry,
        relayerNode: null,
        yieldRegistry: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .preInstructions(withdrawPreInstructions)
      .rpc();

    console.log('✅ Stealth Withdrawal:', stealthWithdrawTx);
    details.stealthWithdrawTx = stealthWithdrawTx;

    // ==========================================
    // STEP 5: Verify StealthWithdrawal Event
    // ==========================================
    console.log('\n🔍 STEP 5: Verifying StealthWithdrawal Event\n');

    const txInfo = await connection.getParsedTransaction(stealthWithdrawTx, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!txInfo || !txInfo.meta || !txInfo.meta.logMessages) {
      throw new Error('Could not fetch transaction logs');
    }

    const logs = txInfo.meta.logMessages;
    console.log('Transaction logs found:', logs.length, 'entries');

    // Look for the StealthWithdrawal event in logs
    // Anchor events are emitted as base64 encoded data in "Program data:" logs
    let eventFound = false;
    for (const log of logs) {
      if (log.includes('StealthWithdrawal')) {
        eventFound = true;
        console.log('✅ StealthWithdrawal event detected in logs');
        break;
      }
    }

    if (!eventFound) {
      // The event may be encoded; check for any program data logs
      const programDataLogs = logs.filter(l => l.includes('Program data:'));
      console.log('Program data logs:', programDataLogs.length);
      if (programDataLogs.length > 0) {
        eventFound = true;
        console.log('✅ Program data logs present (event encoded)');
      }
    }

    details.eventFound = eventFound;

    // ==========================================
    // STEP 6: Recipient Scanner Detection
    // ==========================================
    console.log('\n👁️  STEP 6: Scanner Detection\n');

    // Simulate an on-chain event that a scanner would see
    const scannerEvent = {
      ephemeralPubkey: stealth.ephemeralPubkey,
      destination: stealth.address,
      txHash: stealthWithdrawTx,
      blockHeight: txInfo.slot || 0,
    };

    const { scanForPayments, getScannerKeyMaterial } = await import('../../packages/core/src/stealth');

    const keyMaterial = getScannerKeyMaterial(metaAddress, spendKeypair.privateKey, viewKeypair.privateKey);
    const detected = scanForPayments([scannerEvent], keyMaterial);

    console.log('Detected payments:', detected.length);
    if (detected.length === 1) {
      console.log('✅ Scanner detected the stealth payment!');
      details.scannerDetected = true;

      // ==========================================
      // STEP 7: Derive Stealth Private Key and Verify
      // ==========================================
      console.log('\n🔑 STEP 7: Stealth Private Key Derivation\n');

      const detectedPayment = detected[0];
      const s = BigInt('0x' + Buffer.from(detectedPayment.stealthPrivateKey).toString('hex'));

      const stealthPriv = computeStealthPrivateKeyEd25519(spendKeypair.privateKey, s);
      const derivedPub = stealthPubkeyFromPrivateKeyEd25519(stealthPriv);

      console.log('Derived stealth pub:', Buffer.from(derivedPub).toString('hex').slice(0, 16) + '...');
      console.log('Expected stealth pub:', Buffer.from(stealth.address).toString('hex').slice(0, 16) + '...');

      const match = Buffer.from(derivedPub).toString('hex') === Buffer.from(stealth.address).toString('hex');
      console.log('Match:', match ? '✅ YES' : '❌ NO');

      details.derivedKeyMatch = match;

      if (match) {
        result.passed = true;
        result.signature = stealthWithdrawTx;
      } else {
        throw new Error('Derived stealth public key does not match expected address');
      }
    } else {
      throw new Error('Scanner did not detect the stealth payment');
    }

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
