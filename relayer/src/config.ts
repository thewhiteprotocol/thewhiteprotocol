import * as fs from 'fs';
import * as path from 'path';

export interface NetworkConfig {
  chainId: number;
  rpcUrlEnvVar: string;
  explorerUrl: string;
  nativeSymbol: string;
  wrappedNative: string | null;
  usdc: string | null;
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
  };
  relayers: string[];
  merkleState: {
    emptyRoot: string;
    nextLeafIndex: number;
  };
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

export function getRpcUrl(name: string): string {
  const config = loadNetwork(name);
  const url = process.env[config.rpcUrlEnvVar];
  if (!url) {
    throw new Error(
      `Missing RPC URL for network "${name}". Set environment variable ${config.rpcUrlEnvVar}`
    );
  }
  return url;
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
