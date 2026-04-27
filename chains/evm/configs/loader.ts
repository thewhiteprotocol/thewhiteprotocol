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

const NETWORKS_JSON_PATH = path.resolve(__dirname, 'networks.json');

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
  return path.resolve(__dirname, '..', config.deploymentFile);
}

export function getAllNetworks(): Record<string, NetworkConfig> {
  return loadNetworks();
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

export function getTestnetNetworks(): Record<string, NetworkConfig> {
  const networks = loadNetworks();
  const testnets: Record<string, NetworkConfig> = {};
  for (const [name, config] of Object.entries(networks)) {
    if (config.isTestnet) {
      testnets[name] = config;
    }
  }
  return testnets;
}
