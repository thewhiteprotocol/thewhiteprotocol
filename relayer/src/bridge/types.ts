/**
 * Bridge Relayer Types — PR-010F
 *
 * State machine, message types, and configuration for the bridge
 * attestation relayer service.
 */

import type { BridgeMessageV1 } from '@thewhiteprotocol/core';

// =============================================================================
// State Machine
// =============================================================================

export enum BridgeMessageStatus {
  OBSERVED = 'observed',
  FINALITY_WAIT = 'finality_wait',
  READY_TO_ATTEST = 'ready_to_attest',
  SIGNED = 'signed',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  FROZEN = 'frozen',
  EXPIRED = 'expired',
}

// =============================================================================
// Signature
// =============================================================================

export interface BridgeSignature {
  /** 0x-prefixed 65-byte hex signature: r(32) || s(32) || v(1) */
  signature: string;
  /** Recovered Ethereum address (0x-prefixed, checksummed) */
  signerAddress: string;
}

// =============================================================================
// Message State
// =============================================================================

export interface BridgeMessageState {
  /** Canonical keccak256 hash of the BridgeMessageV1 */
  messageHash: string;
  /** Source chain key (e.g. 'base-sepolia') */
  sourceChain: string;
  /** Destination chain key (e.g. 'ethereum-sepolia') */
  destinationChain: string;
  /** Source domain ID */
  sourceDomain: number;
  /** Destination domain ID */
  destinationDomain: number;
  /** Source transaction hash */
  sourceTxHash: string;
  /** Source block number where event was observed */
  sourceBlockNumber: number;
  /** Required finality block */
  sourceFinalityBlock: number;
  /** Message nonce */
  nonce: number;
  /** Destination commitment */
  destinationCommitment: string;
  /** Canonical asset ID */
  canonicalAssetId: string;
  /** Amount (raw uint128) */
  amount: string;
  /** Threshold signatures (sorted by signer address ascending) */
  signatures: BridgeSignature[];
  /** Destination submission tx hash, if any */
  submitTxHash?: string;
  /** Current status */
  status: BridgeMessageStatus;
  /** Number of submission attempts */
  attempts: number;
  /** Last error message */
  lastError?: string;
  /** Timestamp when first observed */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
  /** Raw BridgeMessageV1 (stored for reconstruction) */
  message: BridgeMessageV1;
}

// =============================================================================
// Signer Config
// =============================================================================

export interface BridgeSignerConfig {
  /** Minimum signatures required */
  threshold: number;
  /** Test private keys — NEVER USE IN PRODUCTION */
  privateKeys: string[];
}

// =============================================================================
// Finality Config
// =============================================================================

export interface BridgeFinalityConfig {
  /** Number of block confirmations required */
  confirmations: number;
  /** Maximum age (seconds) before message is considered expired */
  maxAgeSeconds: number;
}

// =============================================================================
// Route Config
// =============================================================================

export interface BridgeRouteConfig {
  /** Source chain key */
  source: string;
  /** Destination chain key */
  destination: string;
  /** Whether this route is enabled */
  enabled: boolean;
  /** Signer set version to use */
  signerSetVersion: number;
}

// =============================================================================
// Adapter Interfaces
// =============================================================================

export interface BridgeEventObservation {
  messageHash: string;
  destinationDomain: number;
  canonicalAssetId: string;
  amount: bigint;
  nonce: number;
  encodedMessage: string;
  txHash: string;
  blockNumber: number;
}

export interface BridgeSourceAdapter {
  /** Start watching for BridgeOut events */
  watch(): AsyncGenerator<BridgeEventObservation>;
  /** Get current block number */
  getBlockNumber(): Promise<number>;
  /** Check if a transaction has enough confirmations */
  isFinalized(txHash: string, requiredConfirmations: number): Promise<boolean>;
}

export interface BridgeDestinationAdapter {
  /** Check if a message has already been consumed */
  isMessageConsumed(messageHash: string): Promise<boolean>;
  /** Submit acceptBridgeMint with threshold signatures */
  submitAcceptBridgeMint(
    message: BridgeMessageV1,
    signatures: string[],
    signerSetVersion: number
  ): Promise<string>;
}

// =============================================================================
// Service Config
// =============================================================================

export interface BridgeRelayerConfig {
  /** Poll interval in milliseconds */
  pollIntervalMs: number;
  /** Signer configuration */
  signer: BridgeSignerConfig;
  /** Per-chain finality rules */
  finality: Record<string, BridgeFinalityConfig>;
  /** Enabled routes */
  routes: BridgeRouteConfig[];
  /** State store directory */
  stateDir: string;
}
