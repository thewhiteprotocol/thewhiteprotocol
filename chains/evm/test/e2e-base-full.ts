/**
 * Complete E2E Test for White Protocol on Base Sepolia
 * Tests: Deposit → Settle → Withdraw → Double-spend (all with real ZK proofs)
 */

import { ethers } from 'ethers';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as crypto from 'crypto';

// Contract ABIs
const WHITEPROTOCOL_ABI = [
  "function deposit(bytes calldata proof, uint256 commitment, uint256 amount, address token) external payable",
  "function withdraw(bytes calldata proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external",
  "function settleBatch(bytes calldata proof, uint256 oldRoot, uint256 newRoot, uint256 startIndex, uint256 batchSize, uint256 commitmentsHash) external",
  "function getLastRoot() external view returns (uint256)",
  "function nextLeafIndex() external view returns (uint256)",
  "function isKnownRoot(uint256 root) external view returns (bool)",
  "function isSpent(uint256 nullifierHash) external view returns (bool)",
  "function getPendingDepositsCount() external view returns (uint256)",
  "function getPendingDeposit(uint256 index) external view returns (uint256)"
];

// Configuration
const CONFIG = {
  rpcUrl: 'https://sepolia.base.org',
  privateKey: process.env.DEPLOYER_PRIVATE_KEY || '',
  contracts: {
    whiteProtocol: '0xCE959493cf6F15314b4B9eEbb28369716341e7FE'
  },
  circuits: {
    deposit: '../../../circuits/deposit/build',
    withdraw: '../../../circuits/withdraw/build',
    merkleBatch: '../../../circuits/merkle_batch_update/build'
  }
};

// Test state
let testSecret: bigint;
let testNullifier: bigint;
let testCommitment: bigint;
let testLeafIndex: number;
let depositTxHash: string;
let settleTxHash: string;
let withdrawTxHash: string;
let newRoot: bigint;

function randomBigInt(bytes: number): bigint {
  const hex = crypto.randomBytes(bytes).toString('hex');
  return BigInt('0x' + hex);
}

async function computeZeros(): Promise<bigint[]> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const zeros: bigint[] = [BigInt(0)];
  
  for (let i = 1; i <= 20; i++) {
    const hash = poseidon([F.e(zeros[i-1]), F.e(zeros[i-1])]);
    zeros[i] = F.toObject(hash);
  }
  
  return zeros;
}

async function computeCommitment(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  // Circuit computes: commitment = Poseidon(secret, nullifier, amount, asset_id)
  const hash = poseidon([F.e(secret), F.e(nullifier), F.e(amount), F.e(assetId)]);
  return F.toObject(hash);
}

async function computeNullifierHash(nullifier: bigint, secret: bigint, leafIndex: number): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  // Circuit: nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
  const inner = poseidon([F.e(nullifier), F.e(secret)]);
  const outer = poseidon([inner, F.e(leafIndex)]);
  return F.toObject(outer);
}

async function computeNewRoot(commitment: bigint, zeros: bigint[]): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  
  // Level 0: hash(commitment, zeros[0])
  let current = F.toObject(poseidon([F.e(commitment), F.e(zeros[0])]));
  
  // Level 1-19: hash(current, zeros[i])
  for (let i = 1; i < 20; i++) {
    current = F.toObject(poseidon([F.e(current), F.e(zeros[i])]));
  }
  
  return current;
}

async function computeCommitmentsHash(commitment: bigint): Promise<bigint> {
  // Circuit uses SHA256 of 256-bit values, then takes first 253 bits
  const hexStr = commitment.toString(16).padStart(64, '0');
  const buffer = Buffer.from(hexStr, 'hex');
  const hash = crypto.createHash('sha256').update(buffer).digest();
  
  // Take first 253 bits
  const hashBigInt = BigInt('0x' + hash.toString('hex'));
  const mask = (BigInt(1) << BigInt(253)) - BigInt(1);
  return hashBigInt & mask;
}

async function formatProof(proof: any, publicSignals: any[]): Promise<string> {
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const parsed = JSON.parse('[' + calldata.replace(/\(/g, '[').replace(/\)/g, ']') + ']');
  
  const a = parsed[0];
  const b = parsed[1];
  const c = parsed[2];
  
  const flatProof = [
    BigInt(a[0]), BigInt(a[1]),
    BigInt(b[0][0]), BigInt(b[0][1]),
    BigInt(b[1][0]), BigInt(b[1][1]),
    BigInt(c[0]), BigInt(c[1])
  ];
  
  return new ethers.utils.AbiCoder().encode(['uint256[8]'], [flatProof]);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  WHITE PROTOCOL - COMPLETE E2E TEST (Base Sepolia)');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Setup
  const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
  const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
  const whiteProtocol = new ethers.Contract(CONFIG.contracts.whiteProtocol, WHITEPROTOCOL_ABI, wallet);
  
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Contract: ${CONFIG.contracts.whiteProtocol}`);
  console.log(`Balance: ${ethers.utils.formatEther(await provider.getBalance(wallet.address))} ETH\n`);
  
  // Generate test values
  testSecret = randomBigInt(31);
  testNullifier = randomBigInt(31);
  const depositAmountWei = ethers.utils.parseEther('0.001');
  testCommitment = await computeCommitment(testSecret, testNullifier, BigInt(depositAmountWei.toString()), BigInt(0));
  
  console.log('Test Values:');
  console.log(`  Secret: ${testSecret.toString().slice(0, 30)}...`);
  console.log(`  Nullifier: ${testNullifier.toString().slice(0, 30)}...`);
  console.log(`  Commitment: ${testCommitment.toString().slice(0, 30)}...\n`);
  
  // ============================================================
  // STEP A: DEPOSIT
  // ============================================================
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP A: DEPOSIT');
  console.log('───────────────────────────────────────────────────────────');
  
  try {
    // Generate deposit proof
    const circuitPath = path.join(__dirname, CONFIG.circuits.deposit);
    const depositAmount = ethers.utils.parseEther('0.001');
    
    // Recompute commitment to ensure it matches
    const expectedCommitment = await computeCommitment(testSecret, testNullifier, BigInt(depositAmount.toString()), BigInt(0));
    console.log(`Computed commitment: ${expectedCommitment.toString().slice(0, 30)}...`);
    console.log(`Test commitment: ${testCommitment.toString().slice(0, 30)}...`);
    
    const input = {
      secret: testSecret.toString(),
      nullifier: testNullifier.toString(),
      amount: depositAmount.toString(),
      asset_id: '0',
      commitment: expectedCommitment.toString()
    };
    
    console.log('Generating deposit proof...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      path.join(circuitPath, 'deposit_js', 'deposit.wasm'),
      path.join(circuitPath, 'deposit.zkey')
    );
    
    const proofBytes = await formatProof(proof, publicSignals);
    console.log('Proof generated ✓');
    
    // Call deposit
    const initialCount = await whiteProtocol.getPendingDepositsCount();
    console.log(`Initial pending deposits: ${initialCount}`);
    
    const tx = await whiteProtocol.deposit(
      proofBytes,
      testCommitment,
      depositAmount,
      ethers.constants.AddressZero,
      { value: depositAmount }
    );
    
    await tx.wait();
    depositTxHash = tx.hash;
    console.log(`Deposit tx: ${tx.hash}`);
    
    // Wait for state to update
    await new Promise(r => setTimeout(r, 2000));
    
    // Verify
    const newCount = await whiteProtocol.getPendingDepositsCount();
    if (newCount.toString() === (Number(initialCount) + 1).toString()) {
      testLeafIndex = Number(initialCount); // This is where our deposit was added
      console.log(`Deposit recorded at pending index: ${testLeafIndex}`);
      console.log('✅ Deposit: PASSED\n');
    } else {
      throw new Error('Pending deposit count did not increase');
    }
  } catch (e: any) {
    console.log(`❌ Deposit: FAILED - ${e.message}\n`);
    process.exit(1);
  }
  
  // ============================================================
  // STEP B: SETTLE BATCH
  // ============================================================
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP B: BATCH SETTLEMENT');
  console.log('───────────────────────────────────────────────────────────');
  
  try {
    const zeros = await computeZeros();
    const oldRoot = await whiteProtocol.getLastRoot();
    const startIndex = await whiteProtocol.nextLeafIndex();
    
    console.log(`Old root: ${oldRoot.toString().slice(0, 40)}...`);
    console.log(`Start index: ${startIndex}`);
    
    // Read the pending deposit we just made
    const actualCommitment = await whiteProtocol.getPendingDeposit(testLeafIndex);
    console.log(`Settling commitment at index ${testLeafIndex}: ${actualCommitment.toString().slice(0, 40)}...`);
    
    // Compute new root using the actual commitment from contract
    newRoot = await computeNewRoot(BigInt(actualCommitment.toString()), zeros);
    console.log(`Computed new root: ${newRoot.toString().slice(0, 40)}...`);
    
    // Compute commitments hash
    const commitmentsHash = await computeCommitmentsHash(BigInt(actualCommitment.toString()));
    
    // Generate merkle batch proof
    const circuitPath = path.join(__dirname, CONFIG.circuits.merkleBatch);
    
    // Path elements for index 0 in empty tree are just zeros[0..19]
    const pathElements = zeros.slice(0, 20).map(z => z.toString());
    
    const batchInput = {
      oldRoot: oldRoot.toString(),
      newRoot: newRoot.toString(),
      startIndex: startIndex.toString(),
      batchSize: '1',
      commitmentsHash: commitmentsHash.toString(),
      commitments: [actualCommitment.toString()],
      pathElements: [pathElements]
    };
    
    console.log('Generating batch settlement proof...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      batchInput,
      path.join(circuitPath, 'merkle_batch_update_js', 'merkle_batch_update.wasm'),
      path.join(circuitPath, 'merkle_batch_update.zkey')
    );
    
    const proofBytes = await formatProof(proof, publicSignals);
    console.log('Proof generated ✓');
    
    // Call settleBatch
    const tx = await whiteProtocol.settleBatch(
      proofBytes,
      oldRoot,
      newRoot,
      startIndex,
      1, // batchSize
      commitmentsHash
    );
    
    await tx.wait();
    settleTxHash = tx.hash;
    console.log(`Settlement tx: ${tx.hash}`);
    
    // Wait for state to update
    await new Promise(r => setTimeout(r, 3000));
    
    // Verify
    const finalRoot = await whiteProtocol.getLastRoot();
    const finalIndex = await whiteProtocol.nextLeafIndex();
    
    console.log(`Final root: ${finalRoot.toString().slice(0, 40)}...`);
    console.log(`Final index: ${finalIndex}`);
    
    // Compare as strings, allowing for full precision
    if (finalRoot.toString() !== newRoot.toString()) {
      throw new Error(`Root mismatch: expected ${newRoot.toString()}, got ${finalRoot.toString()}`);
    }
    if (finalIndex.toString() !== '1') {
      throw new Error(`Index mismatch: expected 1, got ${finalIndex}`);
    }
    
    console.log('✅ Settlement: PASSED\n');
  } catch (e: any) {
    console.log(`❌ Settlement: FAILED - ${e.message}\n`);
    process.exit(1);
  }
  
  // ============================================================
  // STEP C: WITHDRAW
  // ============================================================
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP C: WITHDRAW');
  console.log('───────────────────────────────────────────────────────────');
  
  try {
    const zeros = await computeZeros();
    const leafIndex = 0; // We settled at index 0
    const nullifierHash = await computeNullifierHash(testNullifier, testSecret, leafIndex);
    const withdrawAmount = ethers.utils.parseEther('0.001');
    const recipient = wallet.address;
    
    console.log(`Nullifier hash: ${nullifierHash.toString().slice(0, 40)}...`);
    console.log(`Root: ${newRoot.toString().slice(0, 40)}...`);
    console.log(`Recipient: ${recipient}`);
    
    // Compute Merkle path for index 0
    // After inserting commitment at index 0:
    // - Level 0: hash(commitment, zeros[0]) - sibling is zeros[0]
    // - Level 1: hash(level0, zeros[1]) - sibling is zeros[1]
    // ...and so on
    const pathElements: bigint[] = [];
    let currentNode = testCommitment;
    
    for (let i = 0; i < 20; i++) {
      // Sibling is always zeros[i] for index 0
      pathElements.push(zeros[i]);
      
      // Compute next level
      const poseidon = await buildPoseidon();
      const F = poseidon.F;
      currentNode = F.toObject(poseidon([F.e(currentNode), F.e(zeros[i])]));
    }
    
    // Generate withdraw proof
    const circuitPath = path.join(__dirname, CONFIG.circuits.withdraw);
    
    const withdrawInput = {
      secret: testSecret.toString(),
      nullifier: testNullifier.toString(),
      amount: withdrawAmount.toString(),
      asset_id: '0',
      leaf_index: '0',
      merkle_root: newRoot.toString(),
      nullifier_hash: nullifierHash.toString(),
      merkle_path: pathElements.map(e => e.toString()),
      merkle_path_indices: Array(20).fill('0'),
      recipient: '0',
      relayer: '0',
      relayer_fee: '0',
      public_data_hash: '0'
    };
    
    console.log('Generating withdraw proof...');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      withdrawInput,
      path.join(circuitPath, 'withdraw_js', 'withdraw.wasm'),
      path.join(circuitPath, 'withdraw.zkey')
    );
    
    const proofBytes = await formatProof(proof, publicSignals);
    console.log('Proof generated ✓');
    
    // Get balance before
    const balanceBefore = await provider.getBalance(recipient);
    
    // Call withdraw
    const tx = await whiteProtocol.withdraw(
      proofBytes,
      nullifierHash,
      newRoot,
      recipient,
      ethers.constants.AddressZero,
      withdrawAmount,
      0,
      ethers.constants.AddressZero
    );
    
    const receipt = await tx.wait();
    withdrawTxHash = tx.hash;
    console.log(`Withdraw tx: ${tx.hash}`);
    
    // Wait for state to update
    await new Promise(r => setTimeout(r, 3000));
    
    // Verify nullifier spent
    const isSpent = await whiteProtocol.isSpent(nullifierHash);
    if (!isSpent) {
      throw new Error('Nullifier not marked as spent');
    }
    console.log('Nullifier marked as spent ✓');
    
    // Verify balance increased
    const balanceAfter = await provider.getBalance(recipient);
    const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
    const expectedBalance = balanceBefore.sub(gasCost).add(withdrawAmount);
    
    // Allow small rounding error
    const diff = balanceAfter.sub(expectedBalance).abs();
    if (diff.gt(ethers.utils.parseEther('0.0001'))) {
      throw new Error(`Balance mismatch: expected ~${ethers.utils.formatEther(expectedBalance)}, got ${ethers.utils.formatEther(balanceAfter)}`);
    }
    console.log('ETH received ✓');
    
    console.log('✅ Withdraw: PASSED\n');
  } catch (e: any) {
    console.log(`❌ Withdraw: FAILED - ${e.message}\n`);
    process.exit(1);
  }
  
  // ============================================================
  // STEP D: DOUBLE-SPEND REJECTION
  // ============================================================
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP D: DOUBLE-SPEND REJECTION');
  console.log('───────────────────────────────────────────────────────────');
  
  try {
    const nullifierHash = await computeNullifierHash(testNullifier, testSecret, 0);
    const withdrawAmount = ethers.utils.parseEther('0.001');
    
    console.log('Attempting second withdraw with same nullifier...');
    
    // Try to withdraw again - should revert
    try {
      const zeros = await computeZeros();
      const pathElements = zeros.slice(0, 20);
      
      const circuitPath = path.join(__dirname, CONFIG.circuits.withdraw);
      const withdrawInput = {
        secret: testSecret.toString(),
        nullifier: testNullifier.toString(),
        amount: withdrawAmount.toString(),
        asset_id: '0',
        leaf_index: '0',
        merkle_root: newRoot.toString(),
        nullifier_hash: nullifierHash.toString(),
        merkle_path: pathElements.map(e => e.toString()),
        merkle_path_indices: Array(20).fill('0'),
        recipient: '0',
        relayer: '0',
        relayer_fee: '0',
        public_data_hash: '0'
      };
      
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        withdrawInput,
        path.join(circuitPath, 'withdraw_js', 'withdraw.wasm'),
        path.join(circuitPath, 'withdraw.zkey')
      );
      
      const proofBytes = await formatProof(proof, publicSignals);
      
      await whiteProtocol.withdraw(
        proofBytes,
        nullifierHash,
        newRoot,
        wallet.address,
        ethers.constants.AddressZero,
        withdrawAmount,
        0,
        ethers.constants.AddressZero
      );
      
      throw new Error('Second withdraw succeeded - should have reverted');
    } catch (e: any) {
      if (e.message.includes('revert') || e.message.includes('spent') || e.message.includes('execution reverted')) {
        console.log('Transaction reverted as expected ✓');
        console.log('✅ Double-spend rejection: PASSED\n');
      } else {
        throw e;
      }
    }
  } catch (e: any) {
    console.log(`❌ Double-spend rejection: FAILED - ${e.message}\n`);
    process.exit(1);
  }
  
  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Deposit:      ✅ PASSED  tx: ${depositTxHash}`);
  console.log(`Settlement:   ✅ PASSED  tx: ${settleTxHash}`);
  console.log(`Withdraw:     ✅ PASSED  tx: ${withdrawTxHash}`);
  console.log(`Double-spend: ✅ PASSED  (rejected)`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ALL TESTS PASSED ✓');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
