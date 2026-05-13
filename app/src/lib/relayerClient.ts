"use client";

const DEFAULT_RELAYER_URL =
  process.env.NEXT_PUBLIC_RELAYER_URL || "https://relayer.thewhiteprotocol.com";

function getRelayerUrl(): string {
  if (typeof window === "undefined") return DEFAULT_RELAYER_URL;
  const custom = localStorage.getItem("white_protocol_relayer_url");
  return custom ? custom.replace(/\/$/, "") : DEFAULT_RELAYER_URL;
}

export interface RelayerStatus {
  status: "ok" | "error";
}

export async function getRelayerHealth(): Promise<RelayerStatus> {
  const res = await fetch(`${getRelayerUrl()}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error("Relayer health check failed");
  return res.json();
}

export interface RelayerQuote {
  amount: string;
  fee: string;
  feeBps: number;
  netAmount: string;
  relayer: {
    solana: string;
    evm: Record<string, string | null>;
  };
}

export async function getRelayerQuote(amount: string): Promise<RelayerQuote> {
  const res = await fetch(`${getRelayerUrl()}/quote?amount=${amount}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch relayer quote");
  return res.json();
}

export interface RelayedWithdrawalParams {
  chain: "solana" | "base" | "bsc" | "ethereum" | "polygon";
  proofData: string; // hex string, 512 chars = 256 bytes
  merkleRoot: string; // hex string, 64 chars = 32 bytes
  nullifierHash: string; // hex string, 64 chars = 32 bytes
  recipient: string;
  amount: string;
  assetId: string; // hex string, 64 chars = 32 bytes
  mint: string; // token address / mint address
}

export interface RelayedWithdrawalV2Params {
  chain: "solana" | "base" | "bsc" | "ethereum" | "polygon";
  proofData: string; // hex string, 512 chars = 256 bytes
  merkleRoot: string; // hex string, 64 chars = 32 bytes
  nullifierHash: string; // hex string, 64 chars = 32 bytes
  nullifierHash1?: string; // hex string, 64 chars = 32 bytes (unused, defaults to zeros)
  changeCommitment: string; // hex string, 64 chars = 32 bytes
  recipient: string;
  amount: string;
  assetId: string; // hex string, 64 chars = 32 bytes
  mint: string; // token address / mint address
}

export async function submitRelayedWithdrawal(params: RelayedWithdrawalParams): Promise<{ success: boolean; signature?: string; error?: string }> {
  const res = await fetch(`${getRelayerUrl()}/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function submitRelayedWithdrawalV2(params: RelayedWithdrawalV2Params): Promise<{ success: boolean; signature?: string; error?: string }> {
  const res = await fetch(`${getRelayerUrl()}/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...params,
      version: "v2",
      nullifierHash1: params.nullifierHash1 || "0".repeat(64),
    }),
  });
  return res.json();
}

const CHAIN_TO_RELAYER_NETWORK: Record<string, string> = {
  base: "base-sepolia",
  bsc: "bsc-testnet",
};

export function getRelayerEvmAddress(quote: RelayerQuote, chain: "base" | "bsc"): string | null {
  const network = CHAIN_TO_RELAYER_NETWORK[chain];
  if (!network) return null;
  const fromMap = quote.relayer.evm?.[network];
  if (fromMap) return fromMap;
  return (quote.relayer as any).base || null;
}

export interface NoteStatusResponse {
  success: boolean;
  status?: "pending" | "settled" | "unknown";
  leafIndex?: number;
  pendingIndex?: number;
  commitment?: string;
  error?: string;
  hint?: string;
}

export async function checkNoteStatus(commitment: string): Promise<NoteStatusResponse> {
  const res = await fetch(`${getRelayerUrl()}/api/note/${commitment}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    return { success: false, error: `Relayer returned ${res.status}: ${text}` };
  }
  return res.json();
}

export interface MerkleProofResponse {
  success: boolean;
  leafIndex: number;
  merkleRoot: string;
  merkleRootHex: string;
  pathElements: string[];
  pathIndices: number[];
  error?: string;
}

export async function getMerkleProof(leafIndex: number): Promise<MerkleProofResponse> {
  const res = await fetch(`${getRelayerUrl()}/api/merkle/proof/${leafIndex}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    return { success: false, error: `Relayer returned ${res.status}: ${text}` } as MerkleProofResponse;
  }
  return res.json();
}

export async function trackDeposit(commitment: string, txHash?: string): Promise<{ success: boolean; pendingCount?: number; error?: string }> {
  const res = await fetch(`${getRelayerUrl()}/api/track-deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitment, txHash }),
  });
  return res.json();
}
