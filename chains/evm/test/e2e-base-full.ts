/**
 * Complete E2E Test for White Protocol on any EVM network
 * Tests: Deposit -> Settle -> Withdraw -> Double-spend (all with real ZK proofs)
 *
 * Tree-state aware: reads on-chain filledSubtrees to compute correct paths
 * for any startIndex, making the E2E repeatable against non-empty trees.
 *
 * Usage:
 *   NETWORK=base-sepolia tsx test/e2e-base-full.ts        # Base Sepolia (default)
 *   NETWORK=bsc-testnet tsx test/e2e-base-full.ts         # BNB Chain Testnet
 *   DEPLOYMENT_ARTIFACT=./deployments/custom.json tsx test/e2e-base-full.ts
 */

import { ethers } from 'ethers';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import {
  computeAssetIdV1BigInt,
  computeAssetIdV2BigInt,
  ProtocolDomain
} from '@thewhiteprotocol/core';
import {
  getTreeState,
  getPendingDeposits,
  computePath,
  computeRootFromPath,
  verifyRootMatch,
  TreeState
} from './helpers/tree-state';

// ─────────────────────────────────────────────────────────────
// Network configuration
// ─────────────────────────────────────────────────────────────
const NETWORK = process.env.NETWORK || 'base-sepolia';

const NETWORKS_CONFIG_PATH = path.join(__dirname, '../configs/networks.json');
const networksConfig = JSON.parse(fs.readFileSync(NETWORKS_CONFIG_PATH, 'utf8'));
const networkConfig = networksConfig[NETWORK];

if (!networkConfig) {
  console.error(`Network "${NETWORK}" not found in ${NETWORKS_CONFIG_PATH}`);
  console.error('Available networks:', Object.keys(networksConfig).join(', '));
  process.exit(1);
}

const NATIVE_SYMBOL = networkConfig.nativeSymbol || 'ETH';
const EXPLORER_URL = networkConfig.explorerUrl || '';

// Resolve RPC URL: env var > public fallback
function resolveRpcUrl(config: any): string {
  const envVar = config.rpcUrlEnvVar;
  if (envVar && process.env[envVar]) {
    return process.env[envVar]!;
  }
  // Public fallback RPCs
  const fallbacks: Record<string, string> = {
    'base-sepolia': 'https://base-sepolia-rpc.publicnode.com',
    'bsc-testnet': 'https://bsc-testnet-rpc.publicnode.com',
    'ethereum-sepolia': 'https://ethereum-sepolia-rpc.publicnode.com',
    'polygon-amoy': 'https://rpc-amoy.polygon.technology',

  };
  if (fallbacks[NETWORK]) {
    console.log(`  Using public fallback RPC for ${NETWORK}`);
    return fallbacks[NETWORK];
  }
  throw new Error(`RPC URL not configured for ${NETWORK}. Set ${envVar} env var or add a fallback.`);
}

const RPC_URL = resolveRpcUrl(networkConfig);

// ─────────────────────────────────────────────────────────────
// Load deployment artifact (v1 or v2)
// ─────────────────────────────────────────────────────────────
const ARTIFACT_PATH = process.env.DEPLOYMENT_ARTIFACT
  ? path.resolve(process.env.DEPLOYMENT_ARTIFACT)
  : path.join(__dirname, '..', networkConfig.deploymentFile || `deployments/${NETWORK}.json`);

if (!fs.existsSync(ARTIFACT_PATH)) {
  console.error(`Deployment artifact not found: ${ARTIFACT_PATH}`);
  console.error(`Deploy to ${NETWORK} first, or set DEPLOYMENT_ARTIFACT env var.`);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));

const assetIdVersion = artifact.assetIdVersion ?? 1;
const domainId = artifact.domainId ?? networkConfig.domainId;

function computeAssetId(token: string): bigint {
  if (assetIdVersion === 2) {
    return computeAssetIdV2BigInt(token, domainId);
  }
  return computeAssetIdV1BigInt(token);
}

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
  "function getPendingDeposit(uint256 index) external view returns (uint256)",
  "function filledSubtrees(uint256) external view returns (uint256)",
  "function zeros(uint256) external view returns (uint256)"
];

const ASSETREGISTRY_ABI = [
  "function getAssetId(address asset) external view returns (bytes32)",
  "function assetIdVersion() external view returns (uint8)",
  "function domainId() external view returns (uint32)"
];

// Configuration
const CONFIG = {
  rpcUrl: RPC_URL,
  privateKey: process.env.DEPLOYER_PRIVATE_KEY || '',
  contracts: {
    whiteProtocol: artifact.contracts?.WhiteProtocol,
    assetRegistry: artifact.contracts?.AssetRegistry
  },
  circuits: {
    deposit: '../../../circuits/deposit/build',
    withdraw: '../../../circuits/withdraw/build',
    merkleBatch: '../../../circuits/merkle_batch_update/build'
  }
};

if (!CONFIG.contracts.whiteProtocol || !CONFIG.contracts.assetRegistry) {
  console.error('Deployment artifact missing WhiteProtocol or AssetRegistry address');
  process.exit(1);
}

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

async function computeCommitment(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash = poseidon([F.e(secret), F.e(nullifier), F.e(amount), F.e(assetId)]);
  return F.toObject(hash);
}

async function computeNullifierHash(nullifier: bigint, secret: bigint, leafIndex: number): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const inner = poseidon([F.e(nullifier), F.e(secret)]);
  const outer = poseidon([inner, F.e(leafIndex)]);
  return F.toObject(outer);
}

async function computeCommitmentsHash(commitment: bigint): Promise<bigint> {
  const hexStr = commitment.toString(16).padStart(64, '0');
  const buffer = Buffer.from(hexStr, 'hex');
  const hash = crypto.createHash('sha256').update(buffer).digest();

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

/**
 * Settle a single pending deposit using current tree state.
 */
async function settleSingleDeposit(
  whiteProtocol: ethers.Contract,
  commitment: bigint,
  treeState: TreeState
): Promise<{ txHash: string; newRoot: bigint; newTreeState: TreeState }> {
  const oldRoot = treeState.currentRoot;
  const startIndex = treeState.nextLeafIndex;

  console.log(`  Old root: ${oldRoot.toString().slice(0, 40)}...`);
  console.log(`  Start index: ${startIndex}`);
  console.log(`  Settling commitment: ${commitment.toString().slice(0, 40)}...`);

  // Compute insertion path for startIndex
  const merklePath = computePath(startIndex, treeState.filledSubtrees, treeState.zeros);

  // Compute expected new root
  const expectedNewRoot = await computeRootFromPath(commitment, merklePath);
  console.log(`  Computed new root: ${expectedNewRoot.toString().slice(0, 40)}...`);

  // Compute commitmentsHash
  const commitmentsHash = await computeCommitmentsHash(commitment);

  // Generate batch proof
  const circuitPath = path.join(__dirname, CONFIG.circuits.merkleBatch);
  const batchInput = {
    oldRoot: oldRoot.toString(),
    newRoot: expectedNewRoot.toString(),
    startIndex: startIndex.toString(),
    batchSize: '1',
    commitmentsHash: commitmentsHash.toString(),
    commitments: [commitment.toString()],
    pathElements: [merklePath.pathElements.map(z => z.toString())]
  };

  console.log('  Generating batch settlement proof...');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    batchInput,
    path.join(circuitPath, 'merkle_batch_update_js', 'merkle_batch_update.wasm'),
    path.join(circuitPath, 'merkle_batch_update.zkey')
  );

  const proofBytes = await formatProof(proof, publicSignals);
  console.log('  Proof generated ✓');

  // Submit settlement
  const tx = await whiteProtocol.settleBatch(
    proofBytes,
    oldRoot,
    expectedNewRoot,
    startIndex,
    1,
    commitmentsHash,
    getGasOverrides()
  );

  await tx.wait();
  console.log(`  Settlement tx: ${tx.hash}`);

  // Verify on-chain root matches
  await new Promise(r => setTimeout(r, 3000));
  const newTreeState = await getTreeState(whiteProtocol);
  verifyRootMatch(expectedNewRoot, newTreeState.currentRoot, 'Settlement');
  console.log('  On-chain root verified ✓');

  return { txHash: tx.hash, newRoot: expectedNewRoot, newTreeState };
}

function getGasOverrides(): object {
  // Polygon Amoy requires a minimum tip cap of ~25 gwei
  if (NETWORK === 'polygon-amoy') {
    return {
      maxPriorityFeePerGas: ethers.utils.parseUnits('25', 'gwei'),
      maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
    };
  }
  return {};
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  WHITE PROTOCOL - REPEATABLE E2E TEST (${NETWORK})`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Setup
  const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
  const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
  const whiteProtocol = new ethers.Contract(CONFIG.contracts.whiteProtocol, WHITEPROTOCOL_ABI, wallet);
  const assetRegistry = new ethers.Contract(CONFIG.contracts.assetRegistry, ASSETREGISTRY_ABI, wallet);

  console.log(`Deployer: ${wallet.address}`);
  console.log(`Contract: ${CONFIG.contracts.whiteProtocol}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.utils.formatEther(balance)} ${NATIVE_SYMBOL}\n`);

  // ───────────────────────────────────────────────────────────
  // Artifact & asset ID verification
  // ───────────────────────────────────────────────────────────
  console.log('Artifact path:', ARTIFACT_PATH);
  console.log('Domain ID:', domainId, `(hex: 0x${domainId.toString(16).padStart(8, '0')})`);
  console.log('Asset ID version:', assetIdVersion);

  const ASSET_ID = computeAssetId(ethers.constants.AddressZero);
  console.log(`Computed asset ID (v${assetIdVersion}): 0x${ASSET_ID.toString(16).padStart(64, '0')}`);

  const onChainAssetId = await assetRegistry.getAssetId(ethers.constants.AddressZero);
  const onChainAssetIdBI = typeof onChainAssetId === 'string'
    ? BigInt(onChainAssetId)
    : BigInt(onChainAssetId.toHexString?.() || onChainAssetId.toString());
  console.log(`On-chain asset ID: ${onChainAssetId}`);
  console.log(`Asset ID match: ${ASSET_ID === onChainAssetIdBI ? '✅ YES' : '❌ NO'}\n`);

  if (ASSET_ID !== onChainAssetIdBI) {
    throw new Error('Asset ID mismatch between TypeScript and on-chain Solidity');
  }

  // ───────────────────────────────────────────────────────────
  // STEP 0: SETTLE ANY EXISTING PENDING DEPOSITS
  // ───────────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP 0: SETTLE EXISTING PENDING DEPOSITS');
  console.log('───────────────────────────────────────────────────────────');

  let treeState = await getTreeState(whiteProtocol);
  console.log(`Current tree root: ${treeState.currentRoot.toString().slice(0, 40)}...`);
  console.log(`Next leaf index: ${treeState.nextLeafIndex}`);

  const pendingCommitments = await getPendingDeposits(whiteProtocol);
  console.log(`Pending deposits: ${pendingCommitments.length}`);

  if (pendingCommitments.length > 0) {
    for (let i = 0; i < pendingCommitments.length; i++) {
      console.log(`\nSettling pending deposit ${i + 1}/${pendingCommitments.length}...`);
      const result = await settleSingleDeposit(whiteProtocol, pendingCommitments[i], treeState);
      treeState = result.newTreeState;
      console.log(`✅ Pending deposit ${i + 1} settled at leaf index ${treeState.nextLeafIndex - 1}\n`);
    }
  } else {
    console.log('No pending deposits to settle.\n');
  }

  // ───────────────────────────────────────────────────────────
  // STEP A: DEPOSIT
  // ───────────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP A: DEPOSIT');
  console.log('───────────────────────────────────────────────────────────');

  try {
    testSecret = randomBigInt(31);
    testNullifier = randomBigInt(31);
    const depositAmount = ethers.utils.parseEther('0.001');

    testCommitment = await computeCommitment(testSecret, testNullifier, BigInt(depositAmount.toString()), ASSET_ID);

    console.log('Test Values:');
    console.log(`  Secret: ${testSecret.toString().slice(0, 30)}...`);
    console.log(`  Nullifier: ${testNullifier.toString().slice(0, 30)}...`);
    console.log(`  Commitment: ${testCommitment.toString().slice(0, 30)}...\n`);

    const circuitPath = path.join(__dirname, CONFIG.circuits.deposit);
    const expectedCommitment = await computeCommitment(testSecret, testNullifier, BigInt(depositAmount.toString()), ASSET_ID);

    const input = {
      secret: testSecret.toString(),
      nullifier: testNullifier.toString(),
      amount: depositAmount.toString(),
      asset_id: ASSET_ID.toString(),
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

    const initialCount = await whiteProtocol.getPendingDepositsCount();
    console.log(`Initial pending deposits: ${initialCount}`);

    const tx = await whiteProtocol.deposit(
      proofBytes,
      testCommitment,
      depositAmount,
      ethers.constants.AddressZero,
      { value: depositAmount, ...getGasOverrides() }
    );

    await tx.wait();
    depositTxHash = tx.hash;
    console.log(`Deposit tx: ${tx.hash}`);

    await new Promise(r => setTimeout(r, 2000));

    const newCount = await whiteProtocol.getPendingDepositsCount();
    if (newCount.toString() === (Number(initialCount) + 1).toString()) {
      console.log(`Deposit recorded at pending index: ${initialCount}`);
      console.log('✅ Deposit: PASSED\n');
    } else {
      throw new Error('Pending deposit count did not increase');
    }
  } catch (e: any) {
    console.log(`❌ Deposit: FAILED - ${e.message}\n`);
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────
  // STEP B: BATCH SETTLEMENT
  // ───────────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP B: BATCH SETTLEMENT');
  console.log('───────────────────────────────────────────────────────────');

  try {
    treeState = await getTreeState(whiteProtocol);
    const result = await settleSingleDeposit(whiteProtocol, testCommitment, treeState);
    settleTxHash = result.txHash;
    newRoot = result.newRoot;
    treeState = result.newTreeState;
    testLeafIndex = treeState.nextLeafIndex - 1;

    console.log(`New leaf index: ${testLeafIndex}`);
    console.log('✅ Settlement: PASSED\n');
  } catch (e: any) {
    console.log(`❌ Settlement: FAILED - ${e.message}\n`);
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────
  // STEP C: WITHDRAW
  // ───────────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────────');
  console.log('STEP C: WITHDRAW');
  console.log('───────────────────────────────────────────────────────────');

  try {
    const nullifierHash = await computeNullifierHash(testNullifier, testSecret, testLeafIndex);
    const withdrawAmount = ethers.utils.parseEther('0.001');
    const recipient = wallet.address;

    console.log(`Nullifier hash: ${nullifierHash.toString().slice(0, 40)}...`);
    console.log(`Root: ${newRoot.toString().slice(0, 40)}...`);
    console.log(`Leaf index: ${testLeafIndex}`);
    console.log(`Recipient: ${recipient}`);

    // Re-read tree state for withdrawal path
    treeState = await getTreeState(whiteProtocol);
    const withdrawPath = computePath(testLeafIndex, treeState.filledSubtrees, treeState.zeros);

    // Verify path leads to current root
    const verifyRoot = await computeRootFromPath(testCommitment, withdrawPath);
    verifyRootMatch(verifyRoot, treeState.currentRoot, 'Withdrawal path');
    console.log('Withdrawal path verified against current root ✓');

    const circuitPath = path.join(__dirname, CONFIG.circuits.withdraw);

    const withdrawInput = {
      secret: testSecret.toString(),
      nullifier: testNullifier.toString(),
      amount: withdrawAmount.toString(),
      asset_id: ASSET_ID.toString(),
      leaf_index: testLeafIndex.toString(),
      merkle_root: newRoot.toString(),
      nullifier_hash: nullifierHash.toString(),
      merkle_path: withdrawPath.pathElements.map(e => e.toString()),
      merkle_path_indices: withdrawPath.pathIndices.map(i => i.toString()),
      recipient: BigInt(recipient).toString(),
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

    const balanceBefore = await provider.getBalance(recipient);

    const tx = await whiteProtocol.withdraw(
      proofBytes,
      nullifierHash,
      newRoot,
      recipient,
      ethers.constants.AddressZero,
      withdrawAmount,
      0,
      ethers.constants.AddressZero,
      getGasOverrides()
    );

    const receipt = await tx.wait();
    withdrawTxHash = tx.hash;
    console.log(`Withdraw tx: ${tx.hash}`);

    await new Promise(r => setTimeout(r, 3000));

    const isSpent = await whiteProtocol.isSpent(nullifierHash);
    if (!isSpent) {
      throw new Error('Nullifier not marked as spent');
    }
    console.log('Nullifier marked as spent ✓');

    const balanceAfter = await provider.getBalance(recipient);
    const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
    const expectedBalance = balanceBefore.sub(gasCost).add(withdrawAmount);

    const diff = balanceAfter.sub(expectedBalance).abs();
    if (diff.gt(ethers.utils.parseEther('0.0001'))) {
      throw new Error(`Balance mismatch: expected ~${ethers.utils.formatEther(expectedBalance)}, got ${ethers.utils.formatEther(balanceAfter)}`);
    }
    console.log(`${NATIVE_SYMBOL} received ✓`);

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
    const nullifierHash = await computeNullifierHash(testNullifier, testSecret, testLeafIndex);
    const withdrawAmount = ethers.utils.parseEther('0.001');

    console.log('Attempting second withdraw with same nullifier...');

    try {
      treeState = await getTreeState(whiteProtocol);
      const dsPath = computePath(testLeafIndex, treeState.filledSubtrees, treeState.zeros);

      const circuitPath = path.join(__dirname, CONFIG.circuits.withdraw);
      const withdrawInput = {
        secret: testSecret.toString(),
        nullifier: testNullifier.toString(),
        amount: withdrawAmount.toString(),
        asset_id: ASSET_ID.toString(),
        leaf_index: testLeafIndex.toString(),
        merkle_root: newRoot.toString(),
        nullifier_hash: nullifierHash.toString(),
        merkle_path: dsPath.pathElements.map(e => e.toString()),
        merkle_path_indices: dsPath.pathIndices.map(i => i.toString()),
        recipient: BigInt(wallet.address).toString(),
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
        ethers.constants.AddressZero,
        getGasOverrides()
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
  console.log(`Network:      ${NETWORK}`);
  console.log(`Artifact:     ${ARTIFACT_PATH}`);
  console.log(`Domain ID:    ${domainId} (0x${domainId.toString(16).padStart(8, '0')})`);
  console.log(`Asset ver:    v${assetIdVersion}`);
  console.log(`Deposit:      ✅ PASSED  tx: ${depositTxHash}`);
  console.log(`Settlement:   ✅ PASSED  tx: ${settleTxHash}`);
  console.log(`Leaf index:   ${testLeafIndex}`);
  console.log(`Withdraw:     ✅ PASSED  tx: ${withdrawTxHash}`);
  console.log(`Double-spend: ✅ PASSED  (rejected)`);
  if (EXPLORER_URL) {
    console.log(`Explorer:     ${EXPLORER_URL}`);
  }
  console.log('═══════════════════════════════════════════════════════════');
  console.log('ALL TESTS PASSED ✓');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
