/**
 * PR-010V: Base Sepolia -> Solana Devnet Bridge Source Side
 *
 * Minimal script that:
 * 1. Deposits on Base Sepolia
 * 2. Settles into Merkle tree
 * 3. bridgeOutV1 with Solana destination
 * 4. Builds the destination BridgeMint message via exact decimal normalization
 * 5. Generates threshold signatures over the destination BridgeMint hash
 * 6. Saves bridge state for Solana submission
 *
 * Run:
 *   cd chains/evm
 *   source .bridge-signers.env
 *   npx tsx test/e2e-bridge-base-to-solana.ts
 */

import { ethers } from 'ethers';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  BridgeMessageType,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  hashBridgeMessageV1,
  parseBridgeMessageV1Json,
  normalizeBridgeAmount,
  computeAssetIdV2BigInt,
  computeAssetIdV1BigInt,
} from '@thewhiteprotocol/core';
import {
  getTreeState,
  computePath,
  computeRootFromPath,
  verifyRootMatch,
} from './helpers/tree-state';

const BASE_RPC = process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.BASE_DEPLOYER_PRIVATE_KEY || '';

const SIGNER_KEYS = [
  process.env.BRIDGE_SIGNER_1_PRIVATE_KEY,
  process.env.BRIDGE_SIGNER_2_PRIVATE_KEY,
  process.env.BRIDGE_SIGNER_3_PRIVATE_KEY,
  ...(process.env.BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET?.split(',') ?? []),
].map((key) => key?.trim()).filter(Boolean) as string[];

if (!DEPLOYER_KEY) {
  console.error('DEPLOYER_PRIVATE_KEY or BASE_DEPLOYER_PRIVATE_KEY required');
  process.exit(1);
}
if (SIGNER_KEYS.length < 2) {
  console.error('Need at least 2 bridge signer keys via BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET or BRIDGE_SIGNER_[1-3]_PRIVATE_KEY');
  process.exit(1);
}

const baseArtifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../deployments/base-sepolia.json'), 'utf8')
);

const WHITEPROTOCOL_ABI = [
  'function deposit(bytes calldata proof, uint256 commitment, uint256 amount, address token) external payable',
  'function settleBatch(bytes calldata proof, uint256 oldRoot, uint256 newRoot, uint256 startIndex, uint256 batchSize, uint256 commitmentsHash) external',
  'function bridgeOutV1(bytes calldata proof, tuple(uint16 protocolVersion, uint8 messageType, uint32 sourceDomain, uint32 destinationDomain, uint64 sourceChainId, uint64 destinationChainId, bytes32 canonicalAssetId, bytes32 sourceLocalAssetId, bytes32 destinationLocalAssetId, uint128 amount, bytes32 sourceNullifierHash, bytes32 destinationCommitment, bytes32 sourceRoot, uint64 sourceLeafIndex, bytes32 sourceTxHash, uint64 sourceBlockNumber, uint64 sourceFinalityBlock, uint64 nonce, uint64 deadline, uint128 relayerFee, bytes32 recipientStealthMetadataHash, bytes32 memoHash, bytes32 reserved0, bytes32 reserved1) calldata message, address asset) external',
  'function withdraw(bytes calldata proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external',
  'function getLastRoot() external view returns (uint256)',
  'function nextLeafIndex() external view returns (uint256)',
  'function isKnownRoot(uint256 root) external view returns (bool)',
  'function isSpent(uint256 nullifierHash) external view returns (bool)',
  'function filledSubtrees(uint256) external view returns (uint256)',
  'function zeros(uint256) external view returns (uint256)',
  'function bridgeOutbox() external view returns (address)',
  'event BridgeOut(bytes32 indexed nullifierHash, address indexed asset, uint256 amount, bytes32 messageHash)',
];

const BRIDGE_OUTBOX_ABI = [
  'function outboundNonce(uint32 destinationDomain) external view returns (uint64)',
  'event BridgeOutInitiated(bytes32 indexed messageHash, uint32 indexed destinationDomain, bytes32 indexed canonicalAssetId, uint128 amount, uint64 nonce, bytes encodedMessage)',
];

const SOURCE_DECIMALS = 18;
const DESTINATION_DECIMALS = 9;
const NORMALIZATION_MODE = 'exact-decimal' as const;
const SOLANA_SIGNER_SET_VERSION = 2;
const BASE_LOW_GAS_OVERRIDES = {
  gasLimit: 2_000_000,
  gasPrice: ethers.utils.parseUnits('0.01', 'gwei'),
};

function repoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function firstExistingPath(label: string, candidates: string[]): string {
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`${label} not found. Checked: ${candidates.join(', ')}`);
  }
  return found;
}

function circuitFileCandidates(...segments: string[]): string[] {
  return [
    path.join(repoRoot(), 'circuits', ...segments),
    path.join(repoRoot(), 'relayer', 'circuits', ...segments),
    path.join(repoRoot(), 'app', 'public', 'circuits', ...segments),
  ];
}

function randomBigInt(bytes: number): bigint {
  const buf = crypto.randomBytes(bytes);
  let result = 0n;
  for (let i = 0; i < bytes; i++) {
    result = (result << 8n) | BigInt(buf[i]);
  }
  return result;
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

function getSortedThresholdSignerWallets(): ethers.Wallet[] {
  return SIGNER_KEYS
    .map((key) => new ethers.Wallet(key))
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))
    .slice(0, 2);
}

function bridgeMessageForJson(message: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
  );
}

async function resumeBridgeOutFromCheckpoint(
  provider: ethers.providers.JsonRpcProvider,
  wallet: ethers.Wallet,
  baseWP: ethers.Contract
) {
  const checkpointPath = 'test/base-to-solana-bridge-state-checkpoint.json';
  if (!fs.existsSync(checkpointPath)) {
    throw new Error(`Checkpoint missing: ${checkpointPath}`);
  }

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  const sourceMessage = parseBridgeMessageV1Json(checkpoint.sourceMessage);
  const bridgeMintMessage = parseBridgeMessageV1Json(checkpoint.bridgeMintMessage);
  const sourceMessageHash = hashBridgeMessageV1(sourceMessage);
  const bridgeMintMessageHash = hashBridgeMessageV1(bridgeMintMessage);
  const bridgeOutboxAddress = await baseWP.bridgeOutbox();

  if (sourceMessageHash.toLowerCase() !== checkpoint.sourceMessageHash.toLowerCase()) {
    throw new Error(`Checkpoint source hash mismatch: ${sourceMessageHash} != ${checkpoint.sourceMessageHash}`);
  }
  if (bridgeMintMessageHash.toLowerCase() !== checkpoint.bridgeMintMessageHash.toLowerCase()) {
    throw new Error(`Checkpoint BridgeMint hash mismatch: ${bridgeMintMessageHash} != ${checkpoint.bridgeMintMessageHash}`);
  }
  if (bridgeOutboxAddress.toLowerCase() !== checkpoint.baseBridgeOutbox.toLowerCase()) {
    throw new Error(
      `WhiteProtocol bridgeOutbox mismatch: on-chain=${bridgeOutboxAddress}, checkpoint=${checkpoint.baseBridgeOutbox}`
    );
  }

  console.log('\n📋 RESUME: bridgeOutV1 from checkpoint');
  console.log('Source BridgeOut hash:', sourceMessageHash);
  console.log('Destination BridgeMint hash:', bridgeMintMessageHash);
  console.log('BridgeOutbox:', bridgeOutboxAddress);

  await baseWP.callStatic.bridgeOutV1(
    checkpoint.withdrawProofBytes,
    sourceMessage,
    ethers.constants.AddressZero,
    { gasLimit: 3000000 }
  );
  const bridgeOutTx = await baseWP.bridgeOutV1(
    checkpoint.withdrawProofBytes,
    sourceMessage,
    ethers.constants.AddressZero,
    BASE_LOW_GAS_OVERRIDES
  );
  const bridgeOutReceipt = await bridgeOutTx.wait();
  console.log('✅ bridgeOutV1 tx:', bridgeOutTx.hash);
  console.log('  BridgeOut block:', bridgeOutReceipt.blockNumber);
  const finalityReceipt = await provider.waitForTransaction(bridgeOutTx.hash, 2);
  console.log('  Finality confirmations:', finalityReceipt.confirmations);

  const wpIface = new ethers.utils.Interface(WHITEPROTOCOL_ABI);
  const bridgeOutEvent = bridgeOutReceipt.logs
    .map((log: any) => { try { return wpIface.parseLog(log); } catch { return null; } })
    .find((e: any) => e && e.name === 'BridgeOut');
  if (!bridgeOutEvent) {
    throw new Error('BridgeOut event not found');
  }
  if (bridgeOutEvent.args.messageHash.toLowerCase() !== sourceMessageHash.toLowerCase()) {
    throw new Error(`BridgeOut event hash mismatch: ${bridgeOutEvent.args.messageHash} != ${sourceMessageHash}`);
  }

  const isSpent = await baseWP.isSpent(BigInt(sourceMessage.sourceNullifierHash));
  console.log('  Source nullifier spent:', isSpent);
  if (!isSpent) {
    throw new Error('Source nullifier was not marked spent');
  }

  const bridgeMintMessageHashBytes = Buffer.from(bridgeMintMessageHash.slice(2), 'hex');
  const thresholdSigners = getSortedThresholdSignerWallets();
  const signatures = thresholdSigners.map((signerWallet) => {
    const sig = signerWallet._signingKey().signDigest(bridgeMintMessageHashBytes);
    const r = Buffer.from(sig.r.slice(2), 'hex');
    const s = Buffer.from(sig.s.slice(2), 'hex');
    const v = Buffer.from([sig.recoveryParam + 27]);
    return Array.from(Buffer.concat([r, s, v]));
  });

  const sourceMessageForJson = bridgeMessageForJson(sourceMessage as any);
  const bridgeMintMessageForJson = bridgeMessageForJson(bridgeMintMessage as any);
  const output = {
    baseWhiteProtocol: baseWP.address,
    baseBridgeOutbox: bridgeOutboxAddress,
    deployer: wallet.address,
    depositTx: checkpoint.depositTx,
    settleTx: checkpoint.settleTx,
    bridgeOutTx: bridgeOutTx.hash,
    bridgeOutBlockNumber: bridgeOutReceipt.blockNumber,
    bridgeOutFinalityBlock: bridgeOutReceipt.blockNumber + 1,
    sourceMessage: sourceMessageForJson,
    sourceMessageHash,
    bridgeMintMessage: bridgeMintMessageForJson,
    bridgeMintMessageHash,
    message: sourceMessageForJson,
    messageHash: sourceMessageHash,
    signatures,
    signerAddresses: thresholdSigners.map((s) => s.address),
    signerSetVersion: SOLANA_SIGNER_SET_VERSION,
    destSecret: checkpoint.destSecret,
    destNullifier: checkpoint.destNullifier,
    destCommitment: checkpoint.destCommitment,
    solanaAssetId: checkpoint.solanaAssetId,
    amount: checkpoint.destinationAmount,
    sourceAmount: checkpoint.sourceAmount,
    destinationAmount: checkpoint.destinationAmount,
    destAmount: checkpoint.destinationAmount,
    sourceDecimals: checkpoint.sourceDecimals,
    destinationDecimals: checkpoint.destinationDecimals,
    normalizationMode: checkpoint.normalizationMode,
    manualMessageEditUsed: false,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync('test/base-to-solana-bridge-state.json', JSON.stringify(output, null, 2));
  fs.writeFileSync('test/base-to-solana-bridge-state-v2.json', JSON.stringify(output, null, 2));
  console.log('✅ State saved to: test/base-to-solana-bridge-state.json');
  console.log('✅ State saved to: test/base-to-solana-bridge-state-v2.json');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PR-010V: Base Sepolia -> Solana Devnet (Source Side)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const provider = new ethers.providers.JsonRpcProvider(BASE_RPC);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  console.log('Deployer:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('Balance:', ethers.utils.formatEther(bal), 'ETH');

  if (bal.lt(ethers.utils.parseEther('0.0015'))) {
    console.error('❌ Insufficient balance for deposit + gas');
    process.exit(1);
  }

  const baseWP = new ethers.Contract(baseArtifact.contracts.WhiteProtocol, WHITEPROTOCOL_ABI, wallet);
  const bridgeOutboxAddress = await baseWP.bridgeOutbox();
  const baseOutbox = new ethers.Contract(bridgeOutboxAddress, BRIDGE_OUTBOX_ABI, provider);

  console.log('WhiteProtocol:', baseWP.address);
  console.log('BridgeOutbox:', bridgeOutboxAddress);

  if (process.env.RESUME_BASE_TO_SOLANA_BRIDGEOUT === '1') {
    await resumeBridgeOutFromCheckpoint(provider, wallet, baseWP);
    return;
  }

  // Asset IDs
  // Base native ETH asset ID = keccak256(tokenAddress=0x0, domainId=33554434)
  const BASE_ASSET_ID = computeAssetIdV2BigInt(
    '0x0000000000000000000000000000000000000000',
    baseArtifact.domainId
  );
  // Solana program uses v1 asset IDs for vault registration (no domain)
  const SOLANA_ASSET_ID = computeAssetIdV1BigInt(
    'So11111111111111111111111111111111111111112'
  );

  const depositAmount = ethers.utils.parseEther('0.001');
  const sourceAmount = BigInt(depositAmount.toString());
  const destinationAmount = normalizeBridgeAmount({
    sourceAmount,
    sourceDecimals: SOURCE_DECIMALS,
    destinationDecimals: DESTINATION_DECIMALS,
    mode: NORMALIZATION_MODE,
  });

  console.log('\nAmount normalization:');
  console.log('  Mode:', NORMALIZATION_MODE);
  console.log('  Source amount:', sourceAmount.toString(), `(decimals=${SOURCE_DECIMALS})`);
  console.log('  Destination amount:', destinationAmount.toString(), `(decimals=${DESTINATION_DECIMALS})`);

  // ── Generate notes ──
  const sourceSecret = randomBigInt(31);
  const sourceNullifier = randomBigInt(31);
  const sourceCommitment = await computeCommitment(sourceSecret, sourceNullifier, sourceAmount, BASE_ASSET_ID);

  const destSecret = randomBigInt(31);
  const destNullifier = randomBigInt(31);
  const destCommitment = await computeCommitment(destSecret, destNullifier, destinationAmount, SOLANA_ASSET_ID);

  console.log('\nSource note:');
  console.log('  Secret: generated (not printed)');
  console.log('  Nullifier: generated (not printed)');
  console.log('  Commitment:', sourceCommitment.toString().slice(0, 30) + '...');
  console.log('Destination note (Solana):');
  console.log('  Secret: generated (not printed)');
  console.log('  Nullifier: generated (not printed)');
  console.log('  Commitment:', destCommitment.toString().slice(0, 30) + '...');

  // ── STEP A: Deposit ──
  console.log('\n📋 STEP A: Deposit');
  const depositInput = {
    secret: sourceSecret.toString(),
    nullifier: sourceNullifier.toString(),
    amount: depositAmount.toString(),
    asset_id: BASE_ASSET_ID.toString(),
    commitment: sourceCommitment.toString()
  };

  console.log('Generating deposit proof...');
  const { proof: depositProof, publicSignals: depositPubSignals } = await snarkjs.groth16.fullProve(
    depositInput,
    firstExistingPath('deposit.wasm', [
      ...circuitFileCandidates('deposit', 'build', 'deposit_js', 'deposit.wasm'),
      ...circuitFileCandidates('build', 'deposit_js', 'deposit.wasm'),
      ...circuitFileCandidates('deposit', 'deposit.wasm'),
    ]),
    firstExistingPath('deposit.zkey', [
      ...circuitFileCandidates('deposit', 'build', 'deposit.zkey'),
      ...circuitFileCandidates('build', 'deposit.zkey'),
      ...circuitFileCandidates('deposit', 'deposit.zkey'),
    ])
  );
  const depositProofBytes = await formatProof(depositProof, depositPubSignals);
  console.log('✅ Deposit proof generated');

  const depositTx = await baseWP.deposit(depositProofBytes, sourceCommitment, depositAmount, ethers.constants.AddressZero, { value: depositAmount });
  await depositTx.wait();
  console.log('✅ Deposit tx:', depositTx.hash);

  // ── STEP B: Settlement ──
  console.log('\n📋 STEP B: Settlement');
  let treeState = await getTreeState(baseWP);
  const oldRoot = treeState.currentRoot;
  const startIndex = treeState.nextLeafIndex;
  const merklePath = computePath(startIndex, treeState.filledSubtrees, treeState.zeros);
  const expectedNewRoot = await computeRootFromPath(sourceCommitment, merklePath);
  const commitmentsHash = await computeCommitmentsHash(sourceCommitment);

  verifyRootMatch(expectedNewRoot, await computeRootFromPath(sourceCommitment, merklePath), 'Settlement');

  const batchInput = {
    oldRoot: oldRoot.toString(),
    newRoot: expectedNewRoot.toString(),
    startIndex: startIndex.toString(),
    batchSize: '1',
    commitmentsHash: commitmentsHash.toString(),
    commitments: [sourceCommitment.toString()],
    pathElements: [merklePath.pathElements.map(e => e.toString())]
  };

  const { proof: batchProof, publicSignals: batchPubSignals } = await snarkjs.groth16.fullProve(
    batchInput,
    firstExistingPath('merkle_batch_update.wasm', [
      ...circuitFileCandidates('merkle_batch_update', 'build', 'merkle_batch_update_js', 'merkle_batch_update.wasm'),
      ...circuitFileCandidates('build', 'merkle_batch_update', 'merkle_batch_update_js', 'merkle_batch_update.wasm'),
      ...circuitFileCandidates('merkle_batch_update', 'merkle_batch_update_js', 'merkle_batch_update.wasm'),
      ...circuitFileCandidates('merkle_batch_update', 'merkle_batch_update.wasm'),
    ]),
    firstExistingPath('merkle_batch_update.zkey', [
      ...circuitFileCandidates('merkle_batch_update', 'build', 'merkle_batch_update.zkey'),
      ...circuitFileCandidates('build', 'merkle_batch_update', 'merkle_batch_update.zkey'),
      ...circuitFileCandidates('merkle_batch_update', 'merkle_batch_update.zkey'),
    ])
  );
  const batchProofBytes = await formatProof(batchProof, batchPubSignals);
  console.log('✅ Settlement proof generated');

  const settleTx = await baseWP.settleBatch(batchProofBytes, oldRoot, expectedNewRoot, startIndex, 1, commitmentsHash, { gasLimit: 1500000 });
  const settleReceipt = await settleTx.wait();
  console.log('✅ Settlement tx:', settleTx.hash);

  // Use startIndex directly as leaf index — avoids stale RPC reads.
  // The pre-settlement merklePath is also the correct withdrawal path.
  const leafIndex = Number(startIndex);
  console.log('  Leaf index:', leafIndex);
  console.log('  Settlement block:', settleReceipt.blockNumber);

  // ── STEP C: Build Bridge Message ──
  console.log('\n📋 STEP C: Build Bridge Message');
  const nullifierHash = await computeNullifierHash(sourceNullifier, sourceSecret, leafIndex);
  const nextNonce = await baseOutbox.outboundNonce(0x01000002);
  const messageNonce = Number(nextNonce) + 1;
  const now = Math.floor(Date.now() / 1000);

  const sourceMessage = {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 0x02000002,
    destinationDomain: 0x01000002,
    sourceChainId: 84532,
    destinationChainId: 0,
    canonicalAssetId: '0x' + BASE_ASSET_ID.toString(16).padStart(64, '0'),
    sourceLocalAssetId: '0x' + BASE_ASSET_ID.toString(16).padStart(64, '0'),
    destinationLocalAssetId: '0x' + SOLANA_ASSET_ID.toString(16).padStart(64, '0'),
    amount: sourceAmount,
    sourceNullifierHash: '0x' + nullifierHash.toString(16).padStart(64, '0'),
    destinationCommitment: '0x' + destCommitment.toString(16).padStart(64, '0'),
    sourceRoot: '0x' + expectedNewRoot.toString(16).padStart(64, '0'),
    sourceLeafIndex: leafIndex,
    sourceTxHash: '0x' + '0'.repeat(64),
    sourceBlockNumber: 0,
    sourceFinalityBlock: 0,
    nonce: messageNonce,
    deadline: now + 3600,
    relayerFee: 0n,
    recipientStealthMetadataHash: '0x' + '0'.repeat(64),
    memoHash: '0x' + '0'.repeat(64),
    reserved0: '0x' + '0'.repeat(64),
    reserved1: '0x' + '0'.repeat(64),
  };

  const sourceMessageHash = hashBridgeMessageV1(sourceMessage);
  const bridgeMintMessage = buildDestinationBridgeMintMessageFromSourceBridgeOut({
    sourceMessage,
    destinationDomain: sourceMessage.destinationDomain,
    destinationChainId: sourceMessage.destinationChainId,
    destinationLocalAssetId: sourceMessage.destinationLocalAssetId,
    destinationCommitment: sourceMessage.destinationCommitment,
    sourceDecimals: SOURCE_DECIMALS,
    destinationDecimals: DESTINATION_DECIMALS,
    normalizationMode: NORMALIZATION_MODE,
  });
  const bridgeMintMessageHash = hashBridgeMessageV1(bridgeMintMessage);

  console.log('Source BridgeOut hash:', sourceMessageHash);
  console.log('Destination BridgeMint hash:', bridgeMintMessageHash);
  console.log('Nonce:', sourceMessage.nonce);
  console.log('Destination commitment:', sourceMessage.destinationCommitment);

  // ── STEP D: Generate Bridge Withdraw Proof ──
  console.log('\n📋 STEP D: Generate Bridge Withdraw Proof');
  const withdrawPath = merklePath;
  const withdrawalRoot = await computeRootFromPath(sourceCommitment, withdrawPath);
  verifyRootMatch(withdrawalRoot, expectedNewRoot, 'Withdrawal path');
  console.log('  Withdrawal path verified against settlement root');

  const BN254_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const publicDataHash = BigInt(sourceMessageHash) % BN254_SCALAR_FIELD;

  const withdrawInput = {
    secret: sourceSecret.toString(),
    nullifier: sourceNullifier.toString(),
    amount: sourceAmount.toString(),
    asset_id: BASE_ASSET_ID.toString(),
    leaf_index: leafIndex.toString(),
    merkle_root: expectedNewRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    merkle_path: withdrawPath.pathElements.map(e => e.toString()),
    merkle_path_indices: withdrawPath.pathIndices.map(i => i.toString()),
    recipient: BigInt(bridgeOutboxAddress).toString(),
    relayer: '0',
    relayer_fee: '0',
    public_data_hash: publicDataHash.toString(),
  };

  console.log('Generating withdraw proof...');
  const { proof: withdrawProof, publicSignals: withdrawPubSignals } = await snarkjs.groth16.fullProve(
    withdrawInput,
    firstExistingPath('withdraw.wasm', [
      ...circuitFileCandidates('withdraw', 'build', 'withdraw_js', 'withdraw.wasm'),
      ...circuitFileCandidates('build', 'withdraw_js', 'withdraw.wasm'),
      ...circuitFileCandidates('withdraw', 'withdraw.wasm'),
    ]),
    firstExistingPath('withdraw.zkey', [
      ...circuitFileCandidates('withdraw', 'build', 'withdraw.zkey'),
      ...circuitFileCandidates('build', 'withdraw.zkey'),
      ...circuitFileCandidates('withdraw', 'withdraw.zkey'),
    ])
  );
  const expectedWithdrawSignals = [
    treeState.currentRoot.toString(),
    nullifierHash.toString(),
    BASE_ASSET_ID.toString(),
    BigInt(bridgeOutboxAddress).toString(),
    sourceAmount.toString(),
    '0',
    '0',
    publicDataHash.toString(),
  ];
  for (let i = 0; i < expectedWithdrawSignals.length; i++) {
    if (withdrawPubSignals[i].toString() !== expectedWithdrawSignals[i]) {
      throw new Error(`Withdraw public signal ${i} mismatch: expected ${expectedWithdrawSignals[i]}, got ${withdrawPubSignals[i]}`);
    }
  }
  const withdrawProofBytes = await formatProof(withdrawProof, withdrawPubSignals);
  console.log('✅ Withdraw proof generated');

  // Save a local recovery checkpoint before bridgeOutV1. This file is intentionally
  // untracked and contains note secrets needed to retry this exact test note.
  const bridgeMintMessageForCheckpoint = Object.fromEntries(
    Object.entries(bridgeMintMessage).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
  );
  const sourceMessageForCheckpoint = Object.fromEntries(
    Object.entries(sourceMessage).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
  );
  const checkpoint = {
    status: 'ready_for_bridgeOutV1',
    baseWhiteProtocol: baseWP.address,
    baseBridgeOutbox: bridgeOutboxAddress,
    deployer: wallet.address,
    depositTx: depositTx.hash,
    settleTx: settleTx.hash,
    sourceMessage: sourceMessageForCheckpoint,
    sourceMessageHash,
    bridgeMintMessage: bridgeMintMessageForCheckpoint,
    bridgeMintMessageHash,
    sourceSecret: sourceSecret.toString(),
    sourceNullifier: sourceNullifier.toString(),
    destSecret: destSecret.toString(),
    destNullifier: destNullifier.toString(),
    destCommitment: destCommitment.toString(),
    sourceAmount: sourceAmount.toString(),
    destinationAmount: destinationAmount.toString(),
    destAmount: destinationAmount.toString(),
    sourceDecimals: SOURCE_DECIMALS,
    destinationDecimals: DESTINATION_DECIMALS,
    normalizationMode: NORMALIZATION_MODE,
    leafIndex,
    merkleRoot: treeState.currentRoot.toString(),
    withdrawProofBytes,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync('test/base-to-solana-bridge-state-checkpoint.json', JSON.stringify(checkpoint, null, 2));
  console.log('✅ Recovery checkpoint saved: test/base-to-solana-bridge-state-checkpoint.json');

  // ── STEP E: bridgeOutV1 ──
  console.log('\n📋 STEP E: bridgeOutV1');
  await baseWP.callStatic.bridgeOutV1(withdrawProofBytes, sourceMessage, ethers.constants.AddressZero, { gasLimit: 3000000 });
  const bridgeOutTx = await baseWP.bridgeOutV1(withdrawProofBytes, sourceMessage, ethers.constants.AddressZero, BASE_LOW_GAS_OVERRIDES);
  const bridgeOutReceipt = await bridgeOutTx.wait();
  console.log('✅ bridgeOutV1 tx:', bridgeOutTx.hash);
  console.log('  Gas used:', bridgeOutReceipt.gasUsed.toString());
  console.log('  BridgeOut block:', bridgeOutReceipt.blockNumber);
  const finalityReceipt = await provider.waitForTransaction(bridgeOutTx.hash, 2);
  console.log('  Finality confirmations:', finalityReceipt.confirmations);

  const wpIface = new ethers.utils.Interface(WHITEPROTOCOL_ABI);
  const bridgeOutEvent = bridgeOutReceipt.logs
    .map((log: any) => { try { return wpIface.parseLog(log); } catch { return null; } })
    .find((e: any) => e && e.name === 'BridgeOut');

  if (!bridgeOutEvent) {
    throw new Error('BridgeOut event not found');
  }
  console.log('  BridgeOut event:');
  console.log('    nullifierHash:', bridgeOutEvent.args.nullifierHash);
  console.log('    messageHash:', bridgeOutEvent.args.messageHash);
  if (bridgeOutEvent.args.messageHash.toLowerCase() !== sourceMessageHash.toLowerCase()) {
    throw new Error(
      `BridgeOut event hash mismatch: event=${bridgeOutEvent.args.messageHash}, expected=${sourceMessageHash}`
    );
  }

  // Verify nullifier spent
  const isSpent = await baseWP.isSpent(nullifierHash);
  console.log('  Source nullifier spent:', isSpent);

  // ── STEP F: Threshold Signatures ──
  console.log('\n📋 STEP F: Threshold Signatures');
  const bridgeMintMessageHashBytes = Buffer.from(bridgeMintMessageHash.slice(2), 'hex');
  const thresholdSigners = getSortedThresholdSignerWallets();

  const signatures = thresholdSigners.map((signerWallet) => {
    const wallet = signerWallet;
    const sig = wallet._signingKey().signDigest(bridgeMintMessageHashBytes);
    // Convert to 65-byte r||s||v format (v = 27 or 28)
    const r = Buffer.from(sig.r.slice(2), 'hex');
    const s = Buffer.from(sig.s.slice(2), 'hex');
    const v = Buffer.from([sig.recoveryParam + 27]);
    return Array.from(Buffer.concat([r, s, v]));
  });

  console.log('✅ Generated', signatures.length, 'threshold signatures');
  console.log('  Signed hash:', bridgeMintMessageHash);
  console.log('  Signer addresses:', thresholdSigners.map((s) => s.address).join(', '));

  // ── Save state for Solana ──
  const bridgeMintMessageForJson = Object.fromEntries(
    Object.entries(bridgeMintMessage).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
  );
  const sourceMessageForJson = Object.fromEntries(
    Object.entries(sourceMessage).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
  );

  const output = {
    baseWhiteProtocol: baseWP.address,
    baseBridgeOutbox: bridgeOutboxAddress,
    deployer: wallet.address,
    depositTx: depositTx.hash,
    settleTx: settleTx.hash,
    bridgeOutTx: bridgeOutTx.hash,
    bridgeOutBlockNumber: bridgeOutReceipt.blockNumber,
    bridgeOutFinalityBlock: bridgeOutReceipt.blockNumber + 1,
    sourceMessage: sourceMessageForJson,
    sourceMessageHash,
    bridgeMintMessage: bridgeMintMessageForJson,
    bridgeMintMessageHash,
    message: sourceMessageForJson,
    messageHash: sourceMessageHash,
    signatures,
    signerAddresses: thresholdSigners.map((s) => s.address),
    signerSetVersion: SOLANA_SIGNER_SET_VERSION,
    destSecret: destSecret.toString(),
    destNullifier: destNullifier.toString(),
    destCommitment: destCommitment.toString(),
    solanaAssetId: SOLANA_ASSET_ID.toString(),
    amount: destinationAmount.toString(),
    sourceAmount: sourceAmount.toString(),
    destinationAmount: destinationAmount.toString(),
    destAmount: destinationAmount.toString(),
    sourceDecimals: SOURCE_DECIMALS,
    destinationDecimals: DESTINATION_DECIMALS,
    normalizationMode: NORMALIZATION_MODE,
    manualMessageEditUsed: false,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync('test/base-to-solana-bridge-state.json', JSON.stringify(output, null, 2));
  fs.writeFileSync('test/base-to-solana-bridge-state-v2.json', JSON.stringify(output, null, 2));
  console.log('\n✅ State saved to: test/base-to-solana-bridge-state.json');
  console.log('✅ State saved to: test/base-to-solana-bridge-state-v2.json');
  console.log('Run Solana side next.');
}

main().catch((e) => { console.error(e); process.exit(1); });
