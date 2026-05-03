import { PublicKey } from "@solana/web3.js";

export type SupportedChain = "solana" | "base" | "bsc" | "ethereum";

export interface ChainConfig {
  id: SupportedChain;
  name: string;
  displayName: string;
  icon: string;
  isTestnet: boolean;
  rpcUrl: string;
  blockExplorerUrl: string;
}

export const SOLANA_DEVNET: ChainConfig = {
  id: "solana",
  name: "Solana Devnet",
  displayName: "Solana",
  icon: "/icons/solana.svg",
  isTestnet: true,
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com",
  blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
};

export const BASE_SEPOLIA: ChainConfig = {
  id: "base",
  name: "Base Sepolia",
  displayName: "Base",
  icon: "/icons/base.svg",
  isTestnet: true,
  rpcUrl: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  blockExplorerUrl: "https://sepolia.basescan.org",
};

export const BSC_TESTNET: ChainConfig = {
  id: "bsc",
  name: "BNB Chain Testnet",
  displayName: "BNB Chain",
  icon: "/icons/bsc.svg",
  isTestnet: true,
  rpcUrl: process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com",
  blockExplorerUrl: "https://testnet.bscscan.com",
};

export const ETHEREUM_SEPOLIA: ChainConfig = {
  id: "ethereum",
  name: "Ethereum Sepolia",
  displayName: "Ethereum",
  icon: "/icons/ethereum.svg",
  isTestnet: true,
  rpcUrl: process.env.NEXT_PUBLIC_ETH_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  blockExplorerUrl: "https://sepolia.etherscan.io",
};

export const CHAINS: Record<SupportedChain, ChainConfig> = {
  solana: SOLANA_DEVNET,
  base: BASE_SEPOLIA,
  bsc: BSC_TESTNET,
  ethereum: ETHEREUM_SEPOLIA,
};

export const SUPPORTED_CHAINS: SupportedChain[] = ["solana", "base", "bsc", "ethereum"];
