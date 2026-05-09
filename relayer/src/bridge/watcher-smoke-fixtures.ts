/**
 * Deterministic synthetic bridge watcher fixtures.
 *
 * Test-only/offline inputs for smoke checks. They contain no secrets and never
 * require live RPC or freeze transaction submission.
 */

import {
  BridgeMessageType,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import type {
  BridgeEventObservation,
  BridgeFinalityConfig,
  BridgeRouteAssetConfig,
  BridgeRouteConfig,
} from './types';
import type { BridgeWatchInput } from './watcher';

export const SMOKE_BASE_DOMAIN = 0x02000002;
export const SMOKE_ETHEREUM_DOMAIN = 0x02000003;
export const SMOKE_SOLANA_DOMAIN = 0x01000002;
export const SMOKE_BASE_CHAIN_ID = 84532;
export const SMOKE_ETHEREUM_CHAIN_ID = 11155111;
export const SMOKE_SOLANA_CHAIN_ID = 0;
export const SMOKE_SOLANA_PROGRAM_ID = 'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD';

export const SMOKE_BASE_ASSET =
  '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70';
export const SMOKE_SOLANA_ASSET =
  '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0';
export const SMOKE_UNSUPPORTED_ASSET = '0'.repeat(63) + '9';

export const SMOKE_BASE_ETH_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: SMOKE_BASE_ASSET,
  sourceDecimals: 18,
  destinationDecimals: 18,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 5_000_000_000_000_000_000n,
  dailyCap: 10_000_000_000_000_000_000n,
  capAmountUnits: 'source',
};

export const SMOKE_BASE_TO_SOLANA_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: SMOKE_BASE_ASSET,
  sourceDecimals: 18,
  destinationDecimals: 9,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 10_000_000_000_000n,
  dailyCap: 100_000_000_000_000n,
  capAmountUnits: 'destination',
};

export const SMOKE_SOLANA_TO_BASE_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: SMOKE_SOLANA_ASSET,
  sourceDecimals: 9,
  destinationDecimals: 18,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 10_000_000n,
  dailyCap: 100_000_000n,
  capAmountUnits: 'source',
};

export interface SyntheticWatcherFindingFixture {
  name: string;
  expectedCode: string;
  input: BridgeWatchInput;
}

export function makeSyntheticBridgeRoutes(
  baseEthAsset: BridgeRouteAssetConfig = SMOKE_BASE_ETH_ASSET
): BridgeRouteConfig[] {
  return [
    {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      enabled: true,
      signerSetVersion: 1,
      assets: [baseEthAsset],
    },
    {
      source: 'base-sepolia',
      destination: 'solana-devnet',
      enabled: true,
      signerSetVersion: 1,
      assets: [SMOKE_BASE_TO_SOLANA_ASSET],
    },
    {
      source: 'solana-devnet',
      destination: 'base-sepolia',
      enabled: true,
      signerSetVersion: 1,
      assets: [SMOKE_SOLANA_TO_BASE_ASSET],
    },
  ];
}

export function makeSyntheticFinality(): Record<string, BridgeFinalityConfig> {
  return {
    'base-sepolia': { confirmations: 3, maxAgeSeconds: 86_400 },
    'solana-devnet': { confirmations: 32, maxAgeSeconds: 86_400 },
  };
}

export function makeSyntheticBridgeOutMessage(
  overrides: Partial<BridgeMessageV1> = {}
): BridgeMessageV1 {
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: SMOKE_BASE_DOMAIN,
    destinationDomain: SMOKE_ETHEREUM_DOMAIN,
    sourceChainId: SMOKE_BASE_CHAIN_ID,
    destinationChainId: SMOKE_ETHEREUM_CHAIN_ID,
    canonicalAssetId: SMOKE_BASE_ASSET,
    sourceLocalAssetId: SMOKE_BASE_ASSET,
    destinationLocalAssetId: SMOKE_BASE_ASSET,
    amount: 1_000_000_000_000_000n,
    sourceNullifierHash: '0'.repeat(63) + '2',
    destinationCommitment: '0'.repeat(63) + '3',
    sourceRoot: '0'.repeat(63) + '4',
    sourceLeafIndex: 7,
    sourceTxHash: '0'.repeat(63) + '5',
    sourceBlockNumber: 100,
    sourceFinalityBlock: 103,
    nonce: 42,
    deadline: 1_800_086_400,
    relayerFee: 0n,
    recipientStealthMetadataHash: '0'.repeat(64),
    memoHash: '0'.repeat(64),
    reserved0: '0'.repeat(64),
    reserved1: '0'.repeat(64),
    ...overrides,
  };
}

export function makeSyntheticSolanaBridgeOutMessage(
  overrides: Partial<BridgeMessageV1> = {}
): BridgeMessageV1 {
  return makeSyntheticBridgeOutMessage({
    sourceDomain: SMOKE_SOLANA_DOMAIN,
    destinationDomain: SMOKE_BASE_DOMAIN,
    sourceChainId: SMOKE_SOLANA_CHAIN_ID,
    destinationChainId: SMOKE_BASE_CHAIN_ID,
    canonicalAssetId: SMOKE_SOLANA_ASSET,
    sourceLocalAssetId: SMOKE_SOLANA_ASSET,
    destinationLocalAssetId: SMOKE_BASE_ASSET,
    amount: 1_000_000n,
    sourceFinalityBlock: 132,
    ...overrides,
  });
}

export function makeSyntheticEvent(
  message: BridgeMessageV1,
  overrides: Partial<BridgeEventObservation> = {}
): BridgeEventObservation {
  const encoded = encodeBridgeMessageV1(message);
  return {
    messageHash: hashBridgeMessageV1(message),
    destinationDomain: message.destinationDomain,
    canonicalAssetId: message.canonicalAssetId,
    amount: message.amount,
    nonce: message.nonce,
    encodedMessage:
      '0x' + Array.from(encoded).map((b) => b.toString(16).padStart(2, '0')).join(''),
    txHash: '0xsyntheticSourceTx',
    blockNumber: message.sourceBlockNumber,
    sourceEventKind: 'evm_bridge_out_v1',
    confirmations: 5,
    sourceTxSucceeded: true,
    ...overrides,
  };
}

function makeInput(params: {
  message: BridgeMessageV1;
  sourceChain: string;
  destinationChain: string;
  event?: Partial<BridgeEventObservation>;
  destinationMessage?: BridgeMessageV1;
  routes?: BridgeRouteConfig[];
}): BridgeWatchInput {
  return {
    event: makeSyntheticEvent(params.message, params.event),
    message: params.message,
    destinationMessage: params.destinationMessage,
    sourceChain: params.sourceChain,
    destinationChain: params.destinationChain,
    context: {
      routes: params.routes ?? makeSyntheticBridgeRoutes(),
      finality: makeSyntheticFinality(),
      nowSeconds: 1_800_000_000,
    },
  };
}

export function makeSyntheticWatcherFindingFixtures(): SyntheticWatcherFindingFixture[] {
  const unsafeSolana = makeSyntheticSolanaBridgeOutMessage();
  const overCap = makeSyntheticBridgeOutMessage({ amount: 10_000n });
  const expired = makeSyntheticBridgeOutMessage({ deadline: 1_700_000_000 });
  const unsupported = makeSyntheticBridgeOutMessage({
    canonicalAssetId: SMOKE_UNSUPPORTED_ASSET,
  });
  const notFinal = makeSyntheticBridgeOutMessage();
  const crossDecimal = makeSyntheticBridgeOutMessage({
    destinationDomain: SMOKE_SOLANA_DOMAIN,
    destinationChainId: SMOKE_SOLANA_CHAIN_ID,
    destinationLocalAssetId: SMOKE_SOLANA_ASSET,
    amount: 1_000_000_000_000_000n,
  });
  const badDestination = {
    ...crossDecimal,
    messageType: BridgeMessageType.BridgeMint,
    amount: 2_000_000n,
  };

  return [
    {
      name: 'unsafe-solana-init-bridge-v1-out',
      expectedCode: 'unsafe_solana_init_bridge_v1_out',
      input: makeInput({
        message: unsafeSolana,
        sourceChain: 'solana-devnet',
        destinationChain: 'base-sepolia',
        event: {
          sourceEventKind: 'solana_init_bridge_v1_out',
          confirmations: 40,
        },
      }),
    },
    {
      name: 'over-cap-amount',
      expectedCode: 'amount_over_max_message_amount',
      input: makeInput({
        message: overCap,
        sourceChain: 'base-sepolia',
        destinationChain: 'ethereum-sepolia',
        routes: makeSyntheticBridgeRoutes({
          ...SMOKE_BASE_ETH_ASSET,
          maxMessageAmount: 100n,
          dailyCap: 1000n,
        }),
      }),
    },
    {
      name: 'expired-deadline',
      expectedCode: 'expired_deadline',
      input: makeInput({
        message: expired,
        sourceChain: 'base-sepolia',
        destinationChain: 'ethereum-sepolia',
      }),
    },
    {
      name: 'unsupported-asset',
      expectedCode: 'unsupported_asset',
      input: makeInput({
        message: unsupported,
        sourceChain: 'base-sepolia',
        destinationChain: 'ethereum-sepolia',
      }),
    },
    {
      name: 'not-final-source',
      expectedCode: 'source_not_final',
      input: makeInput({
        message: notFinal,
        sourceChain: 'base-sepolia',
        destinationChain: 'ethereum-sepolia',
        event: { confirmations: 1 },
      }),
    },
    {
      name: 'cross-decimal-mismatch',
      expectedCode: 'cross_decimal_mismatch',
      input: makeInput({
        message: crossDecimal,
        destinationMessage: badDestination,
        sourceChain: 'base-sepolia',
        destinationChain: 'solana-devnet',
      }),
    },
  ];
}
