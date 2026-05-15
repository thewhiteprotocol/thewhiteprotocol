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
  POLICY_CHECKED = 'policy_checked',
  FINALITY_WAIT = 'finality_wait',
  READY_TO_ATTEST = 'ready_to_attest',
  READY_TO_SIGN = 'ready_to_sign',
  SIGNED = 'signed',
  PAPER_READY_TO_SUBMIT = 'paper_ready_to_submit',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
  FAILED = 'failed',
  IGNORED = 'ignored',
  FROZEN = 'frozen',
  FROZEN_OR_BLOCKED = 'frozen_or_blocked',
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
  /** PR-011G daemon transition history. No secrets. */
  daemonTransitions?: Array<{
    status: BridgeMessageStatus;
    at: number;
    reason?: string;
  }>;
  /** Sanitized policy decision captured by daemon mode. */
  policyDecision?: BridgePolicyDecision;
  /** Whether source finality was satisfied when the daemon last evaluated it. */
  finalitySatisfied?: boolean;
  /** Sanitized signing policy decision. */
  signingDecision?: {
    accepted: boolean;
    action: string;
    reasons: string[];
    adapterType?: string;
  };
  /** Signature metadata only. Raw signatures are already in signatures. */
  signatureMetadata?: {
    signerSetVersion: number;
    signerCount: number;
    threshold: number;
    signerAddresses: string[];
  };
  /** Destination submission preview for paper mode or before live-testnet submit. */
  submissionPreview?: Record<string, unknown>;
  /** Paper-mode marker: destination submit would be attempted outside paper mode. */
  wouldSubmit?: boolean;
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
  /** Human-readable finality rationale */
  reason?: string;
  /** Production recommendation for this chain */
  productionRecommendation?: string;
}

// =============================================================================
// Route Asset Config
// =============================================================================

export interface BridgeRouteAssetConfig {
  /** Canonical asset ID (64-char hex, no 0x prefix) */
  canonicalAssetId: string;
  /** Source token decimals */
  sourceDecimals: number;
  /** Destination token decimals */
  destinationDecimals: number;
  /** Amount normalization mode */
  normalizationMode: 'exact-decimal' | 'fixed-rate';
  /** Fixed-rate numerator (only for fixed-rate mode) */
  rateNumerator?: bigint;
  /** Fixed-rate denominator (only for fixed-rate mode) */
  rateDenominator?: bigint;
  /** Max message amount in destination-local units */
  maxMessageAmount: bigint;
  /** Daily cap in destination-local units */
  dailyCap: bigint;
  /** Whether maxMessageAmount/dailyCap are source- or destination-local units */
  capAmountUnits?: 'source' | 'destination';
}

export type BridgeRouteStatus = 'live' | 'test-only' | 'disabled' | 'manual-review';

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
  /** Operational status for watcher/policy decisions */
  status?: BridgeRouteStatus;
  /** Signer set version to use */
  signerSetVersion: number;
  /** Per-asset configuration for this route */
  assets?: BridgeRouteAssetConfig[];
  /** Optional fast-path threshold in destination-local units */
  maxFastPathAmount?: bigint;
  /** Optional manual-review threshold in destination-local units */
  manualReviewAmount?: bigint;
}

// =============================================================================
// Bridge Event Policy
// =============================================================================

export type BridgeChainFamily = 'evm' | 'solana';

export type BridgeSourceEventKind =
  | 'evm_bridge_out_v1'
  | 'evm_bridge_outbox_bridge_out_initiated'
  | 'evm_bridge_outbox_direct'
  | 'solana_bridge_out_v1_with_proof'
  | 'solana_init_bridge_v1_out'
  | 'unknown';

export type BridgePolicyAction =
  | 'accept'
  | 'reject'
  | 'delay'
  | 'manual_review'
  | 'freeze'
  | 'alert'
  | 'ignore';

export type BridgeRiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface BridgeChainPolicyConfig {
  chainKey: string;
  family: BridgeChainFamily;
  domainId: number;
  chainId?: number;
  bridgeOutboxAddress?: string;
  bridgeInboxAddress?: string;
  whiteProtocolAddress?: string;
  solanaProgramId?: string;
  finality: BridgeFinalityConfig;
}

export interface BridgePolicyDecision {
  accepted: boolean;
  action: BridgePolicyAction;
  severity: BridgeRiskSeverity;
  reasons: string[];
}

export interface BridgeRiskFinding {
  code: string;
  message: string;
  severity: BridgeRiskSeverity;
  recommendedAction: BridgePolicyAction;
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
  /** Explicit source event kind for production policy filtering */
  sourceEventKind?: BridgeSourceEventKind;
  /** Contract/program address that emitted the source event */
  sourceAddress?: string;
  /** Optional source chain key when emitted by a multi-chain watcher */
  sourceChain?: string;
  /** Optional observed confirmations for policy-only checks */
  confirmations?: number;
  /** Optional marker that the source tx was fetched and succeeded */
  sourceTxSucceeded?: boolean;
  /** Optional marker from Solana source watcher proving source-bound instruction path */
  sourceBoundProofMarker?: 'bridge_out_v1_with_proof';
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
