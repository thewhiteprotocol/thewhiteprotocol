/**
 * Reconstruct a non-secret Solana Devnet -> Base Sepolia source fixture from a
 * finalized bridge_out_v1_with_proof transaction. This command is read-only and
 * never submits a transaction.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import {
  BASE_SEPOLIA_ETH_DECIMALS,
  SOLANA_DEVNET_PROGRAM_ID,
  SOLANA_DEVNET_TO_BASE_SEPOLIA_WSOL_ASSET,
  SOLANA_DEVNET_WSOL_DECIMALS,
} from './base-to-solana-route';
import {
  decodeSolanaBridgeMessageV1InstructionData,
  type SolanaSourceEventFixture,
} from './solana-source-adapter';

const bs58 = require('bs58');

export const PR013A_SOLANA_TO_BASE_SOURCE_TX =
  '1JFuyazkGGMeTAo2Qg65XxfMCtvSwUHxad3p6kbKnsN5niecpKe3mhBfFUh9x5v89V26oJHAvrcMbra2cx4AbA2';
export const PR013A_SOURCE_MESSAGE_HASH =
  '0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2';
export const PR013A_DESTINATION_BRIDGE_MINT_HASH =
  '0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83';
export const PR013A_SOURCE_SLOT = 463688066;
export const DEFAULT_DURABLE_FIXTURE_PATH =
  `/data/bridge-results/solana-to-base-source-fixture-${PR013A_SOURCE_MESSAGE_HASH}.json`;

interface FixtureBuildInput {
  instructionData: Uint8Array;
  signature: string;
  slot: number;
  confirmations: number;
  sourceTxSucceeded: boolean;
  programId?: string;
}

interface FixtureBuildResult {
  ok: boolean;
  fixturePath?: string;
  sourceTx: string;
  sourceSlot: number;
  sourceMessageHash: string;
  destinationBridgeMintHash: string;
  sourceAmount: string;
  normalizedDestinationAmount: string;
  deadline: number;
  sourceEventParsed: boolean;
  finalitySatisfied: boolean;
  destinationTxSubmitted: false;
  secretsPrinted: false;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function normalizeHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}

function dataToBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data as number[]);
  if (typeof data === 'string') {
    if (/^[0-9a-fA-F]+$/.test(data) && data.length % 2 === 0) {
      return Uint8Array.from(Buffer.from(data, 'hex'));
    }
    return Uint8Array.from(bs58.decode(data));
  }
  throw new Error('unsupported_instruction_data_encoding');
}

function destinationBridgeMintMessage(sourceMessage: BridgeMessageV1): BridgeMessageV1 {
  return buildDestinationBridgeMintMessageFromSourceBridgeOut({
    sourceMessage,
    destinationDomain: sourceMessage.destinationDomain,
    destinationChainId: sourceMessage.destinationChainId,
    destinationLocalAssetId: sourceMessage.destinationLocalAssetId,
    destinationCommitment: sourceMessage.destinationCommitment,
    sourceDecimals: SOLANA_DEVNET_WSOL_DECIMALS,
    destinationDecimals: BASE_SEPOLIA_ETH_DECIMALS,
    normalizationMode: SOLANA_DEVNET_TO_BASE_SEPOLIA_WSOL_ASSET.normalizationMode,
  });
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function fixtureFromSolanaBridgeOutInstruction(input: FixtureBuildInput): {
  fixture: SolanaSourceEventFixture & Record<string, unknown>;
  sourceMessageHash: string;
  destinationBridgeMintHash: string;
  destinationMessage: BridgeMessageV1;
} {
  const sourceMessage = decodeSolanaBridgeMessageV1InstructionData(input.instructionData);
  const destinationMessage = destinationBridgeMintMessage(sourceMessage);
  const sourceMessageHash = normalizeHash(hashBridgeMessageV1(sourceMessage));
  const destinationBridgeMintHash = normalizeHash(hashBridgeMessageV1(destinationMessage));

  const fixture: SolanaSourceEventFixture & Record<string, unknown> = {
    sourceChain: 'solana-devnet',
    destinationChain: 'base-sepolia',
    sourceTx: input.signature,
    txHash: input.signature,
    signature: input.signature,
    slot: input.slot,
    blockNumber: input.slot,
    confirmations: input.confirmations,
    finalityMarker: input.confirmations >= 32 ? 'finalized' : 'not_finalized',
    sourceTxSucceeded: input.sourceTxSucceeded,
    eventKind: 'bridge_out_v1_with_proof',
    instruction: 'bridge_out_v1_with_proof',
    sourceEventKind: 'solana_bridge_out_v1_with_proof',
    sourceBoundProofMarker: 'bridge_out_v1_with_proof',
    programId: input.programId ?? SOLANA_DEVNET_PROGRAM_ID,
    encodedMessage: bytesToHex(encodeBridgeMessageV1(sourceMessage)),
    message: sourceMessage,
    sourceMessageHash,
    messageHash: sourceMessageHash,
    destinationBridgeMintHash,
    sourceAmount: sourceMessage.amount.toString(),
    normalizedDestinationAmount: destinationMessage.amount.toString(),
    amount: sourceMessage.amount.toString(),
    canonicalAssetId: sourceMessage.canonicalAssetId,
    sourceLocalAssetId: sourceMessage.sourceLocalAssetId,
    destinationLocalAssetId: sourceMessage.destinationLocalAssetId,
    deadline: sourceMessage.deadline,
    sourceBlockNumber: sourceMessage.sourceBlockNumber,
    sourceFinalityBlock: sourceMessage.sourceFinalityBlock,
    sourceDecimals: SOLANA_DEVNET_WSOL_DECIMALS,
    destinationDecimals: BASE_SEPOLIA_ETH_DECIMALS,
    normalizationMode: 'exact-decimal',
  };

  return { fixture, sourceMessageHash, destinationBridgeMintHash, destinationMessage };
}

function findProgramInstructionData(tx: any, programId: string): Uint8Array {
  const message = tx?.transaction?.message;
  const staticKeys = message?.staticAccountKeys ?? message?.accountKeys ?? [];
  const keys = staticKeys.map((key: PublicKey | string) => key.toString());
  const instructions = message?.compiledInstructions ?? message?.instructions ?? [];
  for (const instruction of instructions) {
    const programKey = instruction.programId?.toString?.() ??
      keys[instruction.programIdIndex] ??
      keys[instruction.programIdIndex ?? instruction.programId];
    if (programKey === programId) return dataToBytes(instruction.data);
  }
  throw new Error('bridge_out_v1_with_proof_instruction_not_found');
}

export async function reconstructFixtureFromSolanaTx(input: {
  signature: string;
  rpcUrl: string;
  outputPath: string;
  expectedSourceHash?: string;
  expectedDestinationHash?: string;
  programId?: string;
}): Promise<FixtureBuildResult> {
  const programId = input.programId ?? SOLANA_DEVNET_PROGRAM_ID;
  const connection = new Connection(input.rpcUrl, 'confirmed');
  const tx = await connection.getTransaction(input.signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error('source_transaction_not_found');
  const finalizedSlot = await connection.getSlot('finalized');
  const confirmations = Math.max(0, finalizedSlot - tx.slot);
  const instructionData = findProgramInstructionData(tx, programId);
  const { fixture, sourceMessageHash, destinationBridgeMintHash, destinationMessage } =
    fixtureFromSolanaBridgeOutInstruction({
      instructionData,
      signature: input.signature,
      slot: tx.slot,
      confirmations,
      sourceTxSucceeded: tx.meta?.err === null,
      programId,
    });

  if (input.expectedSourceHash && normalizeHash(input.expectedSourceHash) !== sourceMessageHash) {
    throw new Error(`source_hash_mismatch:${sourceMessageHash}`);
  }
  if (
    input.expectedDestinationHash &&
    normalizeHash(input.expectedDestinationHash) !== destinationBridgeMintHash
  ) {
    throw new Error(`destination_hash_mismatch:${destinationBridgeMintHash}`);
  }

  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  fs.writeFileSync(input.outputPath, JSON.stringify(fixture, jsonReplacer, 2));

  return {
    ok: true,
    fixturePath: input.outputPath,
    sourceTx: input.signature,
    sourceSlot: tx.slot,
    sourceMessageHash,
    destinationBridgeMintHash,
    sourceAmount: String(fixture.sourceAmount),
    normalizedDestinationAmount: destinationMessage.amount.toString(),
    deadline: Number(fixture.deadline),
    sourceEventParsed: true,
    finalitySatisfied: confirmations >= 32,
    destinationTxSubmitted: false,
    secretsPrinted: false,
  };
}

function rpcUrlFromEnv(env: Record<string, string | undefined>): string {
  return env.SOLANA_DEVNET_RPC_URL ||
    env.RPC_ENDPOINT ||
    env.ANCHOR_PROVIDER_URL ||
    'https://api.devnet.solana.com';
}

async function main(): Promise<void> {
  const env = process.env;
  const signature = env.BRIDGE_SOLANA_SOURCE_TX || PR013A_SOLANA_TO_BASE_SOURCE_TX;
  const outputPath = env.BRIDGE_SOLANA_SOURCE_FIXTURE_PATH || DEFAULT_DURABLE_FIXTURE_PATH;
  const report = await reconstructFixtureFromSolanaTx({
    signature,
    rpcUrl: rpcUrlFromEnv(env),
    outputPath,
    expectedSourceHash: env.BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH || PR013A_SOURCE_MESSAGE_HASH,
    expectedDestinationHash: env.BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH ||
      PR013A_DESTINATION_BRIDGE_MINT_HASH,
    programId: env.PROGRAM_ID || SOLANA_DEVNET_PROGRAM_ID,
  });
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      status: 'blocked',
      error: error instanceof Error ? error.message : String(error),
      destinationTxSubmitted: false,
      secretsPrinted: false,
    }, null, 2));
    process.exit(1);
  });
}
