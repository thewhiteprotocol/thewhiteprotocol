import { PublicKey } from "@solana/web3.js";

export const SOLANA_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SOLANA_PROGRAM_ID || "DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk"
);

export const SOLANA_POOL_CONFIG = new PublicKey(
  process.env.NEXT_PUBLIC_SOLANA_POOL_CONFIG || "5tiLj9YYhsc28h1JVVBBeUmUKmwTEUEnzn7q86NNso6q"
);

// Derive Merkle Tree PDA
export const getSolanaMerkleTreePda = () => {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), SOLANA_POOL_CONFIG.toBuffer()],
    SOLANA_PROGRAM_ID
  );
  return pda;
};

// Derive Pending Deposits Buffer PDA
export const getSolanaPendingDepositsPda = () => {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_deposits"), SOLANA_POOL_CONFIG.toBuffer()],
    SOLANA_PROGRAM_ID
  );
  return pda;
};

// Native SOL mint address (used for SPL token accounting)
export const SOLANA_WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// USDC mint on devnet (optional)
export const SOLANA_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
