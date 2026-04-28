export const MERKLE_TREE_DEPTH = 20;
export const MAX_LEAVES = 1 << MERKLE_TREE_DEPTH;
export const DEFAULT_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 10;
export const DEFAULT_RELAYER_FEE_BPS = 50;
export const YIELD_RELAYER_FEE_BPS = 500;
export const MIN_WITHDRAWAL_AMOUNT = 100;

export interface AssetConfig {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  chain: "solana" | "base" | "bsc" | "both";
  address?: string;
  isNative?: boolean;
  isYield?: boolean;
}

export const SUPPORTED_ASSETS: AssetConfig[] = [
  {
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    icon: "/icons/solana.svg",
    chain: "solana",
    address: "So11111111111111111111111111111111111111112",
    isNative: true,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    icon: "/icons/ethereum.svg",
    chain: "base",
    address: "0x0000000000000000000000000000000000000000",
    isNative: true,
  },
  {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    decimals: 18,
    icon: "/icons/weth.svg",
    chain: "base",
    address: "0x4200000000000000000000000000000000000006",
    isNative: false,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    icon: "/icons/usdc.svg",
    chain: "solana",
    address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    isNative: false,
  },
  {
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
    icon: "/icons/bnb.svg",
    chain: "bsc",
    address: "0x0000000000000000000000000000000000000000",
    isNative: true,
  },
  {
    symbol: "WBNB",
    name: "Wrapped BNB",
    decimals: 18,
    icon: "/icons/wbnb.svg",
    chain: "bsc",
    address: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
    isNative: false,
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    icon: "/icons/usdt.svg",
    chain: "bsc",
    address: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
    isNative: false,
  },
];

export const getAssetsForChain = (chain: "solana" | "base" | "bsc") => {
  return SUPPORTED_ASSETS.filter((a) => a.chain === chain || a.chain === "both");
};

export const getAssetBySymbol = (symbol: string) => {
  return SUPPORTED_ASSETS.find((a) => a.symbol === symbol);
};
