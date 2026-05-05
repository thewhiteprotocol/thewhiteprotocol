/**
 * Chain registry and API validation helpers for The White Protocol relayer.
 *
 * Provides a single source of truth for:
 * - Live chain metadata (EVM from networks.json + Solana)
 * - Chain alias normalization
 * - Chain parameter validation
 * - Standardized error responses
 * - Chain-aware quote building
 */

import { NetworkConfig, loadNetwork, getLiveNetworks } from './config';
import { logger } from './logger';

export type ChainFamily = 'solana' | 'evm';

export interface ChainEntry {
  chainKey: string;
  aliases: string[];
  family: ChainFamily;
  chainId?: number;
  domainId: number;
  assetIdVersion: number;
  displayName: string;
  nativeSymbol: string;
  isLive: boolean;
  isTestnet: boolean;
  blockedReason?: string;
  explorerUrl?: string;
}

// =============================================================================
// CHAIN REGISTRY
// =============================================================================

const SOLANA_ENTRY: ChainEntry = {
  chainKey: 'solana',
  aliases: ['sol'],
  family: 'solana',
  domainId: 33554433,
  assetIdVersion: 1,
  displayName: 'Solana Devnet',
  nativeSymbol: 'SOL',
  isLive: true,
  isTestnet: true,
};

function buildEvmEntry(name: string, config: NetworkConfig): ChainEntry {
  return {
    chainKey: name,
    aliases: buildEvmAliases(name),
    family: 'evm',
    chainId: config.chainId,
    domainId: config.domainId,
    assetIdVersion: 2,
    displayName: config.nativeSymbol
      ? `${config.nativeSymbol} ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`
      : name,
    nativeSymbol: config.nativeSymbol,
    isLive: config.isLive,
    isTestnet: config.isTestnet,
    blockedReason: config.blockedReason,
    explorerUrl: config.explorerUrl,
  };
}

function buildEvmAliases(name: string): string[] {
  switch (name) {
    case 'base-sepolia': return ['base'];
    case 'ethereum-sepolia': return ['eth', 'ethereum'];
    case 'bsc-testnet': return ['bnb', 'bsc'];
    case 'polygon-amoy': return ['polygon'];
    case 'base-mainnet': return ['base'];
    case 'ethereum-mainnet': return ['eth', 'ethereum'];
    case 'bsc-mainnet': return ['bnb', 'bsc'];
    case 'polygon-mainnet': return ['polygon'];
    default: return [];
  }
}

/** Build the canonical chain registry from config */
export function buildChainRegistry(): Record<string, ChainEntry> {
  const registry: Record<string, ChainEntry> = {};

  // Solana
  registry[SOLANA_ENTRY.chainKey] = SOLANA_ENTRY;
  for (const alias of SOLANA_ENTRY.aliases) {
    registry[alias] = SOLANA_ENTRY;
  }

  // EVM chains from networks.json
  try {
    // Load live networks first so their aliases take precedence
    const liveNetworks = getLiveNetworks();
    for (const [name, config] of Object.entries(liveNetworks)) {
      const entry = buildEvmEntry(name, config);
      registry[name] = entry;
      for (const alias of entry.aliases) {
        if (!registry[alias]) { // live aliases take precedence
          registry[alias] = entry;
        }
      }
    }

    // Also include non-live networks so we can reject them explicitly,
    // but do NOT overwrite existing aliases (live takes precedence)
    const nonLiveNames = ['base-mainnet', 'ethereum-mainnet', 'bsc-mainnet', 'polygon-mainnet'];
    for (const name of nonLiveNames) {
      try {
        const config = loadNetwork(name);
        const entry = buildEvmEntry(name, config);
        registry[name] = entry;
        for (const alias of entry.aliases) {
          if (!registry[alias]) {
            registry[alias] = entry;
          }
        }
      } catch { /* ignore unknown */ }
    }
  } catch (err: any) {
    logger.warn('Failed to load network config for chain registry', { error: err.message });
  }

  return registry;
}

// Lazy-loaded singleton
let _chainRegistry: Record<string, ChainEntry> | null = null;

export function getChainRegistry(): Record<string, ChainEntry> {
  if (!_chainRegistry) {
    _chainRegistry = buildChainRegistry();
  }
  return _chainRegistry;
}

/** Reset registry (useful for tests) */
export function resetChainRegistry(): void {
  _chainRegistry = null;
}

// =============================================================================
// CHAIN LOOKUP
// =============================================================================

export interface ResolvedChain {
  chainKey: string;
  entry: ChainEntry;
}

/**
 * Resolve a user-provided chain string to a canonical chain entry.
 * Returns null if the chain is unknown.
 */
export function resolveChain(chainInput: string | undefined): ResolvedChain | null {
  if (!chainInput || typeof chainInput !== 'string') return null;
  const normalized = chainInput.toLowerCase().trim();
  if (!normalized) return null;

  // Reject path traversal or suspicious characters
  if (/[./\\<>{}\[\]|^%$#@!&*()+=`~]/.test(normalized)) return null;

  const registry = getChainRegistry();
  const entry = registry[normalized];
  if (!entry) return null;

  return { chainKey: entry.chainKey, entry };
}

// =============================================================================
// VALIDATION
// =============================================================================

export interface ChainValidationResult {
  ok: boolean;
  chainKey?: string;
  entry?: ChainEntry;
  error?: { code: string; message: string };
}

/**
 * Validate that a chain parameter is present, known, and live.
 */
export function validateChainParameter(
  chainInput: string | undefined,
  options: { allowNonLive?: boolean } = {}
): ChainValidationResult {
  if (!chainInput || typeof chainInput !== 'string' || !chainInput.trim()) {
    return {
      ok: false,
      error: {
        code: 'MISSING_CHAIN',
        message: `Missing required 'chain' parameter. Supported chains: ${getSupportedChainKeys().join(', ')}`,
      },
    };
  }

  const resolved = resolveChain(chainInput);
  if (!resolved) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_CHAIN',
        message: `Unsupported chain "${chainInput}". Supported chains: ${getSupportedChainKeys().join(', ')}`,
      },
    };
  }

  if (!resolved.entry.isLive && !options.allowNonLive) {
    return {
      ok: false,
      chainKey: resolved.chainKey,
      entry: resolved.entry,
      error: {
        code: 'CHAIN_NOT_LIVE',
        message: `Chain "${resolved.chainKey}" is not currently live${resolved.entry.blockedReason ? ` (${resolved.entry.blockedReason})` : ''}.`,
      },
    };
  }

  return { ok: true, chainKey: resolved.chainKey, entry: resolved.entry };
}

// =============================================================================
// SUPPORTED CHAIN LISTS
// =============================================================================

/** Get list of canonical chain keys that are live */
export function getSupportedChainKeys(): string[] {
  const registry = getChainRegistry();
  const keys = new Set<string>();
  for (const entry of Object.values(registry)) {
    if (entry.isLive) {
      keys.add(entry.chainKey);
    }
  }
  return Array.from(keys).sort();
}

/** Get full metadata for all live chains */
export function getLiveChainEntries(): ChainEntry[] {
  const registry = getChainRegistry();
  const seen = new Set<string>();
  const entries: ChainEntry[] = [];
  for (const entry of Object.values(registry)) {
    if (entry.isLive && !seen.has(entry.chainKey)) {
      seen.add(entry.chainKey);
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => a.chainKey.localeCompare(b.chainKey));
}

// =============================================================================
// STANDARD ERROR RESPONSES
// =============================================================================

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiError;
}

export function createApiError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiErrorResponse {
  return {
    success: false,
    error: { code, message, details },
  };
}

export function createChainMissingError(): ApiErrorResponse {
  return createApiError(
    'MISSING_CHAIN',
    `Missing required 'chain' parameter. Supported chains: ${getSupportedChainKeys().join(', ')}`
  );
}

export function createUnsupportedChainError(chainInput: string): ApiErrorResponse {
  return createApiError(
    'UNSUPPORTED_CHAIN',
    `Unsupported chain "${chainInput}". Supported chains: ${getSupportedChainKeys().join(', ')}`
  );
}

export function createChainNotLiveError(entry: ChainEntry): ApiErrorResponse {
  return createApiError(
    'CHAIN_NOT_LIVE',
    `Chain "${entry.chainKey}" is not currently live${entry.blockedReason ? ` (${entry.blockedReason})` : ''}.`
  );
}

// =============================================================================
// QUOTE BUILDER
// =============================================================================

export interface QuoteResult {
  amount: string;
  relayerFee: string;
  feeBps: number;
  netAmount: string;
  feeModel: string;
  gasAware: boolean;
  gasWarning?: string;
  chainKey: string;
  chainId?: number;
  domainId: number;
  assetIdVersion: number;
  nativeGasToken: string;
  relayerAddresses: {
    solana?: string;
    evm?: Record<string, string>;
  };
}

export function buildQuote(
  amount: bigint,
  feeBps: number,
  entry: ChainEntry,
  relayerAddresses: { solana?: string; evm?: Record<string, string> }
): QuoteResult {
  const fee = (amount * BigInt(feeBps)) / BigInt(10000);
  const netAmount = amount > fee ? amount - fee : BigInt(0);

  return {
    amount: amount.toString(),
    relayerFee: fee.toString(),
    feeBps,
    netAmount: netAmount.toString(),
    feeModel: 'flat_bps',
    gasAware: false,
    gasWarning: 'Gas-aware quote pending implementation',
    chainKey: entry.chainKey,
    chainId: entry.chainId,
    domainId: entry.domainId,
    assetIdVersion: entry.assetIdVersion,
    nativeGasToken: entry.nativeSymbol,
    relayerAddresses,
  };
}

// =============================================================================
// ASSET LIST BUILDER
// =============================================================================

export interface AssetInfo {
  chainKey: string;
  chainId?: number;
  domainId: number;
  assetIdVersion: number;
  assetId?: string;
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
}

/** Build asset list for a chain from EVM deployment metadata */
export function buildEvmAssetsForChain(
  chainKey: string,
  deployment: {
    supportedAssets: {
      native: string;
      wrappedNative: string;
      usdc: string | null;
      usdt: string | null;
    };
    chainId: number;
  },
  entry: ChainEntry
): AssetInfo[] {
  const assets: AssetInfo[] = [];
  const { native, wrappedNative, usdc, usdt } = deployment.supportedAssets;

  assets.push({
    chainKey,
    chainId: deployment.chainId,
    domainId: entry.domainId,
    assetIdVersion: entry.assetIdVersion,
    address: '0x0000000000000000000000000000000000000000',
    symbol: entry.nativeSymbol,
    decimals: 18,
    isNative: true,
  });

  if (wrappedNative && wrappedNative !== '0x0000000000000000000000000000000000000000') {
    assets.push({
      chainKey,
      chainId: deployment.chainId,
      domainId: entry.domainId,
      assetIdVersion: entry.assetIdVersion,
      address: wrappedNative,
      symbol: `W${entry.nativeSymbol}`,
      decimals: 18,
      isNative: false,
    });
  }

  if (usdc) {
    assets.push({
      chainKey,
      chainId: deployment.chainId,
      domainId: entry.domainId,
      assetIdVersion: entry.assetIdVersion,
      address: usdc,
      symbol: 'USDC',
      decimals: 6,
      isNative: false,
    });
  }

  if (usdt) {
    assets.push({
      chainKey,
      chainId: deployment.chainId,
      domainId: entry.domainId,
      assetIdVersion: entry.assetIdVersion,
      address: usdt,
      symbol: 'USDT',
      decimals: 18,
      isNative: false,
    });
  }

  return assets;
}
