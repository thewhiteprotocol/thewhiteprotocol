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
  type BridgeMessageState,
  type BridgeRelayerConfig,
  type BridgeSourceAdapter,
  type BridgeDestinationAdapter,
} from './types';
import { BridgeSignerService } from './signer';
import { BridgeStateStore } from './state';
import { logger } from '../logger';

export { BridgeSignerService, BridgeStateStore };
export * from './types';
export * from './evm-adapter';
export * from './solana-adapter';

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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
    event: {
      messageHash: string;
      destinationDomain: number;
      canonicalAssetId: string;
      amount: bigint;
      nonce: number;
      encodedMessage: string;
      txHash: string;
      blockNumber: number;
    },
    sourceAdapter: BridgeSourceAdapter,
    destinationAdapter: BridgeDestinationAdapter,
    route: { source: string; destination: string; signerSetVersion: number }
  ): Promise<boolean> {
    const messageHash = event.messageHash.toLowerCase();

    // Idempotency: already tracked?
    if (this.state.has(messageHash)) {
      logger.info(`Bridge message already tracked: ${messageHash}`);
      return true;
    }

    // Idempotency: already consumed on destination?
    const consumed = await destinationAdapter.isMessageConsumed(messageHash);
    if (consumed) {
      logger.info(`Bridge message already consumed on destination: ${messageHash}`);
      return true;
    }

    // Decode the full message from encoded bytes
    const { decodeBridgeMessageV1 } = await import('./evm-adapter');
    const encodedBytes = hexToUint8Array(event.encodedMessage);
    const message = decodeBridgeMessageV1(encodedBytes);

    // Validate destination domain matches
    if (message.destinationDomain !== event.destinationDomain) {
      logger.warn(
        `Destination domain mismatch for ${messageHash}: event=${event.destinationDomain}, decoded=${message.destinationDomain}`
      );
      return false;
    }

    // Check expiry
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (message.deadline < nowSeconds) {
      logger.warn(`Bridge message expired: ${messageHash}, deadline=${message.deadline}`);
      const expiredState: BridgeMessageState = {
        messageHash,
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
      messageHash,
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
      this.state.update(messageHash, { status: BridgeMessageStatus.FAILED, lastError: 'Missing finality config' });
      return false;
    }

    this.state.update(messageHash, { status: BridgeMessageStatus.FINALITY_WAIT });
    const isFinal = await sourceAdapter.isFinalized(event.txHash, finalityConfig.confirmations);
    if (!isFinal) {
      logger.info(`Bridge message not yet finalized: ${messageHash}`);
      this.state.update(messageHash, { status: BridgeMessageStatus.FINALITY_WAIT });
      return false;
    }

    // Sign
    this.state.update(messageHash, { status: BridgeMessageStatus.READY_TO_ATTEST });
    const allSignatures = await this.signer.signMessage(message);
    const thresholdSigs = this.signer.takeThreshold(allSignatures);
    this.signer.validateSignatureOrder(thresholdSigs);

    this.state.update(messageHash, {
      status: BridgeMessageStatus.SIGNED,
      signatures: thresholdSigs,
    });

    // Submit
    this.state.update(messageHash, { status: BridgeMessageStatus.SUBMITTED, attempts: state.attempts + 1 });
    try {
      const rawSigs = this.signer.extractRawSignatures(thresholdSigs);
      const txHash = await destinationAdapter.submitAcceptBridgeMint(
        message,
        rawSigs,
        route.signerSetVersion
      );
      this.state.update(messageHash, {
        status: BridgeMessageStatus.CONFIRMED,
        submitTxHash: txHash,
      });
      logger.info(`Bridge message confirmed: ${messageHash}, tx=${txHash}`);
      return true;
    } catch (err: any) {
      logger.error(`Bridge submission failed: ${messageHash}, error=${err.message}`);
      this.state.update(messageHash, {
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
