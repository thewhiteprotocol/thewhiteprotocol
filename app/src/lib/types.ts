export type NoteStatus = "pending" | "settled" | "spent" | "awaiting_payment";

export interface StoredNote {
  secret: string;
  nullifier: string;
  commitment: string;
  amount: string;
  asset: string;
  assetId: string;
  chain: "solana" | "base" | "bsc";
  leafIndex?: number;
  timestamp: number;
  status: NoteStatus;
  txHash?: string;
  recipient?: string;
}

export interface EncryptedNoteStore {
  version: number;
  iv: string;
  ciphertext: string;
  salt: string;
}
