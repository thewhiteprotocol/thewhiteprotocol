/**
 * PR-010Z: Solana Devnet -> Base Sepolia private bridge E2E.
 *
 * This runner uses the PR-010Y source-bound Solana bridge-out instruction:
 *   bridge_out_v1_with_proof
 *
 * It intentionally does not use init_bridge_v1_out.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";

const { ethers } = require("ethers");
// @ts-ignore
const snarkjs = require("snarkjs");

import {
  BridgeMessageType,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  encodeBridgeMessageV1,
  formatProofForOnChain,
  hashBridgeMessageV1,
  pubkeyToScalar,
  type BridgeMessageV1,
} from "@thewhiteprotocol/core";
import {
  computePath as computeEvmPath,
  computeRootFromPath as computeEvmRootFromPath,
  getTreeState as getEvmTreeState,
} from "../../evm/test/helpers/tree-state";

const SOLANA_RPC_URL = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const idlPath = process.env.IDL_PATH || "target/idl/white_protocol.json";
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || idl.address);
const WALLET_PATH =
  process.env.ANCHOR_WALLET || "/workspaces/thewhiteprotocol/devnet-deployer.json";

const EVM_ENV_PATH = path.resolve(__dirname, "../../evm/.env");
const BRIDGE_SIGNERS_ENV_PATH = path.resolve(__dirname, "../../evm/.bridge-signers.env");
const BASE_DEPLOYMENT_PATH = path.resolve(__dirname, "../../evm/deployments/base-sepolia.json");
const RESULT_PATH = process.env.PR010Z_RESULT_PATH || "/tmp/pr010z-solana-to-base-result.json";
const SOURCE_ONLY = process.env.PR012Z_SOURCE_ONLY === "true";
const SOURCE_FIXTURE_PATH_TEMPLATE =
  process.env.BRIDGE_SOLANA_SOURCE_FIXTURE_PATH ||
  process.env.PR012Z_SOURCE_FIXTURE_PATH ||
  "/tmp/pr012z-solana-to-base-source-fixture.json";
const SOURCE_FIXTURE_DIR = process.env.BRIDGE_SOLANA_SOURCE_FIXTURE_DIR;
const SOURCE_PROGRESS_PATH =
  process.env.BRIDGE_SOLANA_SOURCE_PROGRESS_PATH ||
  process.env.PR012Z_SOURCE_PROGRESS_PATH ||
  (SOURCE_FIXTURE_DIR
    ? path.join(SOURCE_FIXTURE_DIR, "solana-to-base-source-progress-active.json")
    : "/tmp/pr012z-solana-to-base-source-progress-active.json");
const SOURCE_FORCE_NEW =
  process.env.BRIDGE_SOLANA_SOURCE_FORCE_NEW === "true" ||
  process.env.PR012Z_FORCE_NEW === "true";
const SOURCE_SETTLE_PREEXISTING =
  process.env.BRIDGE_SOLANA_SOURCE_SETTLE_PREEXISTING === "true" ||
  process.env.PR012Z_SETTLE_PREEXISTING === "true";

const SOLANA_DEVNET_DOMAIN = 0x01000002;
const BASE_SEPOLIA_DOMAIN = 0x02000002;
const SOLANA_CHAIN_ID = 0;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const SOLANA_SOURCE_DECIMALS = 9;
const BASE_DESTINATION_DECIMALS = 18;
const TREE_DEPTH = 20;
const TEST_AMOUNT = BigInt(process.env.PR010Z_AMOUNT || "1000000");
const MAX_MESSAGE_AMOUNT = 10_000_000_000_000n;
const DAILY_CAP = 100_000_000_000_000n;
const THRESHOLD = 2;
const BASE_NATIVE_ASSET_ID_HEX =
  process.env.PR012Z_BASE_ASSET_ID ||
  "0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70";
const BN254_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const CIRCUIT_BASE = path.resolve(__dirname, "../../../circuits");
const DEPOSIT_WASM = path.join(CIRCUIT_BASE, "deposit/build/deposit_js/deposit.wasm");
const DEPOSIT_ZKEY = path.join(CIRCUIT_BASE, "deposit/build/deposit.zkey");
const WITHDRAW_WASM = path.join(CIRCUIT_BASE, "withdraw/build/withdraw_js/withdraw.wasm");
const WITHDRAW_ZKEY = path.join(CIRCUIT_BASE, "withdraw/build/withdraw.zkey");
const MERKLE_BATCH_WASM = path.join(
  CIRCUIT_BASE,
  "merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm"
);
const MERKLE_BATCH_ZKEY = path.join(
  CIRCUIT_BASE,
  "merkle_batch_update/build/merkle_batch_update.zkey"
);

const WHITEPROTOCOL_ABI = [
  "function bridge() view returns (address)",
  "function bridgeOutbox() view returns (address)",
  "function getLastRoot() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
  "function filledSubtrees(uint256) view returns (uint256)",
  "function zeros(uint256) view returns (uint256)",
  "function bridgeIncoming(address) view returns (uint256)",
  "function withdraw(bytes calldata proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external",
];

const BRIDGE_INBOX_ABI = [
  "function acceptBridgeMint(tuple(uint16 protocolVersion, uint8 messageType, uint32 sourceDomain, uint32 destinationDomain, uint64 sourceChainId, uint64 destinationChainId, bytes32 canonicalAssetId, bytes32 sourceLocalAssetId, bytes32 destinationLocalAssetId, uint128 amount, bytes32 sourceNullifierHash, bytes32 destinationCommitment, bytes32 sourceRoot, uint64 sourceLeafIndex, bytes32 sourceTxHash, uint64 sourceBlockNumber, uint64 sourceFinalityBlock, uint64 nonce, uint64 deadline, uint128 relayerFee, bytes32 recipientStealthMetadataHash, bytes32 memoHash, bytes32 reserved0, bytes32 reserved1) calldata message, bytes[] calldata signatures, uint256 signerSetVersion) external",
  "function isMessageConsumed(bytes32 messageHash) view returns (bool)",
  "function currentSignerSetVersion() view returns (uint256)",
  "function globalPaused() view returns (bool)",
  "function isRouteEnabled(uint32) view returns (bool)",
  "function isRoutePaused(uint32,uint32) view returns (bool)",
  "function isAssetSupported(bytes32) view returns (bool)",
  "function isLocalAssetSet(bytes32) view returns (bool)",
  "function canonicalToLocalAsset(bytes32) view returns (address)",
  "function maxMessageAmount(bytes32) view returns (uint128)",
  "event BridgeMintAccepted(bytes32 indexed messageHash, bytes32 indexed destinationCommitment, bytes32 indexed canonicalAssetId, uint128 amount, uint64 nonce)",
];

const ASSET_REGISTRY_ABI = [
  "function getAssetId(address asset) external view returns (bytes32)",
];

interface Evidence {
  [key: string]: unknown;
}

let poseidon: any;
let F: any;

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bn(value: bigint | number | string): anchor.BN {
  return new anchor.BN(value.toString());
}

function u32Le(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function encodeU16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function encodeU32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function encodeU64(value: number | bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function encodeU128(value: bigint): Buffer {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(value >> 64n, 8);
  return out;
}

function encodeVecU8(data: number[]): Buffer {
  return Buffer.concat([encodeU32(data.length), Buffer.from(data)]);
}

function instructionDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function bytes32Hex(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

function bigintToBytes32(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function bytes32ToBigInt(bytes: Uint8Array | number[]): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function hexToBytes32Array(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`expected bytes32 hex, got ${hex}`);
  }
  return Array.from(Buffer.from(clean, "hex"));
}

function randomFieldElement(): bigint {
  let value = 0n;
  for (const byte of randomBytes(31)) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

async function initPoseidon(): Promise<void> {
  const circomlibjs = await import("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((x) => F.e(x)));
  return BigInt(F.toString(hash));
}

function computeCommitment(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint): bigint {
  return poseidonHash([secret, nullifier, amount, assetId]);
}

function computeNullifierHash(nullifier: bigint, secret: bigint, leafIndex: number): bigint {
  const inner = poseidonHash([nullifier, secret]);
  return poseidonHash([inner, BigInt(leafIndex)]);
}

function serializeProofForSolana(proof: any): number[] {
  return Array.from(formatProofForOnChain(proof, "solana"));
}

async function formatProofForEvm(proof: any, publicSignals: any[]): Promise<string> {
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const parsed = JSON.parse("[" + calldata.replace(/\(/g, "[").replace(/\)/g, "]") + "]");
  const a = parsed[0];
  const b = parsed[1];
  const c = parsed[2];
  const flatProof = [
    BigInt(a[0]),
    BigInt(a[1]),
    BigInt(b[0][0]),
    BigInt(b[0][1]),
    BigInt(b[1][0]),
    BigInt(b[1][1]),
    BigInt(c[0]),
    BigInt(c[1]),
  ];
  return new ethers.utils.AbiCoder().encode(["uint256[8]"], [flatProof]);
}

function encodeBridgeMessageForAnchor(msg: BridgeMessageV1): Buffer {
  return Buffer.concat([
    encodeU16(msg.protocolVersion),
    Buffer.from([msg.messageType]),
    encodeU32(msg.sourceDomain),
    encodeU32(msg.destinationDomain),
    encodeU64(msg.sourceChainId),
    encodeU64(msg.destinationChainId),
    Buffer.from(hexToBytes32Array(msg.canonicalAssetId)),
    Buffer.from(hexToBytes32Array(msg.sourceLocalAssetId)),
    Buffer.from(hexToBytes32Array(msg.destinationLocalAssetId)),
    encodeU128(msg.amount),
    Buffer.from(hexToBytes32Array(msg.sourceNullifierHash)),
    Buffer.from(hexToBytes32Array(msg.destinationCommitment)),
    Buffer.from(hexToBytes32Array(msg.sourceRoot)),
    encodeU64(msg.sourceLeafIndex),
    Buffer.from(hexToBytes32Array(msg.sourceTxHash)),
    encodeU64(msg.sourceBlockNumber),
    encodeU64(msg.sourceFinalityBlock),
    encodeU64(msg.nonce),
    encodeU64(msg.deadline),
    encodeU128(msg.relayerFee),
    Buffer.from(hexToBytes32Array(msg.recipientStealthMetadataHash)),
    Buffer.from(hexToBytes32Array(msg.memoHash)),
    Buffer.from(hexToBytes32Array(msg.reserved0)),
    Buffer.from(hexToBytes32Array(msg.reserved1)),
  ]);
}

function toAnchorBridgeMessage(msg: BridgeMessageV1): any {
  return {
    protocolVersion: msg.protocolVersion,
    messageType: msg.messageType,
    sourceDomain: msg.sourceDomain,
    destinationDomain: msg.destinationDomain,
    sourceChainId: bn(msg.sourceChainId),
    destinationChainId: bn(msg.destinationChainId),
    canonicalAssetId: hexToBytes32Array(msg.canonicalAssetId),
    sourceLocalAssetId: hexToBytes32Array(msg.sourceLocalAssetId),
    destinationLocalAssetId: hexToBytes32Array(msg.destinationLocalAssetId),
    amount: bn(msg.amount),
    sourceNullifierHash: hexToBytes32Array(msg.sourceNullifierHash),
    destinationCommitment: hexToBytes32Array(msg.destinationCommitment),
    sourceRoot: hexToBytes32Array(msg.sourceRoot),
    sourceLeafIndex: bn(msg.sourceLeafIndex),
    sourceTxHash: hexToBytes32Array(msg.sourceTxHash),
    sourceBlockNumber: bn(msg.sourceBlockNumber),
    sourceFinalityBlock: bn(msg.sourceFinalityBlock),
    nonce: bn(msg.nonce),
    deadline: bn(msg.deadline),
    relayerFee: bn(msg.relayerFee),
    recipientStealthMetadataHash: hexToBytes32Array(msg.recipientStealthMetadataHash),
    memoHash: hexToBytes32Array(msg.memoHash),
    reserved0: hexToBytes32Array(msg.reserved0),
    reserved1: hexToBytes32Array(msg.reserved1),
  };
}

function buildBridgeOutWithProofIx(params: {
  message: BridgeMessageV1;
  proof: number[];
  merkleRoot: Buffer;
  nullifierHash: Buffer;
  amount: bigint;
  assetId: Buffer;
  publicDataHash: Buffer;
  accounts: {
    payer: PublicKey;
    bridgeV1Config: PublicKey;
    routeConfig: PublicKey;
    assetConfig: PublicKey;
    outboundMessage: PublicKey;
    poolConfig: PublicKey;
    merkleTree: PublicKey;
    vkAccount: PublicKey;
    assetVault: PublicKey;
    vaultTokenAccount: PublicKey;
    bridgeCustodyTokenAccount: PublicKey;
    spentNullifier: PublicKey;
  };
}): TransactionInstruction {
  const data = Buffer.concat([
    instructionDiscriminator("bridge_out_v1_with_proof"),
    encodeBridgeMessageForAnchor(params.message),
    encodeVecU8(params.proof),
    params.merkleRoot,
    params.nullifierHash,
    encodeU64(params.amount),
    params.assetId,
    params.publicDataHash,
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.accounts.payer, isSigner: true, isWritable: true },
      { pubkey: params.accounts.bridgeV1Config, isSigner: false, isWritable: true },
      { pubkey: params.accounts.routeConfig, isSigner: false, isWritable: true },
      { pubkey: params.accounts.assetConfig, isSigner: false, isWritable: true },
      { pubkey: params.accounts.outboundMessage, isSigner: false, isWritable: true },
      { pubkey: params.accounts.poolConfig, isSigner: false, isWritable: true },
      { pubkey: params.accounts.merkleTree, isSigner: false, isWritable: false },
      { pubkey: params.accounts.vkAccount, isSigner: false, isWritable: false },
      { pubkey: params.accounts.assetVault, isSigner: false, isWritable: true },
      { pubkey: params.accounts.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.accounts.bridgeCustodyTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.accounts.spentNullifier, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildMessage(params: {
  sourceAssetIdHex: string;
  baseAssetIdHex: string;
  amount: bigint;
  sourceNullifierHash: string;
  destinationCommitment: string;
  sourceRoot: string;
  sourceLeafIndex: number;
  nonce: number;
  deadline: number;
}): BridgeMessageV1 {
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: SOLANA_DEVNET_DOMAIN,
    destinationDomain: BASE_SEPOLIA_DOMAIN,
    sourceChainId: SOLANA_CHAIN_ID,
    destinationChainId: BASE_SEPOLIA_CHAIN_ID,
    canonicalAssetId: params.sourceAssetIdHex,
    sourceLocalAssetId: params.sourceAssetIdHex,
    destinationLocalAssetId: params.baseAssetIdHex,
    amount: params.amount,
    sourceNullifierHash: params.sourceNullifierHash,
    destinationCommitment: params.destinationCommitment,
    sourceRoot: params.sourceRoot,
    sourceLeafIndex: params.sourceLeafIndex,
    sourceTxHash: "0x" + "00".repeat(32),
    sourceBlockNumber: 0,
    sourceFinalityBlock: 0,
    nonce: params.nonce,
    deadline: params.deadline,
    relayerFee: 0n,
    recipientStealthMetadataHash: "0x" + "00".repeat(32),
    memoHash: "0x" + "00".repeat(32),
    reserved0: "0x" + "00".repeat(32),
    reserved1: "0x" + "00".repeat(32),
  };
}

function fieldValidMessage(params: Omit<Parameters<typeof buildMessage>[0], "nonce">): {
  message: BridgeMessageV1;
  messageHashHex: string;
  messageHashBytes: Buffer;
} {
  const start = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 20_000; i++) {
    const nonce = start + i;
    const message = buildMessage({ ...params, nonce });
    const messageHashHex = hashBridgeMessageV1(message);
    if (BigInt(messageHashHex) < BN254_SCALAR_FIELD) {
      return {
        message,
        messageHashHex,
        messageHashBytes: Buffer.from(messageHashHex.slice(2), "hex"),
      };
    }
  }
  throw new Error("unable to find field-valid BridgeMessageV1 hash");
}

function normalizeSolanaToBaseAmount(sourceAmount: bigint): bigint {
  const scale = 10n ** BigInt(BASE_DESTINATION_DECIMALS - SOLANA_SOURCE_DECIMALS);
  return sourceAmount * scale;
}

function hex(bytes: Uint8Array): string {
  return "0x" + Buffer.from(bytes).toString("hex");
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function sourceFixturePath(sourceMessageHash: string): string {
  if (SOURCE_FIXTURE_DIR) {
    return path.join(
      SOURCE_FIXTURE_DIR,
      `solana-to-base-source-fixture-${sourceMessageHash}.json`
    );
  }
  return SOURCE_FIXTURE_PATH_TEMPLATE
    .replace("<sourceMessageHash>", sourceMessageHash)
    .replace("{sourceMessageHash}", sourceMessageHash);
}

function requiredSourceArtifacts(): string[] {
  return [
    DEPOSIT_WASM,
    DEPOSIT_ZKEY,
    MERKLE_BATCH_WASM,
    MERKLE_BATCH_ZKEY,
    WITHDRAW_WASM,
    WITHDRAW_ZKEY,
  ];
}

function assertSourceArtifactsPresent(): void {
  const missing = requiredSourceArtifacts().filter((artifactPath) => !fs.existsSync(artifactPath));
  if (missing.length === 0) return;
  throw new Error(
    [
      "missing_source_fixture_artifacts",
      ...missing.map((artifactPath) => `missing=${artifactPath}`),
      "Run hosted zkey bootstrap and create the root circuit links before generating a source fixture.",
      "Do this before retrying so the runner does not submit partial source-side transactions.",
    ].join("; ")
  );
}

function loadSourceProgress(): any | null {
  if (!SOURCE_ONLY || SOURCE_FORCE_NEW || !fs.existsSync(SOURCE_PROGRESS_PATH)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(SOURCE_PROGRESS_PATH, "utf8"));
  if (parsed?.schema !== "white-bridge-solana-source-progress-v1") {
    throw new Error(`unexpected source progress schema at ${SOURCE_PROGRESS_PATH}`);
  }
  if (parsed.destinationTxSubmitted === true) {
    throw new Error("source progress unexpectedly indicates destination submit");
  }
  return parsed;
}

function writeSourceProgress(progress: any): void {
  if (!SOURCE_ONLY) return;
  fs.mkdirSync(path.dirname(SOURCE_PROGRESS_PATH), { recursive: true });
  const next = {
    schema: "white-bridge-solana-source-progress-v1",
    private: true,
    warning: "contains private source/destination note material; do not print, commit, or share",
    destinationTxSubmitted: false,
    ...progress,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(SOURCE_PROGRESS_PATH, JSON.stringify(next, jsonReplacer, 2), { mode: 0o600 });
  try {
    fs.chmodSync(SOURCE_PROGRESS_PATH, 0o600);
  } catch {
    // Best effort on hosted filesystems.
  }
}

function restoreSourceSettle(saved: any): {
  tx: string;
  oldRoot: bigint;
  newRoot: bigint;
  leafIndex: number;
  commitment: bigint;
  pathElements: bigint[];
  pathIndices: number[];
} {
  return {
    tx: String(saved.tx),
    oldRoot: BigInt(saved.oldRoot),
    newRoot: BigInt(saved.newRoot),
    leafIndex: Number(saved.leafIndex),
    commitment: BigInt(saved.commitment),
    pathElements: (saved.pathElements || []).map((value: string) => BigInt(value)),
    pathIndices: (saved.pathIndices || []).map((value: number) => Number(value)),
  };
}

function serializeSourceSettle(settle: {
  tx: string;
  oldRoot: bigint;
  newRoot: bigint;
  leafIndex: number;
  commitment: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}): any {
  return {
    tx: settle.tx,
    oldRoot: settle.oldRoot.toString(),
    newRoot: settle.newRoot.toString(),
    leafIndex: settle.leafIndex,
    commitment: settle.commitment.toString(),
    pathElements: settle.pathElements.map((value) => value.toString()),
    pathIndices: settle.pathIndices,
  };
}

function loadSignerKeys(): string[] {
  const keys = [
    process.env.BRIDGE_SIGNER_1_PRIVATE_KEY,
    process.env.BRIDGE_SIGNER_2_PRIVATE_KEY,
    process.env.BRIDGE_SIGNER_3_PRIVATE_KEY,
  ].filter(Boolean) as string[];
  if (keys.length < THRESHOLD) {
    throw new Error("At least two bridge signer keys are required");
  }
  return keys;
}

function sortedThresholdSignatures(messageHash: string): {
  signatures: string[];
  signerAddresses: string[];
} {
  const signed = loadSignerKeys()
    .map((privateKey) => {
      const signingKey = new ethers.utils.SigningKey(privateKey);
      const sig = signingKey.signDigest(messageHash);
      const packed = sig.r + sig.s.slice(2) + (sig.recoveryParam + 27).toString(16).padStart(2, "0");
      const address = ethers.utils.recoverAddress(messageHash, packed);
      return { address, signature: packed };
    })
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));

  return {
    signatures: signed.slice(0, THRESHOLD).map((s) => s.signature),
    signerAddresses: signed.slice(0, THRESHOLD).map((s) => s.address),
  };
}

function pendingCount(pendingData: any): number {
  if (pendingData.totalPending !== undefined) {
    return Number(pendingData.totalPending);
  }
  return pendingData.deposits?.length || 0;
}

async function tokenAmount(connection: Connection, tokenAccount: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAccount, "confirmed");
  if (!info) return 0n;
  const balance = await connection.getTokenAccountBalance(tokenAccount);
  return BigInt(balance.value.amount);
}

async function ensureAta(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  if (await connection.getAccountInfo(ata, "confirmed")) {
    return ata;
  }
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  console.log("Created ATA:", sig);
  return ata;
}

async function sendIx(
  connection: Connection,
  authority: Keypair,
  label: string,
  ix: TransactionInstruction,
  computeUnits = 500_000
): Promise<string> {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ix
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: "confirmed",
  });
  console.log(`${label}: ${sig}`);
  return sig;
}

async function createLookupTable(
  connection: Connection,
  authority: Keypair,
  addresses: PublicKey[]
): Promise<AddressLookupTableAccount> {
  const currentSlot = await connection.getSlot("confirmed");
  let lookupTableAddress: PublicKey | null = null;
  let lookupTable: AddressLookupTableAccount | null = null;

  for (const offset of [1, 2, 4, 8, 16, 32]) {
    const [createIx, candidate] = AddressLookupTableProgram.createLookupTable({
      authority: authority.publicKey,
      payer: authority.publicKey,
      recentSlot: Math.max(0, currentSlot - offset),
    });
    try {
      await sendAndConfirmTransaction(connection, new Transaction().add(createIx), [authority], {
        commitment: "confirmed",
      });
      lookupTableAddress = candidate;
      for (let attempt = 0; attempt < 12; attempt++) {
        const fetched = await connection.getAddressLookupTable(candidate, {
          commitment: "confirmed",
        });
        if (fetched.value) {
          lookupTable = fetched.value;
          break;
        }
        await sleep(750);
      }
      if (lookupTable) break;
    } catch (error: any) {
      if (!String(error?.message ?? error).includes("not a recent slot")) {
        throw error;
      }
    }
  }

  if (!lookupTableAddress || !lookupTable) {
    throw new Error("failed to create source lookup table");
  }

  const unique = Array.from(new Map(addresses.map((address) => [address.toBase58(), address])).values());
  for (let i = 0; i < unique.length; i += 20) {
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      authority: authority.publicKey,
      payer: authority.publicKey,
      lookupTable: lookupTableAddress,
      addresses: unique.slice(i, i + 20),
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(extendIx), [authority], {
      commitment: "confirmed",
    });
  }

  await sleep(1200);
  const lookup = await connection.getAddressLookupTable(lookupTableAddress);
  if (!lookup.value) throw new Error("failed to fetch source lookup table");
  return lookup.value;
}

async function sendV0Ix(
  connection: Connection,
  authority: Keypair,
  lookupTable: AddressLookupTableAccount,
  label: string,
  ix: TransactionInstruction
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }), ix],
  }).compileToV0Message([lookupTable]);
  const tx = new VersionedTransaction(messageV0);
  tx.sign([authority]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  console.log(`${label}: ${sig}`);
  return sig;
}

async function waitForSolanaFinality(
  connection: Connection,
  tx: string,
  minimumConfirmations: number
): Promise<{ slot: number; finalizedSlot: number; confirmations: number }> {
  let txSlot: number | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await connection.getTransaction(tx, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (info?.slot !== undefined) {
      txSlot = info.slot;
      break;
    }
    await sleep(750);
  }
  if (txSlot === null) {
    txSlot = await connection.getSlot("confirmed");
  }

  let finalizedSlot = await connection.getSlot("finalized");
  for (let attempt = 0; attempt < 90 && finalizedSlot - txSlot < minimumConfirmations; attempt++) {
    await sleep(1000);
    finalizedSlot = await connection.getSlot("finalized");
  }

  return {
    slot: txSlot,
    finalizedSlot,
    confirmations: Math.max(0, finalizedSlot - txSlot),
  };
}

async function settleFirstPending(params: {
  program: anchor.Program;
  connection: Connection;
  authority: Keypair;
  poolConfig: PublicKey;
  merkleTree: PublicKey;
  pendingBuffer: PublicKey;
  batchVk: PublicKey;
  expectedCommitment?: bigint;
}): Promise<{
  tx: string;
  oldRoot: bigint;
  newRoot: bigint;
  leafIndex: number;
  commitment: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}> {
  const pendingData = await (params.program.account as any).pendingDepositsBuffer.fetch(params.pendingBuffer);
  if (pendingCount(pendingData) === 0) {
    throw new Error("pending buffer is empty");
  }
  const commitment = bytes32ToBigInt(pendingData.deposits[0].commitment);
  if (params.expectedCommitment !== undefined && commitment !== params.expectedCommitment) {
    throw new Error("first pending commitment does not match expected source commitment");
  }

  const merkleData = await (params.program.account as any).merkleTree.fetch(params.merkleTree);
  const oldRoot = bytes32ToBigInt(merkleData.currentRoot);
  const startIndex = Number(merkleData.nextLeafIndex);
  const zeros: bigint[] = [];
  for (let i = 0; i <= TREE_DEPTH; i++) {
    zeros.push(bytes32ToBigInt(merkleData.zeros[i]));
  }

  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let current = commitment;
  let currentIndex = startIndex;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const isRight = (currentIndex & 1) === 1;
    const sibling = isRight ? bytes32ToBigInt(merkleData.filledSubtrees[level]) : zeros[level];
    pathElements.push(sibling);
    pathIndices.push(isRight ? 1 : 0);
    current = isRight ? poseidonHash([sibling, current]) : poseidonHash([current, sibling]);
    currentIndex >>= 1;
  }
  const newRoot = current;

  const digest = createHash("sha256")
    .update(Buffer.from(commitment.toString(16).padStart(64, "0"), "hex"))
    .digest();
  digest[0] &= 0x1f;
  const commitmentsHash = BigInt("0x" + digest.toString("hex"));

  const { proof } = await snarkjs.groth16.fullProve(
    {
      oldRoot: oldRoot.toString(),
      newRoot: newRoot.toString(),
      startIndex,
      batchSize: 1,
      commitmentsHash: commitmentsHash.toString(),
      commitments: [commitment.toString()],
      pathElements: [pathElements.map((p) => p.toString())],
    },
    MERKLE_BATCH_WASM,
    MERKLE_BATCH_ZKEY
  );

  const tx = await sendIx(
    params.connection,
    params.authority,
    "settle_deposits_batch",
    await params.program.methods
      .settleDepositsBatch({
        proof: serializeProofForSolana(proof),
        newRoot: Array.from(bigintToBytes32(newRoot)),
        batchSize: 1,
      })
      .accounts({
        authority: params.authority.publicKey,
        poolConfig: params.poolConfig,
        merkleTree: params.merkleTree,
        pendingBuffer: params.pendingBuffer,
        verificationKey: params.batchVk,
      })
      .instruction()
  );

  return {
    tx,
    oldRoot,
    newRoot,
    leafIndex: startIndex,
    commitment,
    pathElements,
    pathIndices,
  };
}

async function main(): Promise<void> {
  if (!SOURCE_ONLY) {
    loadEnvFile(EVM_ENV_PATH);
    loadEnvFile(BRIDGE_SIGNERS_ENV_PATH);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(SOURCE_ONLY
    ? "  PR-012Z: Solana Devnet -> Base Sepolia source event fixture"
    : "  PR-010Z: Solana Devnet -> Base Sepolia private bridge E2E");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const evidence: Evidence = {
    programId: PROGRAM_ID.toBase58(),
    mode: SOURCE_ONLY ? "source_only_fixture" : "full_e2e",
    solanaRpcConfigured: Boolean(SOLANA_RPC_URL),
    testAmount: TEST_AMOUNT.toString(),
    resultPath: RESULT_PATH,
  };
  if (!SOURCE_ONLY) {
    evidence.solanaRpc = SOLANA_RPC_URL;
  } else {
    assertSourceArtifactsPresent();
    evidence.sourceProgressPath = SOURCE_PROGRESS_PATH;
    evidence.sourceProgressResumeEnabled = !SOURCE_FORCE_NEW;
    console.log("Source fixture progress path:", SOURCE_PROGRESS_PATH);
    console.log("Source fixture memory note: run proof generation outside the live 2GB web service.");
  }

  await initPoseidon();

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")))
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  (idl as any).address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as any, provider);

  const solBalance = await connection.getBalance(authority.publicKey, "confirmed");
  console.log("Solana authority:", authority.publicKey.toBase58());
  console.log("Solana balance:", solBalance / LAMPORTS_PER_SOL, "SOL");
  if (solBalance < 2 * LAMPORTS_PER_SOL) {
    throw new Error("Solana devnet authority has insufficient SOL for PR-010Z");
  }
  evidence.solanaAuthority = authority.publicKey.toBase58();
  evidence.solanaBalanceSol = solBalance / LAMPORTS_PER_SOL;

  const baseArtifact = JSON.parse(fs.readFileSync(BASE_DEPLOYMENT_PATH, "utf8"));
  let baseProvider: any;
  let baseWallet: any;
  let bridgeInbox: any;
  let baseWP: any;
  let baseNativeAssetIdHex = BASE_NATIVE_ASSET_ID_HEX;
  let baseNativeAssetId = BigInt(baseNativeAssetIdHex);

  if (!SOURCE_ONLY) {
    const baseRpc = process.env.BASE_SEPOLIA_RPC_URL || "https://base-sepolia-rpc.publicnode.com";
    const deployerKey =
      process.env.DEPLOYER_PRIVATE_KEY ||
      process.env.BASE_DEPLOYER_PRIVATE_KEY ||
      process.env.EVM_DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) throw new Error("Base deployer private key env is required");
    baseProvider = new ethers.providers.JsonRpcProvider(baseRpc);
    baseWallet = new ethers.Wallet(deployerKey, baseProvider);
    bridgeInbox = new ethers.Contract(baseArtifact.bridgeV1.BridgeInbox, BRIDGE_INBOX_ABI, baseWallet);
    baseWP = new ethers.Contract(baseArtifact.contracts.WhiteProtocol, WHITEPROTOCOL_ABI, baseWallet);
    const baseRegistry = new ethers.Contract(baseArtifact.contracts.AssetRegistry, ASSET_REGISTRY_ABI, baseProvider);
    baseNativeAssetIdHex = await baseRegistry.getAssetId(ethers.constants.AddressZero);
    baseNativeAssetId = BigInt(baseNativeAssetIdHex);

    console.log("Base deployer:", baseWallet.address);
    console.log("Base BridgeInbox:", bridgeInbox.address);
    console.log("Base WhiteProtocol:", baseWP.address);
    evidence.baseDeployer = baseWallet.address;
    evidence.baseBridgeInbox = bridgeInbox.address;
    evidence.baseWhiteProtocol = baseWP.address;
  } else {
    evidence.baseBridgeInbox = baseArtifact.bridgeV1.BridgeInbox;
  }
  evidence.baseNativeAssetId = baseNativeAssetIdHex;

  const { deriveAssetId } = await import("../sdk/src/crypto/keccak");
  const sourceAssetIdBytes = Buffer.from(deriveAssetId(NATIVE_MINT));
  const sourceAssetIdHex = "0x" + sourceAssetIdBytes.toString("hex");
  const sourceAssetId = BigInt(sourceAssetIdHex);
  evidence.solanaSourceAssetId = sourceAssetIdHex;

  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("white_pool"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [depositVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_deposit"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [withdrawVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [batchVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolConfig.toBuffer(), sourceAssetIdBytes],
    PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), assetVault.toBuffer()],
    PROGRAM_ID
  );
  const [bridgeV1Config] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_v1_config")],
    PROGRAM_ID
  );
  const [routeConfigOutbound] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_route"), u32Le(SOLANA_DEVNET_DOMAIN), u32Le(BASE_SEPOLIA_DOMAIN)],
    PROGRAM_ID
  );
  const [assetConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_asset"), sourceAssetIdBytes],
    PROGRAM_ID
  );

  const bridgeCustodyTokenAccount = await ensureAta(
    connection,
    authority,
    authority.publicKey,
    NATIVE_MINT
  );

  evidence.poolConfig = poolConfig.toBase58();
  evidence.merkleTree = merkleTree.toBase58();
  evidence.pendingBuffer = pendingBuffer.toBase58();
  evidence.assetVault = assetVault.toBase58();
  evidence.vaultTokenAccount = vaultTokenAccount.toBase58();
  evidence.bridgeV1Config = bridgeV1Config.toBase58();
  evidence.routeConfigOutbound = routeConfigOutbound.toBase58();
  evidence.assetConfig = assetConfig.toBase58();
  evidence.bridgeCustodyTokenAccount = bridgeCustodyTokenAccount.toBase58();

  const bridgeConfigData = await (program.account as any).bridgeV1Config.fetch(bridgeV1Config);
  if (Number(bridgeConfigData.domainId) !== SOLANA_DEVNET_DOMAIN) {
    throw new Error(`Unexpected Solana bridge domain: ${bridgeConfigData.domainId}`);
  }
  if (bridgeConfigData.globalPaused) {
    throw new Error("Solana BridgeV1Config is globally paused");
  }

  const currentSignerSetVersion = Number(bridgeConfigData.signerSetVersion);
  let solanaSignerSetVersion = currentSignerSetVersion;
  if (!SOURCE_ONLY) {
    const signerAddresses = sortedThresholdSignatures("0x" + "00".repeat(32)).signerAddresses;
    const signerBytes = signerAddresses
      .map((addr) => Buffer.from(addr.slice(2), "hex"))
      .sort(Buffer.compare)
      .map((buf) => Array.from(buf));
    const [currentSignerSet] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge_signer_set"), u32Le(currentSignerSetVersion)],
      PROGRAM_ID
    );
    let signerSetMatches = false;
    try {
      const currentSetData = await (program.account as any).bridgeSignerSet.fetch(currentSignerSet);
      const currentSigners = currentSetData.signers
        .slice(0, Number(currentSetData.signerCount))
        .map((s: number[]) => Buffer.from(s).toString("hex"));
      signerSetMatches =
        Number(currentSetData.threshold) === THRESHOLD &&
        currentSigners.join(",") === signerBytes.map((s) => Buffer.from(s).toString("hex")).join(",");
    } catch {
      signerSetMatches = false;
    }
    if (!signerSetMatches) {
      solanaSignerSetVersion = Math.floor(Date.now() / 1000) % 1_000_000_000;
      const [newSignerSet] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_signer_set"), u32Le(solanaSignerSetVersion)],
        PROGRAM_ID
      );
      const tx = await sendIx(
        connection,
        authority,
        "set_bridge_v1_signer_set",
        await program.methods
          .setBridgeV1SignerSet(solanaSignerSetVersion, THRESHOLD, signerBytes)
          .accountsStrict({
            authority: authority.publicKey,
            bridgeV1Config,
            signerSet: newSignerSet,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );
      evidence.solanaSignerSetUpdateTx = tx;
    }
    evidence.thresholdSignerAddresses = signerAddresses;
  }
  evidence.solanaSignerSetVersion = solanaSignerSetVersion;

  if (SOURCE_ONLY) {
    const routeData = await (program.account as any).bridgeRouteConfig.fetch(routeConfigOutbound);
    const assetData = await (program.account as any).bridgeAssetConfig.fetch(assetConfig);
    const routeChecks = {
      enabled: Boolean(routeData.enabled),
      paused: Boolean(routeData.paused),
      sourceDomain: Number(routeData.sourceDomain),
      destinationDomain: Number(routeData.destinationDomain),
      maxMessageAmount: routeData.maxMessageAmount.toString(),
      dailyOutflowCap: routeData.dailyOutflowCap.toString(),
      assetSupported: Boolean(assetData.supported),
      assetMaxMessageAmount: assetData.maxMessageAmount.toString(),
    };
    if (!routeChecks.enabled) throw new Error("Solana -> Base bridge route is not enabled");
    if (routeChecks.paused) throw new Error("Solana -> Base bridge route is paused");
    if (routeChecks.sourceDomain !== SOLANA_DEVNET_DOMAIN) {
      throw new Error("Solana source route domain mismatch");
    }
    if (routeChecks.destinationDomain !== BASE_SEPOLIA_DOMAIN) {
      throw new Error("Solana destination route domain mismatch");
    }
    if (!routeChecks.assetSupported) throw new Error("Solana wSOL bridge asset is not supported");
    if (BigInt(routeChecks.maxMessageAmount) < TEST_AMOUNT) {
      throw new Error("Solana route maxMessageAmount is below test amount");
    }
    if (BigInt(routeChecks.assetMaxMessageAmount) < TEST_AMOUNT) {
      throw new Error("Solana asset maxMessageAmount is below test amount");
    }
    evidence.solanaRouteChecks = routeChecks;
  } else {
    const routeTx = await sendIx(
      connection,
      authority,
      "set_bridge_v1_route_solana_to_base",
      await program.methods
        .setBridgeV1Route(
          SOLANA_DEVNET_DOMAIN,
          BASE_SEPOLIA_DOMAIN,
          true,
          false,
          bn(MAX_MESSAGE_AMOUNT),
          bn(DAILY_CAP),
          bn(DAILY_CAP)
        )
        .accountsStrict({
          authority: authority.publicKey,
          bridgeV1Config,
          routeConfig: routeConfigOutbound,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
    const assetTx = await sendIx(
      connection,
      authority,
      "set_bridge_v1_asset_solana_wsol",
      await program.methods
        .setBridgeV1Asset(Array.from(sourceAssetIdBytes), true, bn(MAX_MESSAGE_AMOUNT), bn(DAILY_CAP))
        .accountsStrict({
          authority: authority.publicKey,
          bridgeV1Config,
          assetConfig,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
    evidence.solanaRouteConfigTx = routeTx;
    evidence.solanaAssetConfigTx = assetTx;

    const baseChecks = {
      globalPaused: await bridgeInbox.globalPaused(),
      routeEnabled: await bridgeInbox.isRouteEnabled(SOLANA_DEVNET_DOMAIN),
      routePaused: await bridgeInbox.isRoutePaused(SOLANA_DEVNET_DOMAIN, BASE_SEPOLIA_DOMAIN),
      assetSupported: await bridgeInbox.isAssetSupported(sourceAssetIdHex),
      localAssetSet: await bridgeInbox.isLocalAssetSet(sourceAssetIdHex),
      localAsset: await bridgeInbox.canonicalToLocalAsset(sourceAssetIdHex),
      maxMessageAmount: (await bridgeInbox.maxMessageAmount(sourceAssetIdHex)).toString(),
      currentSignerSetVersion: (await bridgeInbox.currentSignerSetVersion()).toString(),
    };
    if (baseChecks.globalPaused) throw new Error("Base BridgeInbox is globally paused");
    if (!baseChecks.routeEnabled) throw new Error("Base BridgeInbox Solana route is not enabled");
    if (baseChecks.routePaused) throw new Error("Base BridgeInbox Solana route is paused");
    if (!baseChecks.assetSupported) throw new Error("Base BridgeInbox does not support Solana asset");
    if (!baseChecks.localAssetSet) throw new Error("Base BridgeInbox local asset is not set");
    if (BigInt(baseChecks.maxMessageAmount) < TEST_AMOUNT) {
      throw new Error("Base BridgeInbox maxMessageAmount is below test amount");
    }
    evidence.baseChecks = baseChecks;
  }

  const sourceProgress = loadSourceProgress();
  if (SOURCE_ONLY && sourceProgress) {
    console.log("Resuming source fixture from private progress file.");
    if (sourceProgress.sourceFixturePath && fs.existsSync(sourceProgress.sourceFixturePath)) {
      console.log(JSON.stringify({
        ok: true,
        mode: "source_only_fixture",
        resumed: true,
        status: "fixture_exported",
        solanaDepositTx: sourceProgress.solanaDepositTx || null,
        solanaSettlementTx: sourceProgress.sourceSettle?.tx || null,
        solanaBridgeOutTx: sourceProgress.solanaBridgeOutTx || null,
        sourceSlot: sourceProgress.sourceSlot || null,
        sourceMessageHash: sourceProgress.sourceMessageHash || null,
        destinationBridgeMintHash: sourceProgress.destinationBridgeMintHash || null,
        sourceAmount: sourceProgress.sourceAmount || TEST_AMOUNT.toString(),
        normalizedDestinationAmount: sourceProgress.normalizedDestinationAmount || null,
        sourceNullifierSpent: Boolean(sourceProgress.sourceNullifierSpent),
        sourceValueLocked: Boolean(sourceProgress.sourceValueLocked),
        fixturePath: sourceProgress.sourceFixturePath,
        progressPath: SOURCE_PROGRESS_PATH,
        destinationTxSubmitted: false,
        secretsPrinted: false,
      }, null, 2));
      return;
    }
  }

  let pendingData = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
  const progressHasPendingDeposit =
    SOURCE_ONLY &&
    sourceProgress?.sourceCommitment &&
    sourceProgress?.solanaDepositTx &&
    !sourceProgress?.sourceSettle;
  if (
    SOURCE_ONLY &&
    pendingCount(pendingData) > 0 &&
    !progressHasPendingDeposit &&
    !SOURCE_SETTLE_PREEXISTING
  ) {
    throw new Error(
      "preexisting_pending_deposit_requires_explicit_settle; set BRIDGE_SOLANA_SOURCE_SETTLE_PREEXISTING=true to settle orphaned pending deposits before creating a fresh source fixture"
    );
  }
  while (pendingCount(pendingData) > 0 && !progressHasPendingDeposit) {
    console.log("Settling pre-existing Solana pending deposit...");
    const result = await settleFirstPending({
      program,
      connection,
      authority,
      poolConfig,
      merkleTree,
      pendingBuffer,
      batchVk,
    });
    evidence.lastPreExistingSettleTx = result.tx;
    pendingData = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
  }

  const sourceSecret =
    SOURCE_ONLY && sourceProgress?.sourceSecret && !SOURCE_FORCE_NEW
      ? BigInt(sourceProgress.sourceSecret)
      : randomFieldElement();
  const sourceNullifier =
    SOURCE_ONLY && sourceProgress?.sourceNullifier && !SOURCE_FORCE_NEW
      ? BigInt(sourceProgress.sourceNullifier)
      : randomFieldElement();
  const sourceCommitment = computeCommitment(sourceSecret, sourceNullifier, TEST_AMOUNT, sourceAssetId);
  const sourceCommitmentBytes = bigintToBytes32(sourceCommitment);
  const [commitmentIndex] = PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), poolConfig.toBuffer(), sourceCommitmentBytes],
    PROGRAM_ID
  );
  if (SOURCE_ONLY && sourceProgress?.sourceCommitment && !SOURCE_FORCE_NEW) {
    if (BigInt(sourceProgress.sourceCommitment) !== sourceCommitment) {
      throw new Error("source progress commitment does not match restored note material");
    }
  }

  if (SOURCE_ONLY && !sourceProgress?.sourceSecret) {
    writeSourceProgress({
      status: "source_note_prepared",
      sourceSecret: sourceSecret.toString(),
      sourceNullifier: sourceNullifier.toString(),
      sourceCommitment: sourceCommitment.toString(),
      sourceCommitmentHex: bytes32Hex(sourceCommitment),
      sourceAmount: TEST_AMOUNT.toString(),
      sourceAssetId: sourceAssetIdHex,
    });
  }

  const userTokenAccount = bridgeCustodyTokenAccount;
  let depositTx = SOURCE_ONLY && sourceProgress?.solanaDepositTx && !SOURCE_FORCE_NEW
    ? String(sourceProgress.solanaDepositTx)
    : "";
  if (!depositTx) {
    const { proof: depositProof, publicSignals: depositSignals } = await snarkjs.groth16.fullProve(
      {
        secret: sourceSecret.toString(),
        nullifier: sourceNullifier.toString(),
        amount: TEST_AMOUNT.toString(),
        asset_id: sourceAssetId.toString(),
        commitment: sourceCommitment.toString(),
      },
      DEPOSIT_WASM,
      DEPOSIT_ZKEY
    );
    if (depositSignals[0].toString() !== sourceCommitment.toString()) {
      throw new Error("deposit proof commitment public signal mismatch");
    }

    let wrapSig = SOURCE_ONLY && sourceProgress?.wrapSourceWsolTx && !SOURCE_FORCE_NEW
      ? String(sourceProgress.wrapSourceWsolTx)
      : "";
    if (!wrapSig) {
      const wrapTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: userTokenAccount,
          lamports: Number(TEST_AMOUNT),
        }),
        createSyncNativeInstruction(userTokenAccount)
      );
      wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [authority], {
        commitment: "confirmed",
      });
      console.log("wrap_source_wsol:", wrapSig);
      if (SOURCE_ONLY) {
        writeSourceProgress({
          ...loadSourceProgress(),
          status: "source_wsol_wrapped",
          wrapSourceWsolTx: wrapSig,
          sourceSecret: sourceSecret.toString(),
          sourceNullifier: sourceNullifier.toString(),
          sourceCommitment: sourceCommitment.toString(),
          sourceCommitmentHex: bytes32Hex(sourceCommitment),
          sourceAmount: TEST_AMOUNT.toString(),
          sourceAssetId: sourceAssetIdHex,
        });
      }
    }

    depositTx = await sendIx(
      connection,
      authority,
      "deposit_masp_source",
      await program.methods
        .depositMasp(
          bn(TEST_AMOUNT),
          Array.from(sourceCommitmentBytes),
          Array.from(sourceAssetIdBytes),
          Buffer.from(serializeProofForSolana(depositProof)),
          null
        )
        .accounts({
          depositor: authority.publicKey,
          poolConfig,
          authority: authority.publicKey,
          merkleTree,
          pendingBuffer,
          assetVault,
          vaultTokenAccount,
          userTokenAccount,
          mint: NATIVE_MINT,
          depositVk,
          commitmentIndex,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
      650_000
    );
    if (SOURCE_ONLY) {
      writeSourceProgress({
        ...loadSourceProgress(),
        status: "source_deposited",
        solanaDepositTx: depositTx,
        sourceSecret: sourceSecret.toString(),
        sourceNullifier: sourceNullifier.toString(),
        sourceCommitment: sourceCommitment.toString(),
        sourceCommitmentHex: bytes32Hex(sourceCommitment),
        sourceAmount: TEST_AMOUNT.toString(),
        sourceAssetId: sourceAssetIdHex,
      });
    }
  } else {
    console.log("Reusing source deposit from private progress file.");
  }
  evidence.solanaDepositTx = depositTx;
  evidence.sourceCommitment = bytes32Hex(sourceCommitment);

  const sourceSettle =
    SOURCE_ONLY && sourceProgress?.sourceSettle && !SOURCE_FORCE_NEW
      ? restoreSourceSettle(sourceProgress.sourceSettle)
      : await settleFirstPending({
          program,
          connection,
          authority,
          poolConfig,
          merkleTree,
          pendingBuffer,
          batchVk,
          expectedCommitment: sourceCommitment,
        });
  if (SOURCE_ONLY && !sourceProgress?.sourceSettle) {
    writeSourceProgress({
      ...loadSourceProgress(),
      status: "source_settled",
      solanaDepositTx: depositTx,
      sourceSettle: serializeSourceSettle(sourceSettle),
      sourceSecret: sourceSecret.toString(),
      sourceNullifier: sourceNullifier.toString(),
      sourceCommitment: sourceCommitment.toString(),
      sourceCommitmentHex: bytes32Hex(sourceCommitment),
      sourceAmount: TEST_AMOUNT.toString(),
      sourceAssetId: sourceAssetIdHex,
    });
  } else if (SOURCE_ONLY && sourceProgress?.sourceSettle && !SOURCE_FORCE_NEW) {
    console.log("Reusing source settlement from private progress file.");
  }
  evidence.solanaSettlementTx = sourceSettle.tx;
  evidence.sourceLeafIndex = sourceSettle.leafIndex;
  evidence.sourceRoot = bytes32Hex(sourceSettle.newRoot);

  const latestProgress = SOURCE_ONLY ? loadSourceProgress() : null;
  const destSecret =
    SOURCE_ONLY && latestProgress?.destSecret && !SOURCE_FORCE_NEW
      ? BigInt(latestProgress.destSecret)
      : randomFieldElement();
  const destNullifier =
    SOURCE_ONLY && latestProgress?.destNullifier && !SOURCE_FORCE_NEW
      ? BigInt(latestProgress.destNullifier)
      : randomFieldElement();
  const normalizedDestinationAmount = normalizeSolanaToBaseAmount(TEST_AMOUNT);
  const destCommitment = computeCommitment(
    destSecret,
    destNullifier,
    normalizedDestinationAmount,
    baseNativeAssetId
  );
  const sourceNullifierHash = computeNullifierHash(
    sourceNullifier,
    sourceSecret,
    sourceSettle.leafIndex
  );
  const sourceNullifierHashBuffer = bigintToBytes32(sourceNullifierHash);
  const sourceRootBuffer = bigintToBytes32(sourceSettle.newRoot);
  const deadline =
    SOURCE_ONLY && latestProgress?.deadline && !SOURCE_FORCE_NEW
      ? Number(latestProgress.deadline)
      : Math.floor(Date.now() / 1000) + 3600;
  const { message, messageHashHex, messageHashBytes } = fieldValidMessage({
    sourceAssetIdHex,
    baseAssetIdHex: baseNativeAssetIdHex,
    amount: TEST_AMOUNT,
    sourceNullifierHash: bytes32Hex(sourceNullifierHash),
    destinationCommitment: bytes32Hex(destCommitment),
    sourceRoot: bytes32Hex(sourceSettle.newRoot),
    sourceLeafIndex: sourceSettle.leafIndex,
    deadline,
  });
  evidence.bridgeMessage = {
    sourceDomain: message.sourceDomain,
    destinationDomain: message.destinationDomain,
    sourceChainId: message.sourceChainId,
    destinationChainId: message.destinationChainId,
    canonicalAssetId: message.canonicalAssetId,
    sourceLocalAssetId: message.sourceLocalAssetId,
    destinationLocalAssetId: message.destinationLocalAssetId,
    amount: message.amount.toString(),
    sourceNullifierHash: message.sourceNullifierHash,
    destinationCommitment: message.destinationCommitment,
    sourceRoot: message.sourceRoot,
    sourceLeafIndex: message.sourceLeafIndex,
    nonce: message.nonce,
    deadline: message.deadline,
  };
  evidence.normalizedDestinationAmount = normalizedDestinationAmount.toString();
  evidence.messageHash = messageHashHex;
  if (SOURCE_ONLY) {
    writeSourceProgress({
      ...loadSourceProgress(),
      status: "bridge_message_prepared",
      solanaDepositTx: depositTx,
      sourceSettle: serializeSourceSettle(sourceSettle),
      sourceSecret: sourceSecret.toString(),
      sourceNullifier: sourceNullifier.toString(),
      sourceCommitment: sourceCommitment.toString(),
      sourceCommitmentHex: bytes32Hex(sourceCommitment),
      sourceAmount: TEST_AMOUNT.toString(),
      sourceAssetId: sourceAssetIdHex,
      destSecret: destSecret.toString(),
      destNullifier: destNullifier.toString(),
      destinationCommitment: bytes32Hex(destCommitment),
      normalizedDestinationAmount: normalizedDestinationAmount.toString(),
      deadline,
      sourceMessageHash: messageHashHex,
    });
  }

  const { proof: sourceWithdrawProof, publicSignals: sourceWithdrawSignals } =
    await snarkjs.groth16.fullProve(
      {
        merkle_root: sourceSettle.newRoot.toString(),
        nullifier_hash: sourceNullifierHash.toString(),
        asset_id: sourceAssetId.toString(),
        recipient: pubkeyToScalar(authority.publicKey.toBase58()).toString(),
        amount: TEST_AMOUNT.toString(),
        relayer: pubkeyToScalar(PublicKey.default.toBase58()).toString(),
        relayer_fee: "0",
        public_data_hash: BigInt(messageHashHex).toString(),
        secret: sourceSecret.toString(),
        nullifier: sourceNullifier.toString(),
        leaf_index: sourceSettle.leafIndex.toString(),
        merkle_path: sourceSettle.pathElements.map((p) => p.toString()),
        merkle_path_indices: sourceSettle.pathIndices.map((i) => i.toString()),
      },
      WITHDRAW_WASM,
      WITHDRAW_ZKEY
    );
  const expectedSourceSignals = [
    sourceSettle.newRoot.toString(),
    sourceNullifierHash.toString(),
    sourceAssetId.toString(),
    pubkeyToScalar(authority.publicKey.toBase58()).toString(),
    TEST_AMOUNT.toString(),
    pubkeyToScalar(PublicKey.default.toBase58()).toString(),
    "0",
    BigInt(messageHashHex).toString(),
  ];
  for (let i = 0; i < expectedSourceSignals.length; i++) {
    if (sourceWithdrawSignals[i].toString() !== expectedSourceSignals[i]) {
      throw new Error(`source withdraw public signal ${i} mismatch`);
    }
  }

  const [outboundMessage] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_outbound"), bridgeV1Config.toBuffer(), messageHashBytes],
    PROGRAM_ID
  );
  const [spentNullifier] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), poolConfig.toBuffer(), sourceNullifierHashBuffer],
    PROGRAM_ID
  );

  const lookupTable = await createLookupTable(connection, authority, [
    authority.publicKey,
    bridgeV1Config,
    routeConfigOutbound,
    assetConfig,
    outboundMessage,
    poolConfig,
    merkleTree,
    withdrawVk,
    assetVault,
    vaultTokenAccount,
    bridgeCustodyTokenAccount,
    spentNullifier,
    TOKEN_PROGRAM_ID,
    SystemProgram.programId,
  ]);

  const custodyBeforeBridgeOut = await tokenAmount(connection, bridgeCustodyTokenAccount);
  const vaultBeforeBridgeOut = await tokenAmount(connection, vaultTokenAccount);
  const bridgeOutIx = buildBridgeOutWithProofIx({
    message,
    proof: serializeProofForSolana(sourceWithdrawProof),
    merkleRoot: sourceRootBuffer,
    nullifierHash: sourceNullifierHashBuffer,
    amount: TEST_AMOUNT,
    assetId: sourceAssetIdBytes,
    publicDataHash: messageHashBytes,
    accounts: {
      payer: authority.publicKey,
      bridgeV1Config,
      routeConfig: routeConfigOutbound,
      assetConfig,
      outboundMessage,
      poolConfig,
      merkleTree,
      vkAccount: withdrawVk,
      assetVault,
      vaultTokenAccount,
      bridgeCustodyTokenAccount,
      spentNullifier,
    },
  });
  const progressBeforeBridgeOut = SOURCE_ONLY ? loadSourceProgress() : null;
  let bridgeOutTx =
    SOURCE_ONLY && progressBeforeBridgeOut?.solanaBridgeOutTx && !SOURCE_FORCE_NEW
      ? String(progressBeforeBridgeOut.solanaBridgeOutTx)
      : "";
  let custodyAfterBridgeOut = custodyBeforeBridgeOut;
  let vaultAfterBridgeOut = vaultBeforeBridgeOut;
  if (!bridgeOutTx) {
    bridgeOutTx = await sendV0Ix(
      connection,
      authority,
      lookupTable,
      "bridge_out_v1_with_proof",
      bridgeOutIx
    );
    custodyAfterBridgeOut = await tokenAmount(connection, bridgeCustodyTokenAccount);
    vaultAfterBridgeOut = await tokenAmount(connection, vaultTokenAccount);
    if (custodyAfterBridgeOut - custodyBeforeBridgeOut !== TEST_AMOUNT) {
      throw new Error("Solana bridge custody balance did not increase by source amount");
    }
    if (vaultBeforeBridgeOut - vaultAfterBridgeOut !== TEST_AMOUNT) {
      throw new Error("Solana source vault balance did not decrease by source amount");
    }
    if (SOURCE_ONLY) {
      writeSourceProgress({
        ...loadSourceProgress(),
        status: "bridge_out_submitted",
        solanaBridgeOutTx: bridgeOutTx,
        outboundMessage: outboundMessage.toBase58(),
        spentNullifier: spentNullifier.toBase58(),
        sourceNullifierHash: bytes32Hex(sourceNullifierHash),
        sourceValueLocked: true,
        sourceNullifierSpent: true,
      });
    }
  } else {
    console.log("Reusing bridge_out_v1_with_proof tx from private progress file.");
  }
  if (!(await connection.getAccountInfo(outboundMessage, "confirmed"))) {
    throw new Error("OutboundBridgeMessage PDA was not created");
  }
  if (!(await connection.getAccountInfo(spentNullifier, "confirmed"))) {
    throw new Error("SpentNullifier PDA was not created");
  }
  evidence.solanaBridgeOutTx = bridgeOutTx;
  evidence.outboundMessage = outboundMessage.toBase58();
  evidence.spentNullifier = spentNullifier.toBase58();
  evidence.custodyBeforeBridgeOut = custodyBeforeBridgeOut.toString();
  evidence.custodyAfterBridgeOut = custodyAfterBridgeOut.toString();
  evidence.vaultBeforeBridgeOut = vaultBeforeBridgeOut.toString();
  evidence.vaultAfterBridgeOut = vaultAfterBridgeOut.toString();

  if (SOURCE_ONLY) {
    const finality = await waitForSolanaFinality(connection, bridgeOutTx, 32);
    const fixturePath = sourceFixturePath(messageHashHex);
    const destinationMessage = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage: message,
      destinationDomain: BASE_SEPOLIA_DOMAIN,
      destinationChainId: BASE_SEPOLIA_CHAIN_ID,
      destinationLocalAssetId: baseNativeAssetIdHex,
      destinationCommitment: bytes32Hex(destCommitment),
      sourceDecimals: SOLANA_SOURCE_DECIMALS,
      destinationDecimals: BASE_DESTINATION_DECIMALS,
      normalizationMode: "exact-decimal",
    });
    const destinationBridgeMintHash = hashBridgeMessageV1(destinationMessage);
    const fixture = {
      schema: "white-bridge-solana-source-fixture-v1",
      generatedAt: new Date().toISOString(),
      sourceChain: "solana-devnet",
      destinationChain: "base-sepolia",
      eventKind: "bridge_out_v1_with_proof",
      instruction: "bridge_out_v1_with_proof",
      sourceBoundProofMarker: "bridge_out_v1_with_proof",
      programId: PROGRAM_ID.toBase58(),
      sourceTx: bridgeOutTx,
      txHash: bridgeOutTx,
      signature: bridgeOutTx,
      slot: finality.slot,
      blockNumber: finality.slot,
      finalizedSlot: finality.finalizedSlot,
      confirmations: finality.confirmations,
      sourceTxSucceeded: true,
      sourceMessageHash: messageHashHex,
      messageHash: messageHashHex,
      destinationBridgeMintHash,
      encodedMessage: hex(encodeBridgeMessageV1(message)),
      message: {
        ...message,
        amount: message.amount.toString(),
        relayerFee: message.relayerFee.toString(),
      },
      sourceAmount: TEST_AMOUNT.toString(),
      normalizedDestinationAmount: normalizedDestinationAmount.toString(),
      sourceAssetId: sourceAssetIdHex,
      destinationAssetId: baseNativeAssetIdHex,
      sourceNullifierSpent: true,
      sourceValueLocked: true,
      sourceLeafIndex: sourceSettle.leafIndex,
      deadline,
      noSecrets: true,
      destinationTxSubmitted: false,
    };
    fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, jsonReplacer, 2));
    evidence.sourceFixturePath = fixturePath;
    evidence.destinationBridgeMintHash = destinationBridgeMintHash;
    evidence.sourceSlot = finality.slot;
    evidence.finalizedSlot = finality.finalizedSlot;
    evidence.sourceConfirmations = finality.confirmations;
    evidence.sourceNullifierSpent = true;
    evidence.sourceValueLocked = true;
    evidence.destinationTxSubmitted = false;
    evidence.proofsGenerated = true;
    evidence.secretsPrinted = false;
    writeSourceProgress({
      ...loadSourceProgress(),
      status: "fixture_exported",
      solanaBridgeOutTx: bridgeOutTx,
      sourceFixturePath: fixturePath,
      sourceSlot: finality.slot,
      finalizedSlot: finality.finalizedSlot,
      sourceConfirmations: finality.confirmations,
      destinationBridgeMintHash,
      destinationTxSubmitted: false,
    });
    fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
    fs.writeFileSync(RESULT_PATH, JSON.stringify(evidence, jsonReplacer, 2));
    console.log(JSON.stringify({
      ok: true,
      mode: "source_only_fixture",
      solanaDepositTx: depositTx,
      solanaSettlementTx: sourceSettle.tx,
      solanaBridgeOutTx: bridgeOutTx,
      sourceSlot: finality.slot,
      confirmations: finality.confirmations,
      sourceMessageHash: messageHashHex,
      destinationBridgeMintHash,
      sourceAmount: TEST_AMOUNT.toString(),
      normalizedDestinationAmount: normalizedDestinationAmount.toString(),
      sourceNullifierSpent: true,
      sourceValueLocked: true,
      fixturePath,
      resultPath: RESULT_PATH,
      destinationTxSubmitted: false,
      secretsPrinted: false,
    }, null, 2));
    return;
  }

  let duplicateOutboundRejected = false;
  try {
    await sendV0Ix(connection, authority, lookupTable, "duplicate_bridge_out_should_fail", bridgeOutIx);
  } catch (error: any) {
    duplicateOutboundRejected = true;
    evidence.duplicateSolanaBridgeOutError = String(error?.message ?? error).slice(0, 240);
    console.log("duplicate bridge_out_v1_with_proof rejected");
  }
  if (!duplicateOutboundRejected) {
    throw new Error("duplicate Solana bridge_out_v1_with_proof unexpectedly succeeded");
  }

  const signed = sortedThresholdSignatures(messageHashHex);
  evidence.thresholdSignerAddresses = signed.signerAddresses;
  evidence.signedHash = messageHashHex;
  console.log("Threshold signer addresses:", signed.signerAddresses.join(", "));

  const baseSignerSetVersion = Number((await bridgeInbox.currentSignerSetVersion()).toString());
  evidence.baseSignerSetVersion = baseSignerSetVersion;
  const baseWpBalanceBefore = await baseProvider.getBalance(baseWP.address);
  if (baseWpBalanceBefore.lt(TEST_AMOUNT)) {
    const fundTx = await baseWallet.sendTransaction({
      to: baseWP.address,
      value: TEST_AMOUNT,
    });
    await fundTx.wait();
    evidence.baseWhiteProtocolLiquidityTx = fundTx.hash;
  }

  const preRoot = await baseWP.getLastRoot();
  const preLeafIndex = await baseWP.nextLeafIndex();
  evidence.baseRootBeforeAccept = preRoot.toString();
  evidence.baseNextLeafIndexBeforeAccept = preLeafIndex.toString();

  let acceptTx;
  try {
    acceptTx = await bridgeInbox.acceptBridgeMint(message, signed.signatures, baseSignerSetVersion);
  } catch (error: any) {
    if (error.code === "UNPREDICTABLE_GAS_LIMIT") {
      acceptTx = await bridgeInbox.acceptBridgeMint(message, signed.signatures, baseSignerSetVersion, {
        gasLimit: 1_500_000,
      });
    } else {
      throw error;
    }
  }
  const acceptReceipt = await acceptTx.wait();
  await sleep(3000);
  evidence.baseAcceptTx = acceptTx.hash;
  evidence.baseAcceptGasUsed = acceptReceipt.gasUsed.toString();

  const inboxIface = new ethers.utils.Interface(BRIDGE_INBOX_ABI);
  const mintEvent = acceptReceipt.logs
    .map((log: any) => {
      try {
        return inboxIface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event: any) => event && event.name === "BridgeMintAccepted");
  if (!mintEvent) throw new Error("BridgeMintAccepted event not found");
  if ((await bridgeInbox.isMessageConsumed(messageHashHex)) !== true) {
    throw new Error("Base BridgeInbox did not mark message consumed");
  }

  const postRoot = await baseWP.getLastRoot();
  const postLeafIndex = await baseWP.nextLeafIndex();
  if (postRoot.eq(preRoot)) throw new Error("Base root did not change after acceptBridgeMint");
  if (!postLeafIndex.gt(preLeafIndex)) {
    throw new Error("Base nextLeafIndex did not advance after acceptBridgeMint");
  }
  evidence.baseRootAfterAccept = postRoot.toString();
  evidence.baseNextLeafIndexAfterAccept = postLeafIndex.toString();

  let duplicateAcceptRejected = false;
  try {
    await bridgeInbox.acceptBridgeMint(message, signed.signatures, baseSignerSetVersion);
  } catch (error: any) {
    duplicateAcceptRejected = true;
    evidence.duplicateBaseAcceptError = String(error?.message ?? error).slice(0, 240);
    console.log("duplicate Base acceptBridgeMint rejected");
  }
  if (!duplicateAcceptRejected) {
    throw new Error("duplicate Base acceptBridgeMint unexpectedly succeeded");
  }

  const destLeafIndex = Number(preLeafIndex.toString());
  const destTreeState = await getEvmTreeState(baseWP);
  const destPath = computeEvmPath(destLeafIndex, destTreeState.filledSubtrees, destTreeState.zeros);
  const destRootCheck = await computeEvmRootFromPath(destCommitment, destPath);
  if (destRootCheck !== destTreeState.currentRoot) {
    throw new Error("Base destination path does not reconstruct current root");
  }
  const destNullifierHash = computeNullifierHash(destNullifier, destSecret, destLeafIndex);
  const { proof: destWithdrawProof, publicSignals: destWithdrawSignals } =
    await snarkjs.groth16.fullProve(
      {
        secret: destSecret.toString(),
        nullifier: destNullifier.toString(),
        amount: TEST_AMOUNT.toString(),
        asset_id: baseNativeAssetId.toString(),
        leaf_index: destLeafIndex.toString(),
        merkle_root: destTreeState.currentRoot.toString(),
        nullifier_hash: destNullifierHash.toString(),
        merkle_path: destPath.pathElements.map((p) => p.toString()),
        merkle_path_indices: destPath.pathIndices.map((i) => i.toString()),
        recipient: BigInt(baseWallet.address).toString(),
        relayer: "0",
        relayer_fee: "0",
        public_data_hash: "0",
      },
      WITHDRAW_WASM,
      WITHDRAW_ZKEY
    );
  const expectedDestSignals = [
    destTreeState.currentRoot.toString(),
    destNullifierHash.toString(),
    baseNativeAssetId.toString(),
    BigInt(baseWallet.address).toString(),
    TEST_AMOUNT.toString(),
    "0",
    "0",
    "0",
  ];
  for (let i = 0; i < expectedDestSignals.length; i++) {
    if (destWithdrawSignals[i].toString() !== expectedDestSignals[i]) {
      throw new Error(`destination withdraw public signal ${i} mismatch`);
    }
  }
  const destWithdrawProofBytes = await formatProofForEvm(destWithdrawProof, destWithdrawSignals);
  const baseRecipientBefore = await baseProvider.getBalance(baseWallet.address);
  const baseWpBeforeWithdraw = await baseProvider.getBalance(baseWP.address);
  const withdrawTx = await baseWP.withdraw(
    destWithdrawProofBytes,
    destNullifierHash,
    destTreeState.currentRoot,
    baseWallet.address,
    ethers.constants.AddressZero,
    TEST_AMOUNT,
    0,
    ethers.constants.AddressZero
  );
  const withdrawReceipt = await withdrawTx.wait();
  await sleep(3000);
  const baseRecipientAfter = await baseProvider.getBalance(baseWallet.address);
  const baseWpAfterWithdraw = await baseProvider.getBalance(baseWP.address);
  const gasCost = withdrawReceipt.gasUsed.mul(withdrawReceipt.effectiveGasPrice);
  const recipientDeltaExGas = baseRecipientAfter.add(gasCost).sub(baseRecipientBefore);
  if (!baseWpBeforeWithdraw.sub(baseWpAfterWithdraw).eq(TEST_AMOUNT)) {
    throw new Error("Base WhiteProtocol balance did not decrease by destination amount");
  }
  if (!(await baseWP.isSpent(destNullifierHash))) {
    throw new Error("Base destination nullifier is not spent");
  }
  if (!recipientDeltaExGas.eq(TEST_AMOUNT)) {
    evidence.baseRecipientDeltaNote =
      "Base native balance delta includes chain-specific fee accounting; WhiteProtocol balance delta and spent nullifier verify payout.";
    console.log("Base recipient balance delta after gas was not exact:", recipientDeltaExGas.toString());
  }
  evidence.baseWithdrawTx = withdrawTx.hash;
  evidence.baseWithdrawGasUsed = withdrawReceipt.gasUsed.toString();
  evidence.baseDestinationLeafIndex = destLeafIndex;
  evidence.baseDestinationNullifierHash = bytes32Hex(destNullifierHash);
  evidence.baseRecipientBeforeWithdraw = baseRecipientBefore.toString();
  evidence.baseRecipientAfterWithdraw = baseRecipientAfter.toString();
  evidence.baseRecipientDeltaExGas = recipientDeltaExGas.toString();
  evidence.baseWhiteProtocolBeforeWithdraw = baseWpBeforeWithdraw.toString();
  evidence.baseWhiteProtocolAfterWithdraw = baseWpAfterWithdraw.toString();

  let duplicateWithdrawRejected = false;
  try {
    await baseWP.withdraw(
      destWithdrawProofBytes,
      destNullifierHash,
      destTreeState.currentRoot,
      baseWallet.address,
      ethers.constants.AddressZero,
      TEST_AMOUNT,
      0,
      ethers.constants.AddressZero
    );
  } catch (error: any) {
    duplicateWithdrawRejected = true;
    evidence.duplicateBaseWithdrawError = String(error?.message ?? error).slice(0, 240);
    console.log("duplicate Base withdraw rejected");
  }
  if (!duplicateWithdrawRejected) {
    throw new Error("duplicate Base withdraw unexpectedly succeeded");
  }

  const output = {
    status: "success",
    evidence,
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(output, null, 2));

  console.log("\nPR-010Z live E2E success");
  console.log("Solana deposit tx:", evidence.solanaDepositTx);
  console.log("Solana settlement tx:", evidence.solanaSettlementTx);
  console.log("Solana bridge_out_v1_with_proof tx:", evidence.solanaBridgeOutTx);
  console.log("Base acceptBridgeMint tx:", evidence.baseAcceptTx);
  console.log("Base destination withdraw tx:", evidence.baseWithdrawTx);
  console.log("Evidence saved:", RESULT_PATH);
}

main().catch((error) => {
  console.error("PR-010Z failed:", error?.message || error);
  process.exit(1);
});
