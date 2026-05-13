"use client";

import { computeCommitment, randomFieldElement, computeAssetIdBigInt } from "./crypto";
import { addNote } from "./noteStore";
import { StoredNote } from "./types";
import { SUPPORTED_ASSETS } from "@/config/constants";

export interface PaymentRequest {
  commitment: string;
  amount?: string;
  asset: string;
  chain: "solana" | "base" | "bsc" | "ethereum" | "polygon";
  encryptedNote?: string;
  /** Optional ephemeral pubkey for stealth withdrawals (hex string) */
  ephemeralPubkey?: string;
  /** Whether this request was generated from a meta-address */
  isMetaAddress?: boolean;
  /** Original meta-address if applicable */
  metaAddress?: string;
}

export interface PaymentLinkResult {
  link: string;
  qrData: string;
  note: StoredNote;
}

const APP_ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://white.protocol";

export async function createPaymentRequest(
  amount: string | undefined,
  asset: string,
  chain: "solana" | "base" | "bsc" | "ethereum" | "polygon"
): Promise<PaymentLinkResult> {
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();
  const assetConfig = getAssetConfig(asset, chain);
  const assetId = computeAssetIdBigInt(assetConfig?.address || "0");
  const rawAmount = amount && Number(amount) > 0
    ? parseTokenAmount(amount, assetConfig?.decimals || 9)
    : 0n;

  const commitment = computeCommitment(secret, nullifier, rawAmount, assetId);

  const note: StoredNote = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    commitment: commitment.toString(),
    amount: rawAmount.toString(),
    asset,
    assetId: assetId.toString(),
    chain,
    timestamp: Date.now(),
    status: "awaiting_payment",
  };

  await addNote(note);

  // Simple encryption: base64 encode the note (in production, use real encryption)
  const encryptedNote = btoa(JSON.stringify({ secret: note.secret, nullifier: note.nullifier }));

  const params = new URLSearchParams();
  params.set("c", commitment.toString());
  params.set("a", amount || "");
  params.set("t", asset);
  params.set("ch", chain);
  params.set("n", encryptedNote);

  const link = `${APP_ORIGIN}/pay?${params.toString()}`;

  return {
    link,
    qrData: link,
    note,
  };
}

export function parsePaymentLink(url: string): PaymentRequest | null {
  try {
    const parsed = new URL(url);
    const commitment = parsed.searchParams.get("c");
    const amount = parsed.searchParams.get("a") || undefined;
    const asset = parsed.searchParams.get("t");
    const chain = parsed.searchParams.get("ch") as "solana" | "base" | "bsc" | "ethereum" | "polygon" | null;
    const encryptedNote = parsed.searchParams.get("n") || "";

    if (!commitment || !asset || !chain) return null;
    if (chain !== "solana" && chain !== "base" && chain !== "bsc" && chain !== "ethereum" && chain !== "polygon") return null;

    return {
      commitment,
      amount: amount || undefined,
      asset,
      chain,
      encryptedNote,
    };
  } catch {
    return null;
  }
}

export function parsePaymentParams(params: URLSearchParams): PaymentRequest | null {
  const commitment = params.get("c");
  const amount = params.get("a") || undefined;
  const asset = params.get("t");
  const chain = params.get("ch") as "solana" | "base" | "bsc" | "ethereum" | "polygon" | null;
  const encryptedNote = params.get("n") || "";

  if (!commitment || !asset || !chain) return null;
  if (chain !== "solana" && chain !== "base" && chain !== "bsc" && chain !== "ethereum" && chain !== "polygon") return null;

  return {
    commitment,
    amount: amount || undefined,
    asset,
    chain,
    encryptedNote,
  };
}

function getAssetConfig(symbol: string, chain: "solana" | "base" | "bsc" | "ethereum" | "polygon") {
  return SUPPORTED_ASSETS.find((a) => a.symbol === symbol && (a.chain === chain || a.chain === "both"));
}

function parseTokenAmount(amount: string, decimals: number): bigint {
  const [intStr, fracStr = ""] = amount.split(".");
  const padded = fracStr.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(intStr) * 10n ** BigInt(decimals) + BigInt(padded);
}
