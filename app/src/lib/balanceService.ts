"use client";

import { StoredNote } from "./types";

const COINGECKO_IDS: Record<string, string> = {
  SOL: "solana",
  ETH: "ethereum",
  WETH: "weth",
  USDC: "usd-coin",
  BNB: "binancecoin",
  WBNB: "wbnb",
  USDT: "tether",
};

let priceCache: Record<string, number> = {};
let priceCacheTime = 0;
const CACHE_TTL_MS = 60_000;

export async function fetchPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - priceCacheTime < CACHE_TTL_MS && Object.keys(priceCache).length > 0) {
    return priceCache;
  }
  try {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { cache: "no-store" }
    );
    if (!res.ok) throw new Error("Price fetch failed");
    const data = await res.json();
    const prices: Record<string, number> = {};
    for (const [symbol, cgId] of Object.entries(COINGECKO_IDS)) {
      prices[symbol] = data[cgId]?.usd || 0;
    }
    priceCache = prices;
    priceCacheTime = now;
    return prices;
  } catch {
    return Object.fromEntries(Object.keys(COINGECKO_IDS).map((k) => [k, 0]));
  }
}

export function getShieldedBalance(
  notes: StoredNote[],
  chain?: "solana" | "base" | "bsc",
  asset?: string
): bigint {
  return notes
    .filter((n) => n.status !== "spent")
    .filter((n) => (chain ? n.chain === chain : true))
    .filter((n) => (asset ? n.asset === asset : true))
    .reduce((sum, n) => sum + BigInt(n.amount), 0n);
}

export function getPendingBalance(notes: StoredNote[]): bigint {
  return notes
    .filter((n) => n.status === "pending")
    .reduce((sum, n) => sum + BigInt(n.amount), 0n);
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0");
  // Trim trailing zeros
  const trimmed = fracStr.replace(/0+$/, "");
  return trimmed ? `${intPart}.${trimmed}` : intPart.toString();
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  const [intStr, fracStr = ""] = amount.split(".");
  const padded = fracStr.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(intStr) * 10n ** BigInt(decimals) + BigInt(padded);
}

const ASSET_DECIMALS: Record<string, number> = {
  SOL: 9,
  ETH: 18,
  WETH: 18,
  USDC: 6,
  BNB: 18,
  WBNB: 18,
  USDT: 18,
};

export async function getTotalBalanceUsd(notes: StoredNote[]): Promise<{ total: number; breakdown: Array<{ asset: string; chain: "solana" | "base" | "bsc"; amount: bigint; usdValue: number }> }> {
  const prices = await fetchPrices();
  const breakdownMap = new Map<string, { asset: string; chain: "solana" | "base" | "bsc"; amount: bigint }>();

  for (const note of notes.filter((n) => n.status !== "spent")) {
    const key = `${note.chain}:${note.asset}`;
    const existing = breakdownMap.get(key);
    if (existing) {
      existing.amount += BigInt(note.amount);
    } else {
      breakdownMap.set(key, { asset: note.asset, chain: note.chain, amount: BigInt(note.amount) });
    }
  }

  let total = 0;
  const breakdown: Array<{ asset: string; chain: "solana" | "base" | "bsc"; amount: bigint; usdValue: number }> = [];

  for (const entry of breakdownMap.values()) {
    const decimals = ASSET_DECIMALS[entry.asset] || 18;
    const floatAmount = Number(formatTokenAmount(entry.amount, decimals));
    const price = prices[entry.asset] || 0;
    const usdValue = floatAmount * price;
    total += usdValue;
    breakdown.push({ ...entry, usdValue });
  }

  return { total, breakdown };
}
