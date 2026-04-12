/**
 * Jupiter Aggregator Integration for Yield Mode
 * 
 * Provides SOL <-> LST swap functionality using Jupiter V6 API
 */

import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";

/**
 * Jupiter quote response (V6 API)
 */
export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn" | "ExactOut";
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot?: number;
  timeTaken?: number;
};

/**
 * Jupiter swap transaction response
 */
export type JupiterSwapResponse = {
  swapTransaction: string; // base64
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
};

/**
 * Get Jupiter base URL from env or default
 */
function getJupiterBaseUrl(): string {
  return process.env.JUPITER_BASE_URL ?? "https://quote-api.jup.ag";
}

/**
 * Get Jupiter quote for exact input swap
 * 
 * @param params - Quote parameters
 * @returns Jupiter quote with route and amounts
 */
export async function jupiterQuoteExactIn(params: {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint; // in smallest units
  slippageBps: number;
}): Promise<JupiterQuote> {
  const base = getJupiterBaseUrl();
  const url = new URL(`${base}/v6/quote`);
  
  url.searchParams.set("inputMint", params.inputMint.toBase58());
  url.searchParams.set("outputMint", params.outputMint.toBase58());
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps));
  url.searchParams.set("swapMode", "ExactIn");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Jupiter quote failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  return (await res.json()) as JupiterQuote;
}

/**
 * Execute Jupiter swap with exact input
 * 
 * @param params - Swap execution parameters
 * @returns Transaction signature
 */
export async function jupiterSwapExactIn(params: {
  connection: Connection;
  userPublicKey: PublicKey;
  quote: JupiterQuote;
  // Wallet adapter-like signer: must sign VersionedTransaction
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Promise<{ signature: string }> {
  const base = getJupiterBaseUrl();
  
  const res = await fetch(`${base}/v6/swap`, {
    method: "POST",
    headers: { 
      "content-type": "application/json", 
      accept: "application/json" 
    },
    body: JSON.stringify({
      quoteResponse: params.quote,
      userPublicKey: params.userPublicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Jupiter swap build failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const json = (await res.json()) as JupiterSwapResponse;
  
  if (!json.swapTransaction) {
    throw new Error("Jupiter swap response missing swapTransaction");
  }

  // Deserialize and sign the transaction
  const raw = Buffer.from(json.swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(raw);
  const signed = await params.signTransaction(tx);

  // Submit transaction
  const sig = await params.connection.sendTransaction(signed, {
    maxRetries: 3,
    skipPreflight: false,
  });

  // Wait for confirmation
  const latest = await params.connection.getLatestBlockhash("finalized");
  await params.connection.confirmTransaction(
    { signature: sig, ...latest },
    "finalized"
  );

  return { signature: sig };
}

/**
 * Build a no-op memo transaction (reserved for future use)
 */
export function buildNoopMemoTx(params: {
  payer: PublicKey;
  memo: string;
  recentBlockhash: string;
}): VersionedTransaction {
  const msg = new TransactionMessage({
    payerKey: params.payer,
    recentBlockhash: params.recentBlockhash,
    instructions: [],
  }).compileToV0Message();
  
  return new VersionedTransaction(msg);
}
