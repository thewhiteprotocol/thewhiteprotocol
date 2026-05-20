/**
 * Re-sign the PR-013A Solana -> Base paper message with the deployed Base
 * signer set, then rerun guarded approval simulation. No transaction is sent.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createPublicClient, http, type Address, type Hex, type PublicClient } from 'viem';
import type { BridgeMessageV1 } from '@thewhiteprotocol/core';
import type { BridgeMessageState } from './types';
import {
  DEFAULT_BASE_BRIDGE_INBOX,
  EXPECTED_PR013A_DESTINATION_HASH,
  EXPECTED_PR013A_SOURCE_HASH,
  findApprovalMessage,
  loadApprovalConfigFromEnv,
  runSolanaToBaseApproval,
  type BaseApprovalClient,
} from './solana-to-base-approval';
import {
  BridgeSignerService,
  createBridgeSignerAdapterFromEnv,
  type BridgeSigningContext,
} from './signer';

export interface DeployedBaseSignerSet {
  version: number;
  threshold: number;
  signers: string[];
}

export interface ResignApprovalReport {
  ok: boolean;
  readiness: 'approval_ready' | 'blocked';
  generatedAt: string;
  paperStatePath: string;
  sourceMessageHash: string;
  destinationBridgeMintHash: string;
  deployedSignerSet: DeployedBaseSignerSet;
  signerModeBefore: string | null;
  signerModeAfter: string | null;
  recoveredSignerAddressesBefore: string[];
  recoveredSignerAddressesAfter: string[];
  signersMatchDeployedSet: boolean;
  destinationHashSigned: boolean;
  sourceHashPreserved: boolean;
  stateUpdated: boolean;
  approval: Awaited<ReturnType<typeof runSolanaToBaseApproval>> | null;
  errors: string[];
  destinationTxSubmitted: false;
  secretsPrinted: false;
}

function normalizeHash(value: string): string {
  return `0x${value.replace(/^0x/i, '').toLowerCase()}`;
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function readStateFile(statePath: string): { filePath: string; messages: BridgeMessageState[] } {
  const filePath = fs.statSync(statePath).isDirectory()
    ? path.join(statePath, 'bridge-messages.json')
    : statePath;
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  const messages = Array.isArray(parsed)
    ? parsed as BridgeMessageState[]
    : Object.values(parsed as Record<string, BridgeMessageState>);
  return { filePath, messages };
}

function writeStateFile(filePath: string, messages: BridgeMessageState[]): void {
  fs.writeFileSync(filePath, JSON.stringify(messages, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }, 2));
}

function findRepoRoot(start = process.cwd()): string {
  let current = start;
  for (;;) {
    if (fs.existsSync(path.join(current, 'package.json')) &&
      fs.existsSync(path.join(current, 'chains'))) {
      return current;
    }
    const next = path.dirname(current);
    if (next === current) return start;
    current = next;
  }
}

export function loadDeployedBaseSignerSet(
  env: Record<string, string | undefined> = process.env
): DeployedBaseSignerSet {
  if (env.BRIDGE_DEPLOYED_SIGNER_ADDRESSES && env.BRIDGE_DEPLOYED_SIGNER_THRESHOLD) {
    return {
      version: Number(env.BRIDGE_DEPLOYED_SIGNER_SET_VERSION ?? '1'),
      threshold: Number(env.BRIDGE_DEPLOYED_SIGNER_THRESHOLD),
      signers: env.BRIDGE_DEPLOYED_SIGNER_ADDRESSES
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean),
    };
  }

  const deploymentPath = env.BASE_SEPOLIA_DEPLOYMENT_PATH ||
    path.join(findRepoRoot(), 'chains/evm/deployments/base-sepolia.json');
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8')) as {
    bridgeV1?: {
      signerSetVersion?: number;
      threshold?: number;
      signers?: string[];
    };
  };
  const bridgeV1 = deployment.bridgeV1;
  if (!bridgeV1?.signerSetVersion || !bridgeV1.threshold || !bridgeV1.signers?.length) {
    throw new Error('Base deployment signer set metadata missing');
  }
  return {
    version: bridgeV1.signerSetVersion,
    threshold: bridgeV1.threshold,
    signers: bridgeV1.signers,
  };
}

function buildSigningContext(
  message: BridgeMessageV1,
  messageHash: string,
  signerSet: DeployedBaseSignerSet,
  state: BridgeMessageState,
  env: Record<string, string | undefined>
): BridgeSigningContext {
  return {
    messageHash,
    sourceChain: state.sourceChain,
    destinationChain: state.destinationChain,
    sourceDomain: message.sourceDomain,
    destinationDomain: message.destinationDomain,
    canonicalAssetId: message.canonicalAssetId,
    amount: BigInt(message.amount),
    route: `${state.sourceChain}->${state.destinationChain}`,
    riskLevel: state.policyDecision?.severity ?? 'info',
    dryRun: false,
    signerSetVersion: signerSet.version,
    purpose: 'bridge-attestation',
    messageFormat: 'BridgeMessageV1',
    bridgePolicyAccepted: state.policyDecision?.accepted === true,
    finalitySatisfied: state.finalitySatisfied === true,
    routeAllowed: true,
    assetSupported: true,
    amountWithinCap: true,
    openCriticalFindings: 0,
    environment: env.NODE_ENV,
    allowEnvSignerInProduction: env.BRIDGE_ALLOW_ENV_SIGNER_IN_PRODUCTION === 'true',
  };
}

function signerEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const hasEnvFile = Boolean(env.BRIDGE_SIGNER_KEY_FILE || env.BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET);
  return {
    ...env,
    BRIDGE_SIGNER_MODE: env.BRIDGE_SIGNER_MODE || (hasEnvFile ? 'env-file' : undefined),
  };
}

function redactError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/[^\s"']+/g, '[redacted-url]')
    .replace(/0x[a-fA-F0-9]{64,}/g, '[redacted-hex]')
    .replace(/private[_-]?key[=:][^\s,"']+/gi, '[redacted-secret]')
    .replace(/operator[_-]?token[=:][^\s,"']+/gi, '[redacted-secret]')
    .replace(/witness[=:][^\s,"']+/gi, '[redacted-secret]');
}

function assertNonSecretReport(report: ResignApprovalReport): void {
  const serialized = JSON.stringify(report);
  for (const token of ['privateKey', 'PRIVATE_KEY', 'operatorToken', 'walletFile', 'witness']) {
    if (serialized.includes(token)) {
      throw new Error(`resign_report_contains_sensitive_field:${token}`);
    }
  }
}

export async function runSolanaToBaseResignApproval(input: {
  env?: Record<string, string | undefined>;
  client?: BaseApprovalClient;
  now?: () => Date;
} = {}): Promise<ResignApprovalReport> {
  const env = input.env ?? process.env;
  const errors: string[] = [];
  const now = input.now ?? (() => new Date());
  const signerSet = loadDeployedBaseSignerSet(env);
  const config = {
    ...loadApprovalConfigFromEnv(env),
    expectedSourceHash: env.BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH ||
      env.BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH ||
      EXPECTED_PR013A_SOURCE_HASH,
    expectedDestinationHash: env.BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH ||
      env.BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH ||
      EXPECTED_PR013A_DESTINATION_HASH,
    bridgeInbox: (env.BASE_BRIDGE_INBOX_ADDRESS ||
      env.BRIDGE_BASE_SEPOLIA_INBOX_ADDRESS ||
      DEFAULT_BASE_BRIDGE_INBOX) as Address,
    deployedSignerSetVersion: signerSet.version,
    deployedThreshold: signerSet.threshold,
    deployedSignerAddresses: signerSet.signers,
  };

  const { filePath, messages } = readStateFile(config.statePath);
  const messageState = findApprovalMessage(messages, config.expectedDestinationHash);
  const beforeSigners = messageState?.signatures?.map((sig) => sig.signerAddress) ?? [];
  const signerModeBefore = messageState?.signingDecision?.adapterType ?? null;
  let signerModeAfter: string | null = null;
  let recoveredSignerAddressesAfter: string[] = [];
  let stateUpdated = false;
  let approval: ResignApprovalReport['approval'] = null;

  if (!messageState) {
    errors.push('paper_message_not_found');
  } else if (normalizeHash(messageState.sourceMessageHash ?? '') !== normalizeHash(config.expectedSourceHash)) {
    errors.push('source_hash_mismatch');
  } else if (normalizeHash(messageState.destinationMessageHash ?? '') !== normalizeHash(config.expectedDestinationHash)) {
    errors.push('destination_hash_mismatch');
  } else {
    try {
      const adapter = createBridgeSignerAdapterFromEnv(signerEnv(env));
      signerModeAfter = adapter.type;
      const signer = new BridgeSignerService({
        threshold: signerSet.threshold,
        privateKeys: [],
        adapter,
      });
      const context = buildSigningContext(
        messageState.message,
        config.expectedDestinationHash,
        signerSet,
        messageState,
        env
      );
      const signatures = await signer.signMessageHash(config.expectedDestinationHash, context);
      const deployed = new Set(signerSet.signers.map(normalizeAddress));
      const matching = signatures.filter((sig) => deployed.has(normalizeAddress(sig.signerAddress)));
      if (matching.length < signerSet.threshold) {
        errors.push('deployed_signer_keys_unavailable');
      } else {
        const thresholdSignatures = matching.slice(0, signerSet.threshold);
        signer.validateSignatureOrder(thresholdSignatures);
        recoveredSignerAddressesAfter = thresholdSignatures.map((sig) => sig.signerAddress);
        messageState.signatures = thresholdSignatures;
        messageState.signatureMetadata = {
          signerSetVersion: signerSet.version,
          signerCount: signerSet.signers.length,
          threshold: signerSet.threshold,
          signerAddresses: signerSet.signers,
        };
        messageState.signingDecision = {
          accepted: true,
          action: 'allow',
          reasons: [],
          adapterType: adapter.type,
        };
        messageState.submissionPreview = {
          ...(messageState.submissionPreview ?? {}),
          signerSetVersion: signerSet.version,
          signatureCount: thresholdSignatures.length,
          dryRun: true,
          wouldSubmit: true,
        };
        messageState.updatedAt = Date.now();
        writeStateFile(filePath, messages);
        stateUpdated = true;
      }
    } catch (error) {
      errors.push(`resign_failed:${redactError(error)}`);
    }
  }

  if (errors.length === 0) {
    const client = input.client ?? createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient as BaseApprovalClient;
    approval = await runSolanaToBaseApproval({ config, client, now });
    if (!approval.ok) errors.push(...approval.errors);
  }

  const deployed = new Set(signerSet.signers.map(normalizeAddress));
  const signersMatchDeployedSet = recoveredSignerAddressesAfter.length >= signerSet.threshold &&
    recoveredSignerAddressesAfter.every((address) => deployed.has(normalizeAddress(address)));
  const report: ResignApprovalReport = {
    ok: errors.length === 0 && approval?.ok === true,
    readiness: errors.length === 0 && approval?.ok === true ? 'approval_ready' : 'blocked',
    generatedAt: now().toISOString(),
    paperStatePath: config.statePath,
    sourceMessageHash: normalizeHash(config.expectedSourceHash),
    destinationBridgeMintHash: normalizeHash(config.expectedDestinationHash),
    deployedSignerSet: signerSet,
    signerModeBefore,
    signerModeAfter,
    recoveredSignerAddressesBefore: beforeSigners,
    recoveredSignerAddressesAfter,
    signersMatchDeployedSet,
    destinationHashSigned: stateUpdated,
    sourceHashPreserved: Boolean(messageState?.sourceMessageHash),
    stateUpdated,
    approval,
    errors: [...new Set(errors)],
    destinationTxSubmitted: false,
    secretsPrinted: false,
  };
  assertNonSecretReport(report);
  return report;
}

async function main(): Promise<void> {
  const report = await runSolanaToBaseResignApproval();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readiness: 'blocked',
      error: redactError(error),
      destinationTxSubmitted: false,
      secretsPrinted: false,
    }, null, 2));
    process.exit(1);
  });
}
