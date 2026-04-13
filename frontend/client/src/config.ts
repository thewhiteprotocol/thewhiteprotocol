export const SOLANA_DEVNET_CONFIG = {
  PROGRAM_ID: 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
  POOL_CONFIG: 'uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc',
  MERKLE_TREE: 'DR3C2PRhgtcgZDiaAtKGHMK2Z3AZr1QUAHNCeLmJ37W4',
  PENDING_BUFFER: 'GFfT479ybSWUZgBaq4rLjU2zuwYX8ziPXHqX9rYZmRTS',
  AUTHORITY: '6qroZpZMFjLzhyBVz8CUeUjWXhmue3EAVQM57FczNysA',
  RELAYER_REGISTRY: 'Eo5t5SicskPpzSPxpDWnru6BHvfjEXTNSdSVgD5tErvF',
  COMPLIANCE_CONFIG: 'FGkwjNzeC1z2RubycEGAxAocmwKy6SoTd8Ed3QCwzaBF',
  RPC_URL: 'https://api.devnet.solana.com',
  RELAYER_ENDPOINT: 'https://api.psolprotocol.org',
  NATIVE_SOL_ASSET_ID: BigInt(0),
  NETWORK: 'Solana Devnet',
  EXPLORER_URL: 'https://explorer.solana.com/address/BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb?cluster=devnet',
  TREE_DEPTH: 20,
} as const;

export const BASE_SEPOLIA_CONFIG = {
  WHITEPROTOCOL_ADDRESS: '0xCE959493cf6F15314b4B9eEbb28369716341e7FE',
  ASSETREGISTRY_ADDRESS: '0x87319Da4558FcBD4f3475cFECc468ee4D736D3ea',
  DEPOSIT_VERIFIER: '0x3F44E947d9f9F0055854aF678F03C32F4bbd415e',
  WITHDRAW_VERIFIER: '0xcb657012d8a718EA8FC51E68cC729d923f023E59',
  MERKLE_BATCH_VERIFIER: '0x71930f07b3bA75A314a6e7c44C350AD0E2718473',
  RPC_URL: 'https://sepolia.base.org',
  CHAIN_ID: 84532,
  NATIVE_ETH_ASSET_ID: BigInt(0),
  NETWORK: 'Base Sepolia',
  EXPLORER_URL: 'https://sepolia.basescan.org',
  TREE_DEPTH: 20,
} as const;

// Default to Solana config for backward compatibility
export const DEVNET_CONFIG = SOLANA_DEVNET_CONFIG;

export const {
  PROGRAM_ID,
  POOL_CONFIG,
  MERKLE_TREE,
  PENDING_BUFFER,
  AUTHORITY,
  RELAYER_REGISTRY,
  COMPLIANCE_CONFIG,
  RPC_URL,
  RELAYER_ENDPOINT,
  NATIVE_SOL_ASSET_ID,
  NETWORK,
  EXPLORER_URL,
  TREE_DEPTH,
} = SOLANA_DEVNET_CONFIG;

// Multi-chain config
export const MULTICHAIN_CONFIG = {
  SOLANA: SOLANA_DEVNET_CONFIG,
  BASE: BASE_SEPOLIA_CONFIG,
} as const;

export type ChainType = 'SOLANA' | 'BASE';

// New unified chain config format
export const SUPPORTED_CHAINS = {
  SOLANA_DEVNET: {
    id: 'solana-devnet',
    name: 'Solana Devnet',
    type: 'solana' as const,
    programId: SOLANA_DEVNET_CONFIG.PROGRAM_ID,
    poolConfig: SOLANA_DEVNET_CONFIG.POOL_CONFIG,
    rpcUrl: SOLANA_DEVNET_CONFIG.RPC_URL,
  },
  BASE_SEPOLIA: {
    id: 'base-sepolia',
    name: 'Base Sepolia',
    type: 'evm' as const,
    chainId: BASE_SEPOLIA_CONFIG.CHAIN_ID,
    contracts: {
      whiteProtocol: BASE_SEPOLIA_CONFIG.WHITEPROTOCOL_ADDRESS,
      assetRegistry: BASE_SEPOLIA_CONFIG.ASSETREGISTRY_ADDRESS,
      depositVerifier: BASE_SEPOLIA_CONFIG.DEPOSIT_VERIFIER,
      withdrawVerifier: BASE_SEPOLIA_CONFIG.WITHDRAW_VERIFIER,
      merkleBatchVerifier: BASE_SEPOLIA_CONFIG.MERKLE_BATCH_VERIFIER,
    },
    rpcUrl: BASE_SEPOLIA_CONFIG.RPC_URL,
  },
};

export type SupportedChain = keyof typeof SUPPORTED_CHAINS;
