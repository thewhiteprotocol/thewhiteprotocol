import * as fs from 'fs';
import * as path from 'path';

export interface NetworkConfig {
  chainId: number;
  domainId: number;
  rpcUrlEnvVar: string;
  explorerUrl: string;
  nativeSymbol: string;
  wrappedNative: string | null;
  usdc: string | null;
  usdt: string | null;
  blockTimeSeconds: number;
  finalityConfirmations: number;
  isTestnet: boolean;
  isLive: boolean;
  blockedReason?: string;
  deploymentFile: string;
  deployWrappedNativeIfNull?: boolean;
}

export interface DeploymentJson {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  contracts: {
    WhiteProtocol: string;
    AssetRegistry: string;
    DepositVerifier: string;
    WithdrawVerifier: string;
    MerkleBatchVerifier: string;
    WrappedNative9?: string;
  };
  supportedAssets: {
    native: string;
    wrappedNative: string;
    usdc: string | null;
    usdt: string | null;
  };
  relayers: string[];
  merkleState: {
    emptyRoot: string;
    nextLeafIndex: number;
  };
  deploymentBlock?: number;
}

export interface EvmChainContext {
  name: string;
  config: NetworkConfig;
  deployment: DeploymentJson;
  rpcUrl: string;
}

const NETWORKS_JSON_PATH = path.resolve(__dirname, '../../chains/evm/configs/networks.json');

let _networks: Record<string, NetworkConfig> | null = null;

function loadNetworks(): Record<string, NetworkConfig> {
  if (_networks) return _networks;
  const raw = fs.readFileSync(NETWORKS_JSON_PATH, 'utf-8');
  _networks = JSON.parse(raw) as Record<string, NetworkConfig>;
  return _networks;
}

export function loadNetwork(name: string): NetworkConfig {
  const networks = loadNetworks();
  const config = networks[name];
  if (!config) {
    const available = Object.keys(networks).join(', ');
    throw new Error(`Unknown network "${name}". Available networks: ${available}`);
  }
  return config;
}

export function getLiveNetworks(): Record<string, NetworkConfig> {
  const networks = loadNetworks();
  const live: Record<string, NetworkConfig> = {};
  for (const [name, config] of Object.entries(networks)) {
    if (config.isLive) {
      live[name] = config;
    }
  }
  return live;
}

/** Backward-compatible RPC env var aliases */
const RPC_ENV_ALIASES: Record<string, string[]> = {
  BASE_SEPOLIA_RPC_URL: ['BASE_RPC_URL'],
  ETHEREUM_SEPOLIA_RPC_URL: ['ETH_RPC_URL'],
  BSC_TESTNET_RPC_URL: ['BSC_RPC_URL'],
};

export function getRpcUrl(name: string): string {
  const config = loadNetwork(name);
  const canonical = config.rpcUrlEnvVar;
  let url = process.env[canonical];
  if (!url) {
    const aliases = RPC_ENV_ALIASES[canonical] || [];
    for (const alias of aliases) {
      url = process.env[alias];
      if (url) {
        console.warn(
          `Deprecated: using "${alias}" for "${name}". Please migrate to "${canonical}".`
        );
        break;
      }
    }
  }
  if (!url) {
    throw new Error(
      `Missing RPC URL for network "${name}". Set environment variable ${canonical}`
    );
  }
  return url;
}

/** Per-chain deployer private key resolution with fallback */
const DEPLOYER_KEY_ALIASES: Record<string, string[]> = {
  'base-sepolia': ['BASE_DEPLOYER_PRIVATE_KEY', 'BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY'],
  'ethereum-sepolia': ['ETH_DEPLOYER_PRIVATE_KEY', 'ETHEREUM_SEPOLIA_DEPLOYER_PRIVATE_KEY'],
  'bsc-testnet': ['BSC_DEPLOYER_PRIVATE_KEY', 'BSC_TESTNET_DEPLOYER_PRIVATE_KEY'],
  'polygon-amoy': ['POLYGON_AMOY_DEPLOYER_PRIVATE_KEY'],
};

export function getDeployerPrivateKey(name: string): string | undefined {
  const aliases = DEPLOYER_KEY_ALIASES[name] || [`${name.toUpperCase().replace(/-/g, '_')}_DEPLOYER_PRIVATE_KEY`];
  for (const key of aliases) {
    const value = process.env[key];
    if (value) return value;
  }
  // Shared fallback
  return process.env.EVM_DEPLOYER_PRIVATE_KEY;
}

export function getDeploymentPath(name: string): string {
  const config = loadNetwork(name);
  return path.resolve(__dirname, '../../chains/evm', config.deploymentFile);
}

export function loadDeployment(name: string): DeploymentJson {
  const deploymentPath = getDeploymentPath(name);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      `Deployment file not found for network "${name}" at ${deploymentPath}. Deploy first.`
    );
  }
  const raw = fs.readFileSync(deploymentPath, 'utf-8');
  return JSON.parse(raw) as DeploymentJson;
}

export function getEvmChainContexts(): EvmChainContext[] {
  const liveNetworks = getLiveNetworks();
  const contexts: EvmChainContext[] = [];
  for (const [name, config] of Object.entries(liveNetworks)) {
    try {
      const deployment = loadDeployment(name);
      const rpcUrl = getRpcUrl(name);
      contexts.push({ name, config, deployment, rpcUrl });
    } catch (err: any) {
      console.warn(`Skipping chain "${name}": ${err.message}`);
    }
  }
  return contexts;
}

/** Validate startup configuration without exposing secret values */
export function validateConfig(): {
  ok: boolean;
  liveChains: string[];
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  const liveNetworks = getLiveNetworks();
  const liveChains = Object.keys(liveNetworks);

  for (const [name, netConfig] of Object.entries(liveNetworks)) {
    // RPC URL
    try {
      getRpcUrl(name);
    } catch (err: any) {
      errors.push(`[${name}] ${err.message}`);
    }

    // Deployment artifact
    try {
      loadDeployment(name);
    } catch (err: any) {
      errors.push(`[${name}] ${err.message}`);
    }

    // Deployer key
    const deployerKey = getDeployerPrivateKey(name);
    if (!deployerKey) {
      warnings.push(
        `[${name}] No deployer private key found. Set one of: ` +
        `${(DEPLOYER_KEY_ALIASES[name] || []).join(', ') || `${name.toUpperCase().replace(/-/g, '_')}_DEPLOYER_PRIVATE_KEY`}, ` +
        `or EVM_DEPLOYER_PRIVATE_KEY as a shared fallback.`
      );
    }

    // Domain ID consistency
    const expectedDomainId = (() => {
      switch (name) {
        case 'base-sepolia': return 33554434;
        case 'ethereum-sepolia': return 33554435;
        case 'polygon-amoy': return 33554436;
        case 'bsc-testnet': return 33554438;
        default: return undefined;
      }
    })();
    if (expectedDomainId !== undefined && netConfig.domainId !== expectedDomainId) {
      errors.push(
        `[${name}] Domain ID mismatch: networks.json has ${netConfig.domainId}, expected ${expectedDomainId}`
      );
    }

    // Asset ID version
    const deployment = (() => {
      try { return loadDeployment(name); } catch { return null; }
    })();
    if (deployment && (deployment as any).assetIdVersion !== 2) {
      warnings.push(
        `[${name}] Deployment artifact assetIdVersion is ${(deployment as any).assetIdVersion || 'missing'}, expected 2 for v2 chains`
      );
    }
  }

  return { ok: errors.length === 0, liveChains, warnings, errors };
}
