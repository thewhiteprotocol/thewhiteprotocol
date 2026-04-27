/**
 * Jupiter Aggregator Integration for Yield Mode
 *
 * Provides SOL <-> LST swap functionality using Jupiter V6 API
 */
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
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
    swapTransaction: string;
    lastValidBlockHeight?: number;
    prioritizationFeeLamports?: number;
};
/**
 * Get Jupiter quote for exact input swap
 *
 * @param params - Quote parameters
 * @returns Jupiter quote with route and amounts
 */
export declare function jupiterQuoteExactIn(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: bigint;
    slippageBps: number;
}): Promise<JupiterQuote>;
/**
 * Execute Jupiter swap with exact input
 *
 * @param params - Swap execution parameters
 * @returns Transaction signature
 */
export declare function jupiterSwapExactIn(params: {
    connection: Connection;
    userPublicKey: PublicKey;
    quote: JupiterQuote;
    signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Promise<{
    signature: string;
}>;
/**
 * Build a no-op memo transaction (reserved for future use)
 */
export declare function buildNoopMemoTx(params: {
    payer: PublicKey;
    memo: string;
    recentBlockhash: string;
}): VersionedTransaction;
//# sourceMappingURL=jupiter.d.ts.map