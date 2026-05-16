/**
 * PR-012B: Verify a daemon-submitted Base -> Solana BridgeMint through
 * Solana settlement and withdraw.
 *
 * This script does not call accept_bridge_v1_mint. It requires the consumed
 * bridge message PDA to already exist from the guarded daemon submit path.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

import {
  BridgeMessageType,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  formatProofForOnChain,
  hashBridgeMessageV1,
  parseBridgeMessageV1Json,
  pubkeyToScalar,
} from "@thewhiteprotocol/core";

// @ts-ignore
const snarkjs = require("snarkjs");

const RPC_URL =
  process.env.ANCHOR_PROVIDER_URL ||
  process.env.SOLANA_DEVNET_RPC_URL ||
  process.env.RPC_ENDPOINT ||
  "https://api.devnet.solana.com";

const IDL_PATH = process.env.IDL_PATH || "target/idl/white_protocol.json";
const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || idl.address || "DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD"
);

const BRIDGE_STATE_PATH =
  process.env.BASE_TO_SOLANA_BRIDGE_STATE_PATH ||
  path.resolve(__dirname, "../../evm/test/base-to-solana-bridge-state-v2.json");

const RESULT_PATH =
  process.env.PR012B_RESULT_PATH ||
  path.resolve(__dirname, "pr012b-daemon-mint-settle-withdraw-result.json");

const EXPECTED_SOURCE_HASH = process.env.PR012B_SOURCE_MESSAGE_HASH?.toLowerCase();
const EXPECTED_DESTINATION_HASH = process.env.PR012B_DESTINATION_MESSAGE_HASH?.toLowerCase();
const EXPECTED_SUBMIT_TX = process.env.PR012B_SUBMIT_TX;
const SETTLE_FIFO_PREFIX = process.env.PR012B_SETTLE_FIFO_PREFIX === "true";

const BASE_SEPOLIA_DOMAIN = 0x02000002;
const SOLANA_DEVNET_DOMAIN = 0x01000002;
const SOURCE_DECIMALS = 18;
const DESTINATION_DECIMALS = 9;
const EXPECTED_SOURCE_AMOUNT = 1_000_000_000_000_000n;
const EXPECTED_DESTINATION_AMOUNT = 1_000_000n;
const TREE_DEPTH = 20;

const DEFAULT_POOL_CONFIG = "DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF";

const CIRCUIT_BASE = path.resolve(__dirname, "../../../circuits");
const WITHDRAW_WASM = path.join(CIRCUIT_BASE, "withdraw/build/withdraw_js/withdraw.wasm");
const WITHDRAW_ZKEY = path.join(CIRCUIT_BASE, "withdraw/build/withdraw.zkey");
const MERKLE_BATCH_WASM = path.join(
  CIRCUIT_BASE,
  "merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm"
);
const MERKLE_BATCH_ZKEY = path.join(CIRCUIT_BASE, "merkle_batch_update/build/merkle_batch_update.zkey");

type Evidence = Record<string, unknown>;

let poseidon: any;
let F: any;

function loadKeypair(): Keypair {
  if (process.env.ANCHOR_WALLET) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET, "utf8")))
    );
  }
  if (process.env.RELAYER_KEYPAIR) {
    const parsed = JSON.parse(process.env.RELAYER_KEYPAIR);
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error("RELAYER_KEYPAIR must be a JSON array of 64 numbers");
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }
  throw new Error("ANCHOR_WALLET or RELAYER_KEYPAIR is required");
}

async function initPoseidon(): Promise<void> {
  const circomlibjs = await import("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((x: bigint) => F.e(x)));
  return BigInt(F.toString(hash));
}

function computeCommitment(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint): bigint {
  return poseidonHash([secret, nullifier, amount, assetId]);
}

function computeNullifierHash(nullifier: bigint, secret: bigint, leafIndex: number): bigint {
  const inner = poseidonHash([nullifier, secret]);
  return poseidonHash([inner, BigInt(leafIndex)]);
}

function hexToBytes32Array(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`expected bytes32 hex, got ${hex}`);
  }
  return Array.from(Buffer.from(clean, "hex"));
}

function bytes32ToBigInt(bytes: Uint8Array | number[]): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function bigintToBytes32Array(value: bigint): number[] {
  return Array.from(Buffer.from(value.toString(16).padStart(64, "0"), "hex"));
}

function serializeProofForSolana(proof: any): number[] {
  return Array.from(formatProofForOnChain(proof, "solana"));
}

function pendingCount(pendingData: any): number {
  if (pendingData.totalPending !== undefined) {
    return Number(pendingData.totalPending);
  }
  return pendingData.deposits?.length || 0;
}

function readU64Like(value: any): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt(value.toString());
}

async function ensureTokenAccount(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey
): Promise<PublicKey> {
  const tokenAccount = getAssociatedTokenAddressSync(mint, owner);
  const info = await connection.getAccountInfo(tokenAccount);
  if (info) return tokenAccount;

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      tokenAccount,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  console.log("Created recipient wSOL ATA:", sig);
  return tokenAccount;
}

async function tokenAmount(connection: Connection, tokenAccount: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAccount);
  if (!info) return 0n;
  const balance = await connection.getTokenAccountBalance(tokenAccount);
  return BigInt(balance.value.amount);
}

async function sendIx(
  connection: Connection,
  authority: Keypair,
  label: string,
  buildIx: () => Promise<anchor.web3.TransactionInstruction>,
  computeUnits = 500_000
): Promise<string> {
  const ix = await buildIx();
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }), ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: "confirmed",
  });
  console.log(`${label}: ${sig}`);
  return sig;
}

async function generateSettlementForCommitment(
  merkleData: any,
  commitment: bigint
): Promise<{
  oldRoot: bigint;
  newRoot: bigint;
  startIndex: number;
  pathElements: bigint[];
  pathIndices: number[];
  proofBytes: number[];
}> {
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

  const commitmentsBuffer = Buffer.from(commitment.toString(16).padStart(64, "0"), "hex");
  const digest = createHash("sha256").update(commitmentsBuffer).digest();
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

  return {
    oldRoot,
    newRoot,
    startIndex,
    pathElements,
    pathIndices,
    proofBytes: serializeProofForSolana(proof),
  };
}

async function settleOnePendingHead(input: {
  connection: Connection;
  authority: Keypair;
  program: anchor.Program;
  poolConfig: PublicKey;
  merkleTree: PublicKey;
  pendingBuffer: PublicKey;
  batchVk: PublicKey;
  label: string;
}): Promise<{
  tx: string;
  commitment: bigint;
  oldRoot: bigint;
  newRoot: bigint;
  startIndex: number;
}> {
  const pending = await (input.program.account as any).pendingDepositsBuffer.fetch(input.pendingBuffer);
  if (pendingCount(pending) < 1) {
    throw new Error("No pending commitment available to settle");
  }
  const commitment = bytes32ToBigInt(pending.deposits[0].commitment);
  const preMerkle = await (input.program.account as any).merkleTree.fetch(input.merkleTree);
  const settlement = await generateSettlementForCommitment(preMerkle, commitment);
  const tx = await sendIx(input.connection, input.authority, input.label, () =>
    input.program.methods
      .settleDepositsBatch({
        proof: settlement.proofBytes,
        newRoot: bigintToBytes32Array(settlement.newRoot),
        batchSize: 1,
      })
      .accountsStrict({
        authority: input.authority.publicKey,
        poolConfig: input.poolConfig,
        merkleTree: input.merkleTree,
        pendingBuffer: input.pendingBuffer,
        verificationKey: input.batchVk,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );

  const postMerkle = await (input.program.account as any).merkleTree.fetch(input.merkleTree);
  if (bytes32ToBigInt(postMerkle.currentRoot) !== settlement.newRoot) {
    throw new Error("Post-settlement root mismatch for FIFO prefix commitment");
  }
  if (Number(postMerkle.nextLeafIndex) !== settlement.startIndex + 1) {
    throw new Error("nextLeafIndex did not advance for FIFO prefix commitment");
  }

  return {
    tx,
    commitment,
    oldRoot: settlement.oldRoot,
    newRoot: settlement.newRoot,
    startIndex: settlement.startIndex,
  };
}

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  PR-012B: daemon mint settle + withdraw");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === "true") {
    throw new Error("BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must be false for PR-012B");
  }
  if (process.env.BRIDGE_DAEMON_MODE && process.env.BRIDGE_DAEMON_MODE !== "paper") {
    throw new Error("BRIDGE_DAEMON_MODE must remain paper for PR-012B");
  }
  if (!fs.existsSync(BRIDGE_STATE_PATH)) {
    throw new Error(`Bridge source state not found: ${BRIDGE_STATE_PATH}`);
  }

  const evidence: Evidence = {
    bridgeStatePath: BRIDGE_STATE_PATH,
    programId: PROGRAM_ID.toBase58(),
    submitTx: EXPECTED_SUBMIT_TX || null,
  };

  const bridgeState = JSON.parse(fs.readFileSync(BRIDGE_STATE_PATH, "utf8"));
  const sourceMessage = parseBridgeMessageV1Json(bridgeState.sourceMessage || bridgeState.message);
  if (sourceMessage.messageType !== BridgeMessageType.BridgeOut) {
    throw new Error("Source state message must be BridgeOut");
  }
  if (bridgeState.manualMessageEditUsed !== false) {
    throw new Error("Bridge source state must prove manualMessageEditUsed=false");
  }

  const mintMessage = buildDestinationBridgeMintMessageFromSourceBridgeOut({
    sourceMessage,
    destinationDomain: SOLANA_DEVNET_DOMAIN,
    destinationChainId: 0,
    destinationLocalAssetId: sourceMessage.destinationLocalAssetId,
    destinationCommitment: sourceMessage.destinationCommitment,
    sourceDecimals: bridgeState.sourceDecimals,
    destinationDecimals: bridgeState.destinationDecimals,
    normalizationMode: bridgeState.normalizationMode,
  });

  const sourceHash = hashBridgeMessageV1(sourceMessage).toLowerCase();
  const destinationHash = hashBridgeMessageV1(mintMessage).toLowerCase();
  if (EXPECTED_SOURCE_HASH && sourceHash !== EXPECTED_SOURCE_HASH) {
    throw new Error(`Source hash mismatch: ${sourceHash}`);
  }
  if (EXPECTED_DESTINATION_HASH && destinationHash !== EXPECTED_DESTINATION_HASH) {
    throw new Error(`Destination hash mismatch: ${destinationHash}`);
  }
  if (bridgeState.bridgeMintMessageHash?.toLowerCase() !== destinationHash) {
    throw new Error("Generated BridgeMint hash does not match saved source-side hash");
  }
  if (sourceMessage.amount !== EXPECTED_SOURCE_AMOUNT) {
    throw new Error(`Unexpected source amount: ${sourceMessage.amount}`);
  }
  if (mintMessage.amount !== EXPECTED_DESTINATION_AMOUNT) {
    throw new Error(`Unexpected destination amount: ${mintMessage.amount}`);
  }

  await initPoseidon();
  const destSecret = BigInt(bridgeState.destSecret);
  const destNullifier = BigInt(bridgeState.destNullifier);
  const destinationAssetId = BigInt(mintMessage.destinationLocalAssetId);
  const destinationAmount = mintMessage.amount;
  const destinationCommitment = BigInt(mintMessage.destinationCommitment);
  const expectedCommitment = computeCommitment(destSecret, destNullifier, destinationAmount, destinationAssetId);
  if (expectedCommitment !== destinationCommitment) {
    throw new Error("Destination note commitment does not match generated BridgeMint");
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const authority = loadKeypair();
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  (idl as any).address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl as any, provider);

  const poolConfig = new PublicKey(process.env.POOL_CONFIG || DEFAULT_POOL_CONFIG);
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
  const [withdrawVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [batchVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const destinationAssetIdBytes = Buffer.from(mintMessage.destinationLocalAssetId.slice(2), "hex");
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolConfig.toBuffer(), destinationAssetIdBytes],
    PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), assetVault.toBuffer()],
    PROGRAM_ID
  );
  const [consumedMessage] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_consumed"), Buffer.from(destinationHash.slice(2), "hex")],
    PROGRAM_ID
  );
  const [commitmentIndex] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("commitment"),
      poolConfig.toBuffer(),
      Buffer.from(mintMessage.destinationCommitment.slice(2), "hex"),
    ],
    PROGRAM_ID
  );

  evidence.sourceBridgeOutHash = sourceHash;
  evidence.destinationBridgeMintHash = destinationHash;
  evidence.destinationCommitment = mintMessage.destinationCommitment;
  evidence.poolConfig = poolConfig.toBase58();
  evidence.merkleTree = merkleTree.toBase58();
  evidence.pendingBuffer = pendingBuffer.toBase58();
  evidence.assetVault = assetVault.toBase58();
  evidence.vaultTokenAccount = vaultTokenAccount.toBase58();
  evidence.consumedMessage = consumedMessage.toBase58();
  evidence.commitmentIndex = commitmentIndex.toBase58();

  const poolData = await (program.account as any).poolConfig.fetch(poolConfig);
  if (!poolData.authority.equals(authority.publicKey)) {
    throw new Error("Configured keypair is not the PoolConfig authority");
  }

  const consumedInfo = await connection.getAccountInfo(consumedMessage, "confirmed");
  if (!consumedInfo) throw new Error("ConsumedBridgeMessage PDA does not exist");

  const prePending = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
  const pendingBefore = pendingCount(prePending);
  const commitmentBytes = Buffer.from(mintMessage.destinationCommitment.slice(2), "hex");
  const pendingIndex = prePending.deposits.findIndex((deposit: any) =>
    Buffer.from(deposit.commitment).equals(commitmentBytes)
  );
  if (pendingIndex < 0) {
    throw new Error("Destination commitment is not present in PendingDepositsBuffer");
  }
  const fifoPrefixSettlementTxs: string[] = [];
  if (pendingIndex !== 0) {
    if (!SETTLE_FIFO_PREFIX) {
      throw new Error(
        `Destination commitment is pending at index ${pendingIndex}; expected FIFO index 0. ` +
        `Set PR012B_SETTLE_FIFO_PREFIX=true to settle earlier FIFO commitments first.`
      );
    }
    console.log(`Destination commitment is pending at index ${pendingIndex}; settling FIFO prefix first`);
    for (let i = 0; i < pendingIndex; i++) {
      const prefix = await settleOnePendingHead({
        connection,
        authority,
        program,
        poolConfig,
        merkleTree,
        pendingBuffer,
        batchVk,
        label: `settle_deposits_batch prefix ${i + 1}/${pendingIndex}`,
      });
      fifoPrefixSettlementTxs.push(prefix.tx);
    }
  }

  const refreshedPending = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
  const refreshedPendingBefore = pendingCount(refreshedPending);
  const refreshedPendingIndex = refreshedPending.deposits.findIndex((deposit: any) =>
    Buffer.from(deposit.commitment).equals(commitmentBytes)
  );
  if (refreshedPendingIndex !== 0) {
    throw new Error(`Destination commitment is pending at index ${refreshedPendingIndex}; expected FIFO index 0 after prefix settlement`);
  }

  const preMerkle = await (program.account as any).merkleTree.fetch(merkleTree);
  const oldRoot = bytes32ToBigInt(preMerkle.currentRoot);
  const startIndex = Number(preMerkle.nextLeafIndex);
  const recipientTokenAccount = await ensureTokenAccount(connection, authority, authority.publicKey, NATIVE_MINT);
  const vaultTokenBeforeSettle = await tokenAmount(connection, vaultTokenAccount);
  if (vaultTokenBeforeSettle < destinationAmount) {
    throw new Error("Vault token balance is insufficient for destination withdraw");
  }

  console.log("Consumed PDA exists:", consumedMessage.toBase58());
  console.log("Pending count before:", refreshedPendingBefore);
  console.log("Pending commitment index:", refreshedPendingIndex);
  console.log("nextLeafIndex before:", startIndex);

  console.log("Generating settlement proof...");
  const settlement = await generateSettlementForCommitment(preMerkle, destinationCommitment);
  const newRoot = settlement.newRoot;
  const pathElements = settlement.pathElements;
  const pathIndices = settlement.pathIndices;

  const settleTx = await sendIx(connection, authority, "settle_deposits_batch", () =>
    program.methods
      .settleDepositsBatch({
        proof: settlement.proofBytes,
        newRoot: bigintToBytes32Array(newRoot),
        batchSize: 1,
      })
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        merkleTree,
        pendingBuffer,
        verificationKey: batchVk,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );

  const postMerkle = await (program.account as any).merkleTree.fetch(merkleTree);
  const postRoot = bytes32ToBigInt(postMerkle.currentRoot);
  const nextLeafIndexAfter = Number(postMerkle.nextLeafIndex);
  const postPending = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
  const pendingAfter = pendingCount(postPending);
  if (postRoot !== newRoot) throw new Error("Post-settlement root mismatch");
  if (nextLeafIndexAfter !== startIndex + 1) throw new Error("nextLeafIndex did not advance by 1");
  if (pendingAfter !== refreshedPendingBefore - 1) throw new Error("Pending count did not decrement by 1");

  console.log("Generating withdraw proof...");
  const leafIndex = startIndex;
  const nullifierHash = computeNullifierHash(destNullifier, destSecret, leafIndex);
  const recipientScalar = pubkeyToScalar(authority.publicKey.toBase58());
  const relayerScalar = pubkeyToScalar(authority.publicKey.toBase58());
  const vaultBeforeWithdraw = await tokenAmount(connection, vaultTokenAccount);
  const recipientBeforeWithdraw = await tokenAmount(connection, recipientTokenAccount);

  const { proof: withdrawProof } = await snarkjs.groth16.fullProve(
    {
      merkle_root: newRoot.toString(),
      nullifier_hash: nullifierHash.toString(),
      asset_id: destinationAssetId.toString(),
      recipient: recipientScalar.toString(),
      amount: destinationAmount.toString(),
      relayer: relayerScalar.toString(),
      relayer_fee: "0",
      public_data_hash: "0",
      secret: destSecret.toString(),
      nullifier: destNullifier.toString(),
      leaf_index: leafIndex.toString(),
      merkle_path: pathElements.map((p) => p.toString()),
      merkle_path_indices: pathIndices.map((i) => i.toString()),
    },
    WITHDRAW_WASM,
    WITHDRAW_ZKEY
  );
  const withdrawProofBytes = serializeProofForSolana(withdrawProof);
  const [spentNullifier] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("nullifier"),
      poolConfig.toBuffer(),
      Buffer.from(nullifierHash.toString(16).padStart(64, "0"), "hex"),
    ],
    PROGRAM_ID
  );

  const withdrawTx = await sendIx(connection, authority, "withdraw_masp", () =>
    program.methods
      .withdrawMasp(
        Buffer.from(withdrawProofBytes),
        bigintToBytes32Array(newRoot),
        bigintToBytes32Array(nullifierHash),
        authority.publicKey,
        new anchor.BN(destinationAmount.toString()),
        Array.from(destinationAssetIdBytes),
        new anchor.BN(0)
      )
      .accountsStrict({
        relayer: authority.publicKey,
        poolConfig,
        merkleTree,
        vkAccount: withdrawVk,
        assetVault,
        vaultTokenAccount,
        recipientTokenAccount,
        relayerTokenAccount: recipientTokenAccount,
        spentNullifier,
        relayerRegistry,
        relayerNode: null,
        yieldRegistry: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );

  const vaultAfterWithdraw = await tokenAmount(connection, vaultTokenAccount);
  const recipientAfterWithdraw = await tokenAmount(connection, recipientTokenAccount);
  const spentInfo = await connection.getAccountInfo(spentNullifier, "confirmed");
  if (recipientAfterWithdraw !== recipientBeforeWithdraw + destinationAmount) {
    throw new Error("Recipient token balance did not increase by destination amount");
  }
  if (vaultAfterWithdraw !== vaultBeforeWithdraw - destinationAmount) {
    throw new Error("Vault token balance did not decrease by destination amount");
  }
  if (!spentInfo) throw new Error("Spent nullifier PDA was not created");

  let duplicateWithdrawRejected = false;
  let duplicateWithdrawError = "";
  try {
    await sendIx(connection, authority, "duplicate withdraw_masp", () =>
      program.methods
        .withdrawMasp(
          Buffer.from(withdrawProofBytes),
          bigintToBytes32Array(newRoot),
          bigintToBytes32Array(nullifierHash),
          authority.publicKey,
          new anchor.BN(destinationAmount.toString()),
          Array.from(destinationAssetIdBytes),
          new anchor.BN(0)
        )
        .accountsStrict({
          relayer: authority.publicKey,
          poolConfig,
          merkleTree,
          vkAccount: withdrawVk,
          assetVault,
          vaultTokenAccount,
          recipientTokenAccount,
          relayerTokenAccount: recipientTokenAccount,
          spentNullifier,
          relayerRegistry,
          relayerNode: null,
          yieldRegistry: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction()
    );
  } catch (e: any) {
    duplicateWithdrawRejected = true;
    duplicateWithdrawError = e.message?.slice(0, 240) || String(e);
    console.log("duplicate withdraw_masp rejected");
  }
  if (!duplicateWithdrawRejected) throw new Error("Duplicate withdraw unexpectedly succeeded");

  Object.assign(evidence, {
    consumedPdaExists: true,
    pendingBufferContainsCommitment: true,
    fifoPrefixSettlementTxs,
    fifoPrefixSettledCount: fifoPrefixSettlementTxs.length,
    pendingBefore,
    pendingBeforeTargetSettle: refreshedPendingBefore,
    settleTx,
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    merkleRootChanged: oldRoot !== newRoot,
    nextLeafIndexBefore: startIndex,
    nextLeafIndexAfter,
    pendingAfter,
    withdrawTx,
    recipientBeforeWithdraw: recipientBeforeWithdraw.toString(),
    recipientAfterWithdraw: recipientAfterWithdraw.toString(),
    vaultBeforeWithdraw: vaultBeforeWithdraw.toString(),
    vaultAfterWithdraw: vaultAfterWithdraw.toString(),
    nullifierHash: "0x" + nullifierHash.toString(16).padStart(64, "0"),
    spentNullifier: spentNullifier.toBase58(),
    duplicateWithdrawRejected,
    duplicateWithdrawError,
    additionalBridgeSubmitTx: null,
  });

  const output = { ok: true, status: "success", evidence };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      },
      null,
      2
    )
  );
  process.exit(1);
});
