/**
 * Solana source observation adapter for hosted paper replay.
 *
 * This adapter consumes bounded, non-secret source event fixtures produced from
 * operator review or future Solana log indexing. It only marks
 * bridge_out_v1_with_proof as source-bound; init_bridge_v1_out remains unsafe
 * and is surfaced as an event kind for policy rejection.
 */

import * as fs from 'fs';
import {
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import { decodeBridgeMessageV1 } from './evm-adapter';
import {
  SOLANA_DEVNET_PROGRAM_ID,
} from './base-to-solana-route';
import type {
  BridgeEventObservation,
  BridgeSourceAdapter,
  BridgeSourceEventKind,
} from './types';

export type SolanaSourceInstruction =
  | 'bridge_out_v1_with_proof'
  | 'init_bridge_v1_out'
  | string;

export interface SolanaSourceEventFixture {
  instruction?: SolanaSourceInstruction;
  sourceEventKind?: BridgeSourceEventKind;
  sourceBoundProofMarker?: 'bridge_out_v1_with_proof';
  programId?: string;
  sourceAddress?: string;
  message?: BridgeMessageV1 | Record<string, unknown>;
  encodedMessage?: string;
  messageHash?: string;
  destinationDomain?: number;
  canonicalAssetId?: string;
  amount?: string | number | bigint;
  nonce?: string | number;
  txHash?: string;
  signature?: string;
  blockNumber?: number;
  slot?: number;
  confirmations?: number;
  sourceTxSucceeded?: boolean;
}

export interface SolanaSourceAdapterConfig {
  observations: BridgeEventObservation[];
  fromBlock?: bigint | number;
  toBlock?: bigint | number;
}

function cleanHex(value: string): string {
  return value.replace(/^0x/i, '').toLowerCase();
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = cleanHex(hex);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function coerceMessage(raw: BridgeMessageV1 | Record<string, unknown>): BridgeMessageV1 {
  const value = raw as any;
  return {
    ...value,
    amount: BigInt(value.amount),
    relayerFee: BigInt(value.relayerFee ?? 0),
  } as BridgeMessageV1;
}

export function decodeSolanaBridgeMessageV1InstructionData(data: Uint8Array): BridgeMessageV1 {
  if (data.length < 8 + 451) {
    throw new Error(`Solana bridge_out_v1_with_proof instruction data too short: ${data.length}`);
  }
  let offset = 8;
  const readUint16 = () => {
    const value = data[offset] | (data[offset + 1] << 8);
    offset += 2;
    return value;
  };
  const readUint8 = () => data[offset++];
  const readUint32 = () => {
    const value = (
      data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)
    ) >>> 0;
    offset += 4;
    return value;
  };
  const readUint64 = () => {
    let value = 0n;
    for (let i = 0; i < 8; i += 1) value |= BigInt(data[offset + i]) << (8n * BigInt(i));
    offset += 8;
    return Number(value);
  };
  const readUint128 = () => {
    let value = 0n;
    for (let i = 0; i < 16; i += 1) value |= BigInt(data[offset + i]) << (8n * BigInt(i));
    offset += 16;
    return value;
  };
  const readBytes32 = () => {
    const value = Buffer.from(data.slice(offset, offset + 32)).toString('hex');
    offset += 32;
    return value;
  };

  return {
    protocolVersion: readUint16(),
    messageType: readUint8(),
    sourceDomain: readUint32(),
    destinationDomain: readUint32(),
    sourceChainId: readUint64(),
    destinationChainId: readUint64(),
    canonicalAssetId: readBytes32(),
    sourceLocalAssetId: readBytes32(),
    destinationLocalAssetId: readBytes32(),
    amount: readUint128(),
    sourceNullifierHash: readBytes32(),
    destinationCommitment: readBytes32(),
    sourceRoot: readBytes32(),
    sourceLeafIndex: readUint64(),
    sourceTxHash: readBytes32(),
    sourceBlockNumber: readUint64(),
    sourceFinalityBlock: readUint64(),
    nonce: readUint64(),
    deadline: readUint64(),
    relayerFee: readUint128(),
    recipientStealthMetadataHash: readBytes32(),
    memoHash: readBytes32(),
    reserved0: readBytes32(),
    reserved1: readBytes32(),
  };
}

function eventKindFromInstruction(instruction?: SolanaSourceInstruction): BridgeSourceEventKind {
  if (instruction === 'init_bridge_v1_out') return 'solana_init_bridge_v1_out';
  if (instruction === 'bridge_out_v1_with_proof' || !instruction) {
    return 'solana_bridge_out_v1_with_proof';
  }
  return 'unknown';
}

function encodedMessageFromFixture(fixture: SolanaSourceEventFixture): {
  encodedMessage: string;
  message: BridgeMessageV1;
} {
  if (fixture.encodedMessage) {
    const encodedMessage = fixture.encodedMessage.startsWith('0x')
      ? fixture.encodedMessage
      : `0x${fixture.encodedMessage}`;
    return {
      encodedMessage,
      message: decodeBridgeMessageV1(hexToBytes(encodedMessage)),
    };
  }
  if (!fixture.message) {
    throw new Error('Solana source event fixture requires encodedMessage or message');
  }
  const message = coerceMessage(fixture.message);
  return {
    encodedMessage: bytesToHex(encodeBridgeMessageV1(message)),
    message,
  };
}

export function solanaSourceObservationFromFixture(
  fixture: SolanaSourceEventFixture
): BridgeEventObservation {
  const { encodedMessage, message } = encodedMessageFromFixture(fixture);
  const kind = fixture.sourceEventKind ?? eventKindFromInstruction(fixture.instruction);
  const amount = fixture.amount === undefined ? message.amount : BigInt(fixture.amount);
  const nonce = fixture.nonce === undefined ? message.nonce : Number(fixture.nonce);
  return {
    messageHash: fixture.messageHash ?? hashBridgeMessageV1(message),
    destinationDomain: fixture.destinationDomain ?? message.destinationDomain,
    canonicalAssetId: fixture.canonicalAssetId ?? message.canonicalAssetId,
    amount,
    nonce,
    encodedMessage,
    txHash: fixture.txHash ?? fixture.signature ?? message.sourceTxHash,
    blockNumber: fixture.blockNumber ?? fixture.slot ?? message.sourceBlockNumber,
    confirmations: fixture.confirmations,
    sourceTxSucceeded: fixture.sourceTxSucceeded ?? true,
    sourceEventKind: kind,
    sourceAddress: fixture.sourceAddress ?? fixture.programId ?? SOLANA_DEVNET_PROGRAM_ID,
    sourceChain: 'solana-devnet',
    sourceBoundProofMarker: kind === 'solana_bridge_out_v1_with_proof'
      ? fixture.sourceBoundProofMarker
      : fixture.sourceBoundProofMarker,
  };
}

export function loadSolanaSourceObservationsFromFile(filePath: string): BridgeEventObservation[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as any;
  const events = Array.isArray(parsed)
    ? parsed
    : parsed.events ?? parsed.observations ?? [parsed as SolanaSourceEventFixture];
  return events.map((event) => solanaSourceObservationFromFixture(event));
}

export class SolanaSourceAdapter implements BridgeSourceAdapter {
  private readonly observations: BridgeEventObservation[];
  private readonly fromBlock?: bigint;
  private readonly toBlock?: bigint;

  constructor(config: SolanaSourceAdapterConfig) {
    this.observations = config.observations;
    this.fromBlock = config.fromBlock === undefined ? undefined : BigInt(config.fromBlock);
    this.toBlock = config.toBlock === undefined ? undefined : BigInt(config.toBlock);
  }

  static fromFile(filePath: string, options: Omit<SolanaSourceAdapterConfig, 'observations'> = {}): SolanaSourceAdapter {
    return new SolanaSourceAdapter({
      ...options,
      observations: loadSolanaSourceObservationsFromFile(filePath),
    });
  }

  async *watch(): AsyncGenerator<BridgeEventObservation> {
    for (const observation of this.observations) {
      const block = BigInt(observation.blockNumber);
      if (this.fromBlock !== undefined && block < this.fromBlock) continue;
      if (this.toBlock !== undefined && block > this.toBlock) continue;
      yield observation;
    }
  }

  async getBlockNumber(): Promise<number> {
    return this.observations.reduce((max, event) => Math.max(max, event.blockNumber), 0);
  }

  async isFinalized(txHash: string, requiredConfirmations: number): Promise<boolean> {
    const observation = this.observations.find((event) => event.txHash === txHash);
    return (observation?.confirmations ?? 0) >= requiredConfirmations;
  }
}
