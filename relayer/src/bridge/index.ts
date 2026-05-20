/**
 * Bridge Relayer Service — PR-010F
 *
 * Orchestrates the bridge attestation flow:
 * 1. Observe BridgeOut events on source chain.
 * 2. Wait for finality.
 * 3. Sign message hash with threshold signers.
 * 4. Submit acceptBridgeMint on destination chain.
 * 5. Persist state and handle duplicates.
 */

import {
  BridgeMessageStatus,
  type BridgeEventObservation,
  type BridgeMessageState,
  type BridgeRelayerConfig,
  type BridgeSourceAdapter,
  type BridgeDestinationAdapter,
  type BridgeRouteAssetConfig,
} from './types';
import { BridgeSignerService } from './signer';
import { BridgeStateStore } from './state';
import { logger } from '../logger';
import {
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import {
  shouldRelayerSign,
  summarizePolicyDecision,
  validateBridgeSourceEvent,
} from './policy';

export {
  BridgeSignerService,
  LocalDevSignerAdapter,
  EnvFileSignerAdapter,
  KmsSignerAdapter,
  HsmSignerAdapter,
  MpcSignerAdapter,
  createBridgeSignerAdapterFromEnv,
  evaluateSigningPolicy,
  type BridgeSignerAdapter,
  type BridgeSigningContext,
  type SignerHealth,
  type SignerPolicyDecision,
} from './signer';
export { BridgeStateStore };
export * from './types';
export * from './evm-adapter';
export * from './solana-adapter';
export * from './solana-source-adapter';
export * from './base-to-solana-route';
export * from './policy';
export * from './watcher';
export * from './watcher-store';
export * from './watcher-daemon';
export * from './watcher-smoke';
export * from './watcher-smoke-fixtures';
export * from './freeze-actions';
export * from './alerts';
export * from './observation';
export * from './daemon';
export * from './daemon-paper-fixture';

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function assertDestinationAmountWithinCaps(
  amount: bigint,
  assetConfig: BridgeRouteAssetConfig
): void {
  if (assetConfig.maxMessageAmount > 0n && amount > assetConfig.maxMessageAmount) {
    throw new Error(
      `destination amount ${amount} exceeds max message amount ${assetConfig.maxMessageAmount}`
    );
  }
  if (assetConfig.dailyCap > 0n && amount > assetConfig.dailyCap) {
    throw new Error(
      `destination amount ${amount} exceeds daily cap ${assetConfig.dailyCap}`
    );
  }
}

export class BridgeRelayerService {
  private readonly signer: BridgeSignerService;
  private readonly state: BridgeStateStore;
  private readonly config: BridgeRelayerConfig;
  private running = false;

  constructor(config: BridgeRelayerConfig) {
    this.config = config;
    this.signer = new BridgeSignerService(config.signer);
    this.state = new BridgeStateStore(config.stateDir);
  }

  /**
   * Process a single observed bridge event.
   * Returns true if the message was handled (new or already tracked).
   */
  async processEvent(
    event: BridgeEventObservation,
    sourceAdapter: BridgeSourceAdapter,
    destinationAdapter: BridgeDestinationAdapter,
    route: { source: string; destination: string; signerSetVersion: number }
  ): Promise<boolean> {
    const sourceMessageHash = event.messageHash.toLowerCase();

    // Decode the full message from encoded bytes
    const { decodeBridgeMessageV1 } = await import('./evm-adapter');
    const encodedBytes = hexToUint8Array(event.encodedMessage);
    const sourceMessage = decodeBridgeMessageV1(encodedBytes);

    const policyDecision = validateBridgeSourceEvent({
      event,
      message: sourceMessage,
      sourceChain: route.source,
      destinationChain: route.destination,
      context: {
        routes: this.config.routes,
        finality: this.config.finality,
      },
    });
    if (!shouldRelayerSign(policyDecision)) {
      logger.warn(
        `Bridge event rejected by production policy for ${sourceMessageHash}: ${summarizePolicyDecision(policyDecision)}`
      );
      if (policyDecision.reasons.some((reason) => reason.startsWith('expired_deadline'))) {
        this.state.set({
          messageHash: sourceMessageHash,
          sourceChain: route.source,
          destinationChain: route.destination,
          sourceDomain: sourceMessage.sourceDomain,
          destinationDomain: sourceMessage.destinationDomain,
          sourceTxHash: event.txHash,
          sourceBlockNumber: event.blockNumber,
          sourceFinalityBlock: sourceMessage.sourceFinalityBlock,
          nonce: sourceMessage.nonce,
          destinationCommitment: sourceMessage.destinationCommitment,
          canonicalAssetId: sourceMessage.canonicalAssetId,
          amount: sourceMessage.amount.toString(),
          signatures: [],
          status: BridgeMessageStatus.EXPIRED,
          attempts: 0,
          lastError: summarizePolicyDecision(policyDecision),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          message: sourceMessage,
        });
      }
      return false;
    }

    // Validate destination domain matches
    if (sourceMessage.destinationDomain !== event.destinationDomain) {
      logger.warn(
        `Destination domain mismatch for ${sourceMessageHash}: event=${event.destinationDomain}, decoded=${sourceMessage.destinationDomain}`
      );
      return false;
    }

    // Determine if message transformation is needed (cross-family bridge)
    const routeConfig = this.config.routes.find(
      (r) => r.source === route.source && r.destination === route.destination
    );
    let message: BridgeMessageV1 = sourceMessage;
    let destinationMessageHash = sourceMessageHash;

    if (routeConfig && !routeConfig.enabled) {
      logger.warn(`Bridge route disabled: ${route.source} -> ${route.destination}`);
      return false;
    }

    if (routeConfig?.assets && routeConfig.assets.length > 0) {
      const assetConfig = routeConfig.assets.find(
        (a) => a.canonicalAssetId.toLowerCase() === sourceMessage.canonicalAssetId.toLowerCase()
      );
      if (!assetConfig) {
        logger.error(
          `No asset normalization config for ${sourceMessageHash}: canonicalAssetId=${sourceMessage.canonicalAssetId}`
        );
        return false;
      }

      try {
        message = buildDestinationBridgeMintMessageFromSourceBridgeOut({
          sourceMessage,
          destinationDomain: sourceMessage.destinationDomain,
          destinationChainId: sourceMessage.destinationChainId,
          destinationLocalAssetId: sourceMessage.destinationLocalAssetId,
          destinationCommitment: sourceMessage.destinationCommitment,
          sourceDecimals: assetConfig.sourceDecimals,
          destinationDecimals: assetConfig.destinationDecimals,
          normalizationMode: assetConfig.normalizationMode,
          rateNumerator: assetConfig.rateNumerator,
          rateDenominator: assetConfig.rateDenominator,
        });
        assertDestinationAmountWithinCaps(message.amount, assetConfig);
        destinationMessageHash = hashBridgeMessageV1(message).toLowerCase();
        logger.info(
          `Transformed BridgeOut→BridgeMint for ${sourceMessageHash}: ` +
          `sourceAmount=${sourceMessage.amount} -> destAmount=${message.amount}, ` +
          `newHash=${destinationMessageHash}`
        );
      } catch (err: any) {
        logger.error(`Message transformation failed for ${sourceMessageHash}: ${err.message}`);
        return false;
      }
    }

    // Idempotency: already tracked by destination hash?
    if (this.state.has(destinationMessageHash)) {
      logger.info(`Bridge message already tracked: ${destinationMessageHash}`);
      return true;
    }

    // Preserve compatibility with pre-normalization source-hash state entries.
    if (destinationMessageHash !== sourceMessageHash && this.state.has(sourceMessageHash)) {
      logger.info(`Bridge source message already tracked: ${sourceMessageHash}`);
      return true;
    }

    // Idempotency: already consumed on destination?
    const consumed = await destinationAdapter.isMessageConsumed(destinationMessageHash);
    if (consumed) {
      logger.info(`Bridge message already consumed on destination: ${destinationMessageHash}`);
      return true;
    }

    // Check expiry
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (message.deadline < nowSeconds) {
      logger.warn(`Bridge message expired: ${destinationMessageHash}, deadline=${message.deadline}`);
      const expiredState: BridgeMessageState = {
        messageHash: destinationMessageHash,
        sourceChain: route.source,
        destinationChain: route.destination,
        sourceDomain: message.sourceDomain,
        destinationDomain: message.destinationDomain,
        sourceTxHash: event.txHash,
        sourceBlockNumber: event.blockNumber,
        sourceFinalityBlock: message.sourceFinalityBlock,
        nonce: message.nonce,
        destinationCommitment: message.destinationCommitment,
        canonicalAssetId: message.canonicalAssetId,
        amount: message.amount.toString(),
        signatures: [],
        status: BridgeMessageStatus.EXPIRED,
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        message,
      };
      this.state.set(expiredState);
      return false;
    }

    // Create initial state
    const state: BridgeMessageState = {
      messageHash: destinationMessageHash,
      sourceChain: route.source,
      destinationChain: route.destination,
      sourceDomain: message.sourceDomain,
      destinationDomain: message.destinationDomain,
      sourceTxHash: event.txHash,
      sourceBlockNumber: event.blockNumber,
      sourceFinalityBlock: message.sourceFinalityBlock,
      nonce: message.nonce,
      destinationCommitment: message.destinationCommitment,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount.toString(),
      signatures: [],
      status: BridgeMessageStatus.OBSERVED,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      message,
    };
    this.state.set(state);

    // Wait for finality
    const finalityConfig = this.config.finality[route.source];
    if (!finalityConfig) {
      logger.error(`No finality config for chain: ${route.source}`);
      this.state.update(destinationMessageHash, { status: BridgeMessageStatus.FAILED, lastError: 'Missing finality config' });
      return false;
    }

    this.state.update(destinationMessageHash, { status: BridgeMessageStatus.FINALITY_WAIT });
    const isFinal = await sourceAdapter.isFinalized(event.txHash, finalityConfig.confirmations);
    if (!isFinal) {
      logger.info(`Bridge message not yet finalized: ${destinationMessageHash}`);
      this.state.update(destinationMessageHash, { status: BridgeMessageStatus.FINALITY_WAIT });
      return false;
    }

    // Sign
    this.state.update(destinationMessageHash, { status: BridgeMessageStatus.READY_TO_ATTEST });
    const allSignatures = await this.signer.signMessage(message, {
      sourceChain: route.source,
      destinationChain: route.destination,
      route: `${route.source}->${route.destination}`,
      riskLevel: policyDecision.severity,
      dryRun: false,
      signerSetVersion: route.signerSetVersion,
      purpose: 'bridge-attestation',
      messageFormat: 'BridgeMessageV1',
      bridgePolicyAccepted: policyDecision.accepted,
      finalitySatisfied: true,
      routeAllowed: true,
      assetSupported: true,
      amountWithinCap: true,
      openCriticalFindings: 0,
    });
    const thresholdSigs = this.signer.takeThreshold(allSignatures);
    this.signer.validateSignatureOrder(thresholdSigs);

    this.state.update(destinationMessageHash, {
      status: BridgeMessageStatus.SIGNED,
      signatures: thresholdSigs,
    });

    // Submit
    this.state.update(destinationMessageHash, { status: BridgeMessageStatus.SUBMITTED, attempts: state.attempts + 1 });
    try {
      const rawSigs = this.signer.extractRawSignatures(thresholdSigs);
      const txHash = await destinationAdapter.submitAcceptBridgeMint(
        message,
        rawSigs,
        route.signerSetVersion
      );
      this.state.update(destinationMessageHash, {
        status: BridgeMessageStatus.CONFIRMED,
        submitTxHash: txHash,
      });
      logger.info(`Bridge message confirmed: ${destinationMessageHash}, tx=${txHash}`);
      return true;
    } catch (err: any) {
      logger.error(`Bridge submission failed: ${destinationMessageHash}, error=${err.message}`);
      this.state.update(destinationMessageHash, {
        status: BridgeMessageStatus.FAILED,
        lastError: err.message,
        attempts: state.attempts + 1,
      });
      return false;
    }
  }

  /**
   * Run one poll cycle for a single source adapter.
   */
  async pollSource(
    sourceAdapter: BridgeSourceAdapter,
    destinationAdapter: BridgeDestinationAdapter,
    route: { source: string; destination: string; signerSetVersion: number }
  ): Promise<void> {
    for await (const event of sourceAdapter.watch()) {
      await this.processEvent(event, sourceAdapter, destinationAdapter, route);
    }
  }

  getState(): BridgeStateStore {
    return this.state;
  }

  getSigner(): BridgeSignerService {
    return this.signer;
  }
}
