/**
 * Solana relayer fee validation against on-chain RelayerRegistry.
 *
 * Fetches the registry (and optionally the relayer node) to verify that
 * the relayer's configured feeBps is within on-chain bounds and that the
 * relayer is active.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { findRelayerRegistryPda, findRelayerNodePda } from './solana-pdas';
import { logger } from './logger';

export interface RelayerRegistryInfo {
  pool: PublicKey;
  minFeeBps: number;
  maxFeeBps: number;
  requireStake: boolean;
  minStakeAmount: bigint;
  relayerCount: number;
  activeRelayerCount: number;
  bump: number;
  registrationsOpen: boolean;
}

export interface RelayerNodeInfo {
  registry: PublicKey;
  operator: PublicKey;
  feeBps: number;
  isActive: boolean;
  stakeAmount: bigint;
  bump: number;
}

function parseRegistry(data: Buffer): RelayerRegistryInfo {
  let offset = 8; // Anchor discriminator
  const pool = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const minFeeBps = data.readUInt16LE(offset);
  offset += 2;
  const maxFeeBps = data.readUInt16LE(offset);
  offset += 2;
  const requireStake = data[offset] !== 0;
  offset += 1;
  const minStakeAmount = data.readBigUInt64LE(offset);
  offset += 8;
  const relayerCount = data.readUInt32LE(offset);
  offset += 4;
  const activeRelayerCount = data.readUInt32LE(offset);
  offset += 4;
  offset += 8; // total_fees_collected
  offset += 8; // total_transactions
  offset += 8; // created_at
  offset += 8; // last_updated_at
  const bump = data[offset];
  offset += 1;
  const registrationsOpen = data[offset] !== 0;
  return {
    pool,
    minFeeBps,
    maxFeeBps,
    requireStake,
    minStakeAmount,
    relayerCount,
    activeRelayerCount,
    bump,
    registrationsOpen,
  };
}

function parseRelayerNode(data: Buffer): RelayerNodeInfo {
  let offset = 8; // Anchor discriminator
  const registry = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const operator = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const feeBps = data.readUInt16LE(offset);
  offset += 2;
  const isActive = data[offset] !== 0;
  offset += 1;
  const stakeAmount = data.readBigUInt64LE(offset);
  offset += 8;
  offset += 8; // transactions_processed
  offset += 8; // fees_earned
  offset += 8; // registered_at
  offset += 8; // last_active_at
  const metadataUriLen = data.readUInt32LE(offset);
  offset += 4 + metadataUriLen;
  const bump = data[offset];
  return {
    registry,
    operator,
    feeBps,
    isActive,
    stakeAmount,
    bump,
  };
}

export async function fetchRelayerRegistry(
  connection: Connection,
  poolConfig: PublicKey,
  programId: PublicKey
): Promise<RelayerRegistryInfo | null> {
  const [registryPda] = findRelayerRegistryPda(poolConfig, programId);
  const accountInfo = await connection.getAccountInfo(registryPda);
  if (!accountInfo || !accountInfo.data) {
    return null;
  }
  try {
    return parseRegistry(accountInfo.data);
  } catch (err: any) {
    logger.warn('Failed to parse RelayerRegistry account', {
      pda: registryPda.toBase58(),
      error: err.message,
    });
    return null;
  }
}

export async function fetchRelayerNode(
  connection: Connection,
  registry: PublicKey,
  operator: PublicKey,
  programId: PublicKey
): Promise<RelayerNodeInfo | null> {
  const [nodePda] = findRelayerNodePda(registry, operator, programId);
  const accountInfo = await connection.getAccountInfo(nodePda);
  if (!accountInfo || !accountInfo.data) {
    return null;
  }
  try {
    return parseRelayerNode(accountInfo.data);
  } catch (err: any) {
    logger.warn('Failed to parse RelayerNode account', {
      pda: nodePda.toBase58(),
      error: err.message,
    });
    return null;
  }
}

export interface FeeValidationResult {
  ok: boolean;
  error?: string;
  registry?: RelayerRegistryInfo | null;
  node?: RelayerNodeInfo | null;
}

/**
 * Validate that the relayer's fee configuration is acceptable on-chain.
 *
 * Checks:
 * 1. Registry exists and is configured
 * 2. feeBps is within registry min..max bounds
 * 3. If a relayer node exists for this operator, it is active and its feeBps matches
 *
 * Environment:
 * - RELAYER_ALLOW_MISSING_SOLANA_REGISTRY: if "true", allow missing registry in non-production
 * - In production (NODE_ENV=production), always fail closed.
 */
export async function validateSolanaRelayerFee(
  connection: Connection,
  poolConfig: PublicKey,
  programId: PublicKey,
  operator: PublicKey,
  feeBps: number
): Promise<FeeValidationResult> {
  const registry = await fetchRelayerRegistry(connection, poolConfig, programId);

  if (!registry) {
    const isProduction = process.env.NODE_ENV === 'production';
    const allowMissing = process.env.RELAYER_ALLOW_MISSING_SOLANA_REGISTRY === 'true';

    if (isProduction) {
      return {
        ok: false,
        error: 'RelayerRegistry not found on-chain. Relayer cannot operate in production without registry.',
      };
    }

    if (!allowMissing) {
      return {
        ok: false,
        error:
          'RelayerRegistry not found on-chain. Set RELAYER_ALLOW_MISSING_SOLANA_REGISTRY=true to bypass ' +
          'for dev/test, or ensure the pool has an initialized registry.',
      };
    }

    logger.warn('RelayerRegistry missing; allowing withdrawal due to RELAYER_ALLOW_MISSING_SOLANA_REGISTRY=true');
    return { ok: true };
  }

  if (feeBps < registry.minFeeBps || feeBps > registry.maxFeeBps) {
    return {
      ok: false,
      error: `Relayer fee ${feeBps} bps is out of on-chain bounds [${registry.minFeeBps}, ${registry.maxFeeBps}]`,
      registry,
    };
  }

  const node = await fetchRelayerNode(connection, registry.pool, operator, programId);

  if (node) {
    if (!node.isActive) {
      return {
        ok: false,
        error: 'Relayer node is inactive on-chain',
        registry,
        node,
      };
    }

    if (node.feeBps !== feeBps) {
      return {
        ok: false,
        error: `Relayer node fee mismatch: on-chain ${node.feeBps} bps vs configured ${feeBps} bps`,
        registry,
        node,
      };
    }
  }

  return { ok: true, registry, node };
}
