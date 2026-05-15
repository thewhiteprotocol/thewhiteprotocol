import * as fs from 'fs';
import * as path from 'path';
import {
  BridgeMessageType,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  parseBridgeMessageV1Json,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import type { BridgeEventObservation, BridgeRouteConfig } from './types';

export interface HistoricalPaperEventFixture {
  label: string;
  sourceChain: string;
  destinationChain: string;
  event: BridgeEventObservation;
  message: BridgeMessageV1;
  route: BridgeRouteConfig;
  asOfMs: number;
  sourceTxHash: string;
  sourceBlockNumber: number;
  sourceFinalityBlock: number;
}

function repoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function loadBaseToSolanaHistoricalPaperFixture(
  fixturePath = path.join(repoRoot(), 'chains/evm/test/base-to-solana-bridge-state.json')
): HistoricalPaperEventFixture {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as any;
  const message = parseBridgeMessageV1Json(raw.sourceMessage ?? raw.message);
  if (message.messageType !== BridgeMessageType.BridgeOut) {
    throw new Error('Historical paper fixture is not a BridgeOut source message');
  }
  const messageHash = hashBridgeMessageV1(message);
  const expectedHash = String(raw.sourceMessageHash ?? raw.messageHash).toLowerCase();
  if (messageHash.toLowerCase() !== expectedHash) {
    throw new Error('Historical paper fixture message hash mismatch');
  }

  return {
    label: 'PR-010W Base Sepolia -> Solana Devnet historical BridgeOut',
    sourceChain: 'base-sepolia',
    destinationChain: 'solana-devnet',
    message,
    sourceTxHash: raw.bridgeOutTx,
    sourceBlockNumber: Number(raw.bridgeOutBlockNumber),
    sourceFinalityBlock: Number(raw.bridgeOutFinalityBlock),
    asOfMs: (message.deadline - 60) * 1000,
    event: {
      messageHash,
      destinationDomain: message.destinationDomain,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount,
      nonce: message.nonce,
      encodedMessage: bytesToHex(encodeBridgeMessageV1(message)),
      txHash: raw.bridgeOutTx,
      blockNumber: Number(raw.bridgeOutBlockNumber),
      sourceEventKind: 'evm_bridge_out_v1',
      sourceAddress: raw.baseBridgeOutbox,
      confirmations: Math.max(64, Number(raw.bridgeOutFinalityBlock) - Number(raw.bridgeOutBlockNumber)),
      sourceTxSucceeded: true,
    },
    route: {
      source: 'base-sepolia',
      destination: 'solana-devnet',
      enabled: true,
      status: 'test-only',
      signerSetVersion: 1,
      assets: [
        {
          canonicalAssetId: message.canonicalAssetId,
          sourceDecimals: 18,
          destinationDecimals: 9,
          normalizationMode: 'exact-decimal',
          maxMessageAmount: 10_000_000_000n,
          dailyCap: 10_000_000_000n,
          capAmountUnits: 'destination',
        },
      ],
    },
  };
}
