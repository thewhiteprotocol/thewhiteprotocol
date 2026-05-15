/**
 * Bridge Signer Service - PR-011F
 *
 * Adapter-backed secp256k1 signer custody boundary for bridge attestations.
 * Existing raw-key signing remains available for testnet/local tests, while
 * production-unsafe modes are blocked by policy unless explicitly overridden.
 */

import * as fs from 'fs';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, type Hex } from 'viem';
import {
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import type {
  BridgeRiskSeverity,
  BridgeSignature,
  BridgeSignerConfig,
} from './types';

export type BridgeSignerAdapterType =
  | 'local-dev'
  | 'env-file'
  | 'kms-placeholder'
  | 'hsm-placeholder'
  | 'mpc-placeholder';

export type BridgeSigningPurpose = 'bridge-attestation' | 'freeze' | 'test';

export interface BridgeSigningContext {
  messageHash: string;
  sourceChain: string;
  destinationChain: string;
  sourceDomain: number;
  destinationDomain: number;
  canonicalAssetId: string;
  amount: bigint;
  route: string;
  riskLevel: BridgeRiskSeverity;
  dryRun: boolean;
  signerSetVersion: number;
  purpose: BridgeSigningPurpose;
  messageFormat?: 'BridgeMessageV1';
  bridgePolicyAccepted?: boolean;
  finalitySatisfied?: boolean;
  routeAllowed?: boolean;
  assetSupported?: boolean;
  amountWithinCap?: boolean;
  openCriticalFindings?: number;
  environment?: string;
  allowEnvSignerInProduction?: boolean;
}

export interface SignatureResult extends BridgeSignature {
  adapterType: BridgeSignerAdapterType;
}

export interface SignerHealth {
  ok: boolean;
  status: 'ready' | 'unavailable' | 'not_implemented' | 'policy_blocked';
  adapterType: BridgeSignerAdapterType;
  signerCount: number;
  signerAddresses: string[];
  reason?: string;
}

export interface SignerPolicyDecision {
  accepted: boolean;
  action: 'allow' | 'reject' | 'dry_run';
  reasons: string[];
}

export interface BridgeSignerAdapter {
  readonly type: BridgeSignerAdapterType;
  getSignerAddresses(): Promise<string[]>;
  signMessageHash(messageHash: string, context: BridgeSigningContext): Promise<SignatureResult[]>;
  healthCheck(): Promise<SignerHealth>;
  canSign(context: BridgeSigningContext): Promise<SignerPolicyDecision>;
}

export interface LocalDevSignerAdapterOptions {
  privateKeys?: string[];
  env?: Record<string, string | undefined>;
}

export interface EnvFileSignerAdapterOptions {
  privateKeys?: string[];
  keyFile?: string;
  env?: Record<string, string | undefined>;
}

export interface PlaceholderSignerAdapterOptions {
  type: Extract<BridgeSignerAdapterType, 'kms-placeholder' | 'hsm-placeholder' | 'mpc-placeholder'>;
  reason?: string;
}

const LOCAL_DEV_PRIVATE_KEYS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
];

const SUPPORTED_PURPOSES = new Set<BridgeSigningPurpose>([
  'bridge-attestation',
  'freeze',
  'test',
]);

function normalizePrivateKey(privateKey: string): Hex {
  const trimmed = privateKey.trim();
  const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('Invalid signer private key format');
  }
  return normalized as Hex;
}

function normalizeHash(messageHash: string): Hex {
  const normalized = messageHash.startsWith('0x') ? messageHash : `0x${messageHash}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('Invalid message hash format');
  }
  return normalized as Hex;
}

function sortSignatures<T extends Pick<BridgeSignature, 'signerAddress'>>(signatures: T[]): T[] {
  return [...signatures].sort((a, b) => {
    const addrA = a.signerAddress.toLowerCase();
    const addrB = b.signerAddress.toLowerCase();
    if (addrA < addrB) return -1;
    if (addrA > addrB) return 1;
    return 0;
  });
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

function splitKeys(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = normalized.indexOf('=');
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function extractPrivateKeysFromEnv(env: Record<string, string | undefined>): string[] {
  const keys = [
    ...splitKeys(env.BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET),
    ...splitKeys(env.BRIDGE_SIGNER_PRIVATE_KEYS),
  ];
  for (const [key, value] of Object.entries(env)) {
    if (/^BRIDGE_SIGNER_\d+_PRIVATE_KEY$/.test(key) && value) {
      keys.push(value);
    }
  }
  return keys;
}

function makePolicyContextForTest(messageHash: string): BridgeSigningContext {
  return {
    messageHash,
    sourceChain: 'test-source',
    destinationChain: 'test-destination',
    sourceDomain: 1,
    destinationDomain: 2,
    canonicalAssetId: '0'.repeat(63) + '1',
    amount: 1n,
    route: 'test-source->test-destination',
    riskLevel: 'info',
    dryRun: false,
    signerSetVersion: 1,
    purpose: 'test',
    bridgePolicyAccepted: true,
    finalitySatisfied: true,
    routeAllowed: true,
    assetSupported: true,
    amountWithinCap: true,
    openCriticalFindings: 0,
    environment: process.env.NODE_ENV,
  };
}

export function evaluateSigningPolicy(
  adapterType: BridgeSignerAdapterType,
  context: BridgeSigningContext
): SignerPolicyDecision {
  const reasons: string[] = [];
  const environment = context.environment ?? process.env.NODE_ENV ?? 'development';

  if (!SUPPORTED_PURPOSES.has(context.purpose)) {
    reasons.push(`unsupported_signing_purpose: ${context.purpose}`);
  }

  try {
    normalizeHash(context.messageHash);
  } catch {
    reasons.push('invalid_message_hash');
  }

  if (context.purpose !== 'test' && context.messageFormat !== 'BridgeMessageV1') {
    reasons.push('message_format_not_bridge_message_v1');
  }

  if (context.purpose === 'bridge-attestation') {
    if (!context.bridgePolicyAccepted) reasons.push('bridge_policy_not_accepted');
    if (!context.finalitySatisfied) reasons.push('source_finality_not_satisfied');
    if (!context.routeAllowed) reasons.push('route_not_allowed');
    if (!context.assetSupported) reasons.push('asset_not_supported');
    if (!context.amountWithinCap) reasons.push('amount_outside_cap');
    if ((context.openCriticalFindings ?? 0) > 0) reasons.push('open_critical_watcher_finding');
  }

  if (context.dryRun && context.purpose !== 'test') {
    reasons.push('dry_run_signing_blocked');
  }

  if (environment === 'production' && adapterType === 'local-dev') {
    reasons.push('local_dev_signer_blocked_in_production');
  }

  if (
    environment === 'production' &&
    adapterType === 'env-file' &&
    !context.allowEnvSignerInProduction
  ) {
    reasons.push('env_file_signer_blocked_in_production');
  }

  if (reasons.length > 0) {
    return { accepted: false, action: context.dryRun ? 'dry_run' : 'reject', reasons };
  }

  return { accepted: true, action: 'allow', reasons: [] };
}

abstract class PrivateKeySignerAdapter implements BridgeSignerAdapter {
  abstract readonly type: BridgeSignerAdapterType;
  protected readonly accounts: ReturnType<typeof privateKeyToAccount>[];
  protected readonly env: Record<string, string | undefined>;

  protected constructor(privateKeys: string[], env: Record<string, string | undefined>) {
    this.env = env;
    if (privateKeys.length === 0) {
      throw new Error('No bridge signer private keys configured');
    }
    try {
      this.accounts = privateKeys.map((privateKey) => privateKeyToAccount(normalizePrivateKey(privateKey)));
    } catch (err) {
      throw new Error(`Invalid bridge signer configuration: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  async getSignerAddresses(): Promise<string[]> {
    return sortSignatures(
      this.accounts.map((account) => ({ signerAddress: account.address }))
    ).map((item) => item.signerAddress);
  }

  async healthCheck(): Promise<SignerHealth> {
    const signerAddresses = await this.getSignerAddresses();
    return {
      ok: signerAddresses.length > 0,
      status: signerAddresses.length > 0 ? 'ready' : 'unavailable',
      adapterType: this.type,
      signerCount: signerAddresses.length,
      signerAddresses,
    };
  }

  async canSign(context: BridgeSigningContext): Promise<SignerPolicyDecision> {
    return evaluateSigningPolicy(this.type, {
      ...context,
      environment: context.environment ?? this.env.NODE_ENV,
      allowEnvSignerInProduction:
        context.allowEnvSignerInProduction ??
        parseBool(this.env.BRIDGE_ALLOW_ENV_SIGNER_IN_PRODUCTION, false),
    });
  }

  async signMessageHash(
    messageHash: string,
    context: BridgeSigningContext
  ): Promise<SignatureResult[]> {
    const normalizedHash = normalizeHash(messageHash);
    const decision = await this.canSign({ ...context, messageHash: normalizedHash });
    if (!decision.accepted) {
      throw new Error(`Bridge signing blocked: ${decision.reasons.join(', ')}`);
    }

    const signatures: SignatureResult[] = [];
    for (const account of this.accounts) {
      const sigHex = await account.sign({ hash: normalizedHash });
      const recovered = await recoverAddress({ hash: normalizedHash, signature: sigHex });
      signatures.push({
        signature: sigHex,
        signerAddress: recovered,
        adapterType: this.type,
      });
    }
    return sortSignatures(signatures);
  }
}

export class LocalDevSignerAdapter extends PrivateKeySignerAdapter {
  readonly type = 'local-dev' as const;

  constructor(options: LocalDevSignerAdapterOptions = {}) {
    super(options.privateKeys ?? LOCAL_DEV_PRIVATE_KEYS, options.env ?? process.env);
  }

  async canSign(context: BridgeSigningContext): Promise<SignerPolicyDecision> {
    const mode = this.env.BRIDGE_SIGNER_MODE;
    const environment = context.environment ?? this.env.NODE_ENV ?? process.env.NODE_ENV;
    if (environment !== 'test' && mode !== 'local-dev') {
      return {
        accepted: false,
        action: 'reject',
        reasons: ['local_dev_signer_requires_test_env_or_explicit_mode'],
      };
    }
    return super.canSign(context);
  }
}

export class EnvFileSignerAdapter extends PrivateKeySignerAdapter {
  readonly type = 'env-file' as const;

  constructor(options: EnvFileSignerAdapterOptions = {}) {
    const env = options.env ?? process.env;
    const fileEnv = options.keyFile
      ? parseEnvFile(fs.readFileSync(options.keyFile, 'utf8'))
      : {};
    const keys = options.privateKeys ?? [
      ...extractPrivateKeysFromEnv({ ...env, ...fileEnv }),
    ];
    super(keys, env);
  }
}

export class PlaceholderSignerAdapter implements BridgeSignerAdapter {
  readonly type: PlaceholderSignerAdapterOptions['type'];
  private readonly reason: string;

  constructor(options: PlaceholderSignerAdapterOptions) {
    this.type = options.type;
    this.reason = options.reason ?? `${options.type} signer adapter is not implemented in PR-011F`;
  }

  async getSignerAddresses(): Promise<string[]> {
    return [];
  }

  async healthCheck(): Promise<SignerHealth> {
    return {
      ok: false,
      status: 'not_implemented',
      adapterType: this.type,
      signerCount: 0,
      signerAddresses: [],
      reason: this.reason,
    };
  }

  async canSign(_context: BridgeSigningContext): Promise<SignerPolicyDecision> {
    return { accepted: false, action: 'reject', reasons: [this.reason] };
  }

  async signMessageHash(_messageHash: string, _context: BridgeSigningContext): Promise<SignatureResult[]> {
    throw new Error(this.reason);
  }
}

export class KmsSignerAdapter extends PlaceholderSignerAdapter {
  constructor() {
    super({ type: 'kms-placeholder', reason: 'KMS signer adapter is not implemented in PR-011F' });
  }
}

export class HsmSignerAdapter extends PlaceholderSignerAdapter {
  constructor() {
    super({ type: 'hsm-placeholder', reason: 'HSM signer adapter is not implemented in PR-011F' });
  }
}

export class MpcSignerAdapter extends PlaceholderSignerAdapter {
  constructor() {
    super({ type: 'mpc-placeholder', reason: 'MPC signer adapter is not implemented in PR-011F' });
  }
}

export function createBridgeSignerAdapterFromEnv(
  env: Record<string, string | undefined> = process.env
): BridgeSignerAdapter {
  const mode = env.BRIDGE_SIGNER_MODE ?? 'local-dev';
  switch (mode) {
    case 'local-dev':
      return new LocalDevSignerAdapter({ env });
    case 'env-file':
      return new EnvFileSignerAdapter({ keyFile: env.BRIDGE_SIGNER_KEY_FILE, env });
    case 'kms':
      return new KmsSignerAdapter();
    case 'hsm':
      return new HsmSignerAdapter();
    case 'mpc':
      return new MpcSignerAdapter();
    default:
      throw new Error(`Unsupported bridge signer mode: ${mode}`);
  }
}

export class BridgeSignerService {
  private readonly threshold: number;
  private readonly adapter: BridgeSignerAdapter;
  private readonly configuredSignerCount: number;

  constructor(config: BridgeSignerConfig & { adapter?: BridgeSignerAdapter }) {
    this.threshold = config.threshold;
    this.adapter = config.adapter ?? new EnvFileSignerAdapter({ privateKeys: config.privateKeys });
    this.configuredSignerCount = config.privateKeys.length;
  }

  /**
   * Sign a BridgeMessageV1 hash with all configured signers.
   * Returns signatures sorted by recovered Ethereum address ascending.
   */
  async signMessage(
    message: BridgeMessageV1,
    context?: Partial<BridgeSigningContext>
  ): Promise<BridgeSignature[]> {
    const messageHash = hashBridgeMessageV1(message) as Hex;
    const signingContext: BridgeSigningContext = {
      ...makePolicyContextForTest(messageHash),
      sourceChain: context?.sourceChain ?? 'unknown-source',
      destinationChain: context?.destinationChain ?? 'unknown-destination',
      sourceDomain: message.sourceDomain,
      destinationDomain: message.destinationDomain,
      canonicalAssetId: message.canonicalAssetId,
      amount: message.amount,
      route: context?.route ?? `${context?.sourceChain ?? 'unknown-source'}->${context?.destinationChain ?? 'unknown-destination'}`,
      riskLevel: context?.riskLevel ?? 'info',
      dryRun: context?.dryRun ?? false,
      signerSetVersion: context?.signerSetVersion ?? 1,
      purpose: context?.purpose ?? 'test',
      messageFormat: context?.messageFormat ?? (context?.purpose === 'bridge-attestation' || context?.purpose === 'freeze' ? 'BridgeMessageV1' : undefined),
      bridgePolicyAccepted: context?.bridgePolicyAccepted ?? true,
      finalitySatisfied: context?.finalitySatisfied ?? true,
      routeAllowed: context?.routeAllowed ?? true,
      assetSupported: context?.assetSupported ?? true,
      amountWithinCap: context?.amountWithinCap ?? true,
      openCriticalFindings: context?.openCriticalFindings ?? 0,
      environment: context?.environment ?? process.env.NODE_ENV,
      allowEnvSignerInProduction: context?.allowEnvSignerInProduction,
      messageHash,
    };
    return this.adapter.signMessageHash(messageHash, signingContext);
  }

  async signMessageHash(
    messageHash: string,
    context: BridgeSigningContext
  ): Promise<BridgeSignature[]> {
    return this.adapter.signMessageHash(messageHash, context);
  }

  async canSign(context: BridgeSigningContext): Promise<SignerPolicyDecision> {
    return this.adapter.canSign(context);
  }

  async healthCheck(): Promise<SignerHealth> {
    return this.adapter.healthCheck();
  }

  /**
   * Take exactly `threshold` signatures from the sorted list.
   * Useful when only a subset is needed for submission.
   */
  takeThreshold(signatures: BridgeSignature[]): BridgeSignature[] {
    if (signatures.length < this.threshold) {
      throw new Error(
        `Insufficient signatures: have ${signatures.length}, need ${this.threshold}`
      );
    }
    return signatures.slice(0, this.threshold);
  }

  /**
   * Verify that a set of signatures are sorted and have no duplicates.
   */
  validateSignatureOrder(signatures: BridgeSignature[]): void {
    for (let i = 1; i < signatures.length; i++) {
      const prev = signatures[i - 1].signerAddress.toLowerCase();
      const curr = signatures[i].signerAddress.toLowerCase();
      if (curr <= prev) {
        throw new Error(
          `Signatures not sorted by signer address at index ${i}: ${curr} <= ${prev}`
        );
      }
    }
  }

  /**
   * Extract raw 65-byte hex signatures for contract submission.
   */
  extractRawSignatures(signatures: BridgeSignature[]): string[] {
    return signatures.map((s) => s.signature);
  }

  /**
   * Recover the Ethereum address from a signature and message hash.
   */
  async recoverSigner(messageHash: Hex, signature: Hex): Promise<string> {
    return recoverAddress({ hash: messageHash, signature });
  }

  getThreshold(): number {
    return this.threshold;
  }

  getSignerCount(): number {
    return this.configuredSignerCount;
  }

  async getSignerAddresses(): Promise<string[]> {
    return this.adapter.getSignerAddresses();
  }

  getAdapterType(): BridgeSignerAdapterType {
    return this.adapter.type;
  }
}
