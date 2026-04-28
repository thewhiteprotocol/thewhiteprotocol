import { bscTestnet } from "wagmi/chains";

export const BSC_PROTOCOL_ADDRESS = (process.env.NEXT_PUBLIC_BSC_PROTOCOL_ADDRESS ||
  "") as `0x${string}`;

export const BSC_ASSET_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_BSC_ASSET_REGISTRY_ADDRESS ||
  "") as `0x${string}`;

export const BSC_DEPOSIT_VERIFIER_ADDRESS = (process.env.NEXT_PUBLIC_BSC_DEPOSIT_VERIFIER_ADDRESS ||
  "") as `0x${string}`;

export const BSC_WITHDRAW_VERIFIER_ADDRESS = (process.env.NEXT_PUBLIC_BSC_WITHDRAW_VERIFIER_ADDRESS ||
  "") as `0x${string}`;

export const BSC_MERKLE_BATCH_VERIFIER_ADDRESS = (process.env.NEXT_PUBLIC_BSC_MERKLE_BATCH_VERIFIER_ADDRESS ||
  "") as `0x${string}`;

export const WBNB_ADDRESS = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as `0x${string}`;
export const USDT_ADDRESS = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as `0x${string}`;

export { bscTestnet };
