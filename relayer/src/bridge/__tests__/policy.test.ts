import {
  BridgeMessageType,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import {
  containsPolicyReason,
  validateBridgeSourceEvent,
  validateCrossDecimalPolicy,
} from '../policy';
import {
  loadBridgeWatcherConfigFromEnv,
  shouldRecommendFreeze,
  watchBridgeMessage,
} from '../watcher';
import type {
  BridgeEventObservation,
  BridgeRouteAssetConfig,
  BridgeRouteConfig,
} from '../types';

const BASE_DOMAIN = 0x02000002;
const ETHEREUM_DOMAIN = 0x02000003;
const SOLANA_DOMAIN = 0x01000002;
const BASE_CHAIN_ID = 84532;
const ETHEREUM_CHAIN_ID = 11155111;
const SOLANA_CHAIN_ID = 0;
const SOLANA_PROGRAM_ID = 'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD';

const BASE_ASSET =
  '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70';
const SOLANA_ASSET =
  '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0';
const OTHER_ASSET = '0'.repeat(63) + '9';

const BASE_ETH_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: BASE_ASSET,
  sourceDecimals: 18,
  destinationDecimals: 18,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 5_000_000_000_000_000_000n,
  dailyCap: 10_000_000_000_000_000_000n,
  capAmountUnits: 'source',
};

const BASE_TO_SOLANA_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: BASE_ASSET,
  sourceDecimals: 18,
  destinationDecimals: 9,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 10_000_000_000_000n,
  dailyCap: 100_000_000_000_000n,
  capAmountUnits: 'destination',
};

const SOLANA_TO_BASE_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: SOLANA_ASSET,
  sourceDecimals: 9,
  destinationDecimals: 18,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: 10_000_000n,
  dailyCap: 100_000_000n,
  capAmountUnits: 'source',
};

function routes(): BridgeRouteConfig[] {
  return [
    {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      enabled: true,
      signerSetVersion: 1,
      status: 'test-only',
      assets: [BASE_ETH_ASSET],
    },
    {
      source: 'base-sepolia',
      destination: 'solana-devnet',
      enabled: true,
      signerSetVersion: 1,
      status: 'test-only',
      assets: [BASE_TO_SOLANA_ASSET],
    },
    {
      source: 'solana-devnet',
      destination: 'base-sepolia',
      enabled: true,
      signerSetVersion: 1,
      status: 'test-only',
      assets: [SOLANA_TO_BASE_ASSET],
    },
  ];
}

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    routes: routes(),
    finality: {
      'base-sepolia': { confirmations: 3, maxAgeSeconds: 86_400 },
      'solana-devnet': { confirmations: 32, maxAgeSeconds: 86_400 },
    },
    nowSeconds: 1_800_000_000,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: BASE_DOMAIN,
    destinationDomain: ETHEREUM_DOMAIN,
    sourceChainId: BASE_CHAIN_ID,
    destinationChainId: ETHEREUM_CHAIN_ID,
    canonicalAssetId: BASE_ASSET,
    sourceLocalAssetId: BASE_ASSET,
    destinationLocalAssetId: BASE_ASSET,
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

function makeEvent(
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
    txHash: '0xsourceTx',
    blockNumber: message.sourceBlockNumber,
    sourceEventKind: 'evm_bridge_out_v1',
    sourceTxSucceeded: true,
    confirmations: 5,
    ...overrides,
  };
}

function validate(
  message: BridgeMessageV1,
  event: BridgeEventObservation,
  sourceChain = 'base-sepolia',
  destinationChain = 'ethereum-sepolia',
  context = baseContext()
) {
  return validateBridgeSourceEvent({
    event,
    message,
    sourceChain,
    destinationChain,
    context,
  });
}

describe('bridge production policy', () => {
  test('accepts EVM source-bound bridgeOutV1 events', () => {
    const message = makeMessage();
    const decision = validate(message, makeEvent(message));
    expect(decision.accepted).toBe(true);
  });

  test('rejects unsafe/direct EVM outbox events when distinguishable', () => {
    const message = makeMessage();
    const decision = validate(
      message,
      makeEvent(message, { sourceEventKind: 'evm_bridge_outbox_direct' })
    );
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'unsafe_evm_direct_outbox_event')).toBe(true);
  });

  test('accepts Solana bridge_out_v1_with_proof events', () => {
    const message = makeMessage({
      sourceDomain: SOLANA_DOMAIN,
      destinationDomain: BASE_DOMAIN,
      sourceChainId: SOLANA_CHAIN_ID,
      destinationChainId: BASE_CHAIN_ID,
      canonicalAssetId: SOLANA_ASSET,
      sourceLocalAssetId: SOLANA_ASSET,
      destinationLocalAssetId: BASE_ASSET,
      amount: 1_000_000n,
      sourceFinalityBlock: 132,
    });
    const decision = validate(
      message,
      makeEvent(message, {
        sourceEventKind: 'solana_bridge_out_v1_with_proof',
        sourceBoundProofMarker: 'bridge_out_v1_with_proof',
        sourceAddress: SOLANA_PROGRAM_ID,
        confirmations: 40,
      }),
      'solana-devnet',
      'base-sepolia'
    );
    expect(decision.accepted).toBe(true);
  });

  test('rejects Solana init_bridge_v1_out events', () => {
    const message = makeMessage({
      sourceDomain: SOLANA_DOMAIN,
      destinationDomain: BASE_DOMAIN,
      sourceChainId: SOLANA_CHAIN_ID,
      destinationChainId: BASE_CHAIN_ID,
      canonicalAssetId: SOLANA_ASSET,
      sourceLocalAssetId: SOLANA_ASSET,
      destinationLocalAssetId: BASE_ASSET,
      amount: 1_000_000n,
      sourceFinalityBlock: 132,
    });
    const decision = validate(
      message,
      makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      'solana-devnet',
      'base-sepolia'
    );
    expect(decision.accepted).toBe(false);
    expect(decision.action).toBe('ignore');
    expect(containsPolicyReason(decision, 'unsafe_solana_init_bridge_v1_out')).toBe(true);
  });

  test('rejects Solana source events missing source-bound proof marker', () => {
    const message = makeMessage({
      sourceDomain: SOLANA_DOMAIN,
      destinationDomain: BASE_DOMAIN,
      sourceChainId: SOLANA_CHAIN_ID,
      destinationChainId: BASE_CHAIN_ID,
      canonicalAssetId: SOLANA_ASSET,
      sourceLocalAssetId: SOLANA_ASSET,
      destinationLocalAssetId: BASE_ASSET,
      amount: 1_000_000n,
      sourceFinalityBlock: 132,
    });
    const decision = validate(
      message,
      makeEvent(message, {
        sourceEventKind: 'solana_bridge_out_v1_with_proof',
        sourceAddress: SOLANA_PROGRAM_ID,
        confirmations: 40,
      }),
      'solana-devnet',
      'base-sepolia'
    );
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'missing_solana_source_bound_proof_marker')).toBe(true);
  });

  test('rejects wrong sourceDomain', () => {
    const message = makeMessage({ sourceDomain: SOLANA_DOMAIN });
    const decision = validate(message, makeEvent(message));
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'wrong_source_domain')).toBe(true);
  });

  test('rejects wrong destinationDomain', () => {
    const message = makeMessage({ destinationDomain: SOLANA_DOMAIN, destinationChainId: ETHEREUM_CHAIN_ID });
    const decision = validate(message, makeEvent(message));
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'wrong_destination_domain')).toBe(true);
  });

  test('rejects unsupported assets', () => {
    const message = makeMessage({ canonicalAssetId: OTHER_ASSET });
    const decision = validate(message, makeEvent(message));
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'unsupported_asset')).toBe(true);
  });

  test('rejects amount over route cap', () => {
    const message = makeMessage({ amount: 10_000n });
    const cappedRoute: BridgeRouteConfig = {
      source: 'base-sepolia',
      destination: 'ethereum-sepolia',
      enabled: true,
      signerSetVersion: 1,
      assets: [{ ...BASE_ETH_ASSET, maxMessageAmount: 100n, dailyCap: 1000n }],
    };
    const decision = validate(
      message,
      makeEvent(message),
      'base-sepolia',
      'ethereum-sepolia',
      baseContext({ routes: [cappedRoute] })
    );
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'amount_over_max_message_amount')).toBe(true);
  });

  test('rejects expired deadlines', () => {
    const message = makeMessage({ deadline: 1_700_000_000 });
    const decision = validate(message, makeEvent(message));
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'expired_deadline')).toBe(true);
  });

  test('delays not-final source events', () => {
    const message = makeMessage();
    const decision = validate(message, makeEvent(message, { confirmations: 1 }));
    expect(decision.accepted).toBe(false);
    expect(decision.action).toBe('delay');
    expect(containsPolicyReason(decision, 'source_not_final')).toBe(true);
  });

  test('rejects duplicate message hashes from relayer state', () => {
    const message = makeMessage();
    const decision = validate(
      message,
      makeEvent(message),
      'base-sepolia',
      'ethereum-sepolia',
      baseContext({ stateHasMessage: true })
    );
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'duplicate_message_hash_state')).toBe(true);
  });

  test('rejects cross-decimal amount mismatch', () => {
    const source = makeMessage({
      destinationDomain: SOLANA_DOMAIN,
      destinationChainId: SOLANA_CHAIN_ID,
      destinationLocalAssetId: SOLANA_ASSET,
      amount: 1_000_000_000_000_000n,
    });
    const destination = {
      ...source,
      messageType: BridgeMessageType.BridgeMint,
      amount: 999_999n,
    };
    const decision = validateCrossDecimalPolicy(
      source,
      destination,
      BASE_TO_SOLANA_ASSET
    );
    expect(decision.accepted).toBe(false);
    expect(containsPolicyReason(decision, 'cross_decimal_mismatch')).toBe(true);
  });

  test('accepts valid Base to Solana source events', () => {
    const message = makeMessage({
      destinationDomain: SOLANA_DOMAIN,
      destinationChainId: SOLANA_CHAIN_ID,
      destinationLocalAssetId: SOLANA_ASSET,
      amount: 1_000_000_000_000_000n,
    });
    const decision = validate(
      message,
      makeEvent(message),
      'base-sepolia',
      'solana-devnet'
    );
    expect(decision.accepted).toBe(true);
  });

  test('accepts valid Solana to Base source events', () => {
    const message = makeMessage({
      sourceDomain: SOLANA_DOMAIN,
      destinationDomain: BASE_DOMAIN,
      sourceChainId: SOLANA_CHAIN_ID,
      destinationChainId: BASE_CHAIN_ID,
      canonicalAssetId: SOLANA_ASSET,
      sourceLocalAssetId: SOLANA_ASSET,
      destinationLocalAssetId: BASE_ASSET,
      amount: 1_000_000n,
      sourceFinalityBlock: 132,
    });
    const decision = validate(
      message,
      makeEvent(message, {
        sourceEventKind: 'solana_bridge_out_v1_with_proof',
        sourceBoundProofMarker: 'bridge_out_v1_with_proof',
        sourceAddress: SOLANA_PROGRAM_ID,
        confirmations: 40,
      }),
      'solana-devnet',
      'base-sepolia'
    );
    expect(decision.accepted).toBe(true);
  });
});

describe('bridge watcher policy', () => {
  test('recommends freeze for high-risk unsafe source events', () => {
    const message = makeMessage({
      sourceDomain: SOLANA_DOMAIN,
      destinationDomain: BASE_DOMAIN,
      sourceChainId: SOLANA_CHAIN_ID,
      destinationChainId: BASE_CHAIN_ID,
      canonicalAssetId: SOLANA_ASSET,
      sourceLocalAssetId: SOLANA_ASSET,
      destinationLocalAssetId: BASE_ASSET,
      amount: 1_000_000n,
      sourceFinalityBlock: 132,
    });
    const result = watchBridgeMessage({
      event: makeEvent(message, {
        sourceEventKind: 'solana_init_bridge_v1_out',
        confirmations: 40,
      }),
      message,
      sourceChain: 'solana-devnet',
      destinationChain: 'base-sepolia',
      context: baseContext(),
    });
    expect(result.recommendedAction).toBe('freeze');
    expect(shouldRecommendFreeze(result.findings)).toBe(true);
  });

  test('recommends manual review for high-value messages', () => {
    const message = makeMessage({ amount: 2_000_000_000_000_000n });
    const result = watchBridgeMessage({
      event: makeEvent(message),
      message,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      context: baseContext({
        manualReviewAmount: 1_000_000_000_000_000n,
      }),
    });
    expect(result.recommendedAction).toBe('manual_review');
  });

  test('recommends freeze for destination cross-decimal mismatch', () => {
    const source = makeMessage({
      destinationDomain: SOLANA_DOMAIN,
      destinationChainId: SOLANA_CHAIN_ID,
      destinationLocalAssetId: SOLANA_ASSET,
      amount: 1_000_000_000_000_000n,
    });
    const destination = {
      ...source,
      messageType: BridgeMessageType.BridgeMint,
      amount: 2_000_000n,
    };
    const result = watchBridgeMessage({
      event: makeEvent(source),
      message: source,
      destinationMessage: destination,
      sourceChain: 'base-sepolia',
      destinationChain: 'solana-devnet',
      context: baseContext(),
    });
    expect(result.recommendedAction).toBe('freeze');
    expect(result.findings.some((item) => item.code === 'cross_decimal_mismatch')).toBe(true);
  });

  test('loads watcher config from non-secret env names', () => {
    const config = loadBridgeWatcherConfigFromEnv({
      BRIDGE_WATCHER_ENABLED: 'true',
      BRIDGE_MAX_FAST_PATH_AMOUNT: '1000',
      BRIDGE_MANUAL_REVIEW_AMOUNT: '5000',
      BRIDGE_FINALITY_OVERRIDES: '{"base-sepolia":5}',
    });
    expect(config.enabled).toBe(true);
    expect(config.maxFastPathAmount).toBe(1000n);
    expect(config.manualReviewAmount).toBe(5000n);
    expect(config.finalityOverrides?.['base-sepolia'].confirmations).toBe(5);
  });
});
