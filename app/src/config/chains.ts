import { PublicKey } from "@solana/web3.js";

export type SupportedChain = "solana" | "base";

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

export const CHAINS: Record<SupportedChain, ChainConfig> = {
  solana: SOLANA_DEVNET,
  base: BASE_SEPOLIA,
};

export const SUPPORTED_CHAINS: SupportedChain[] = ["solana", "base"];
