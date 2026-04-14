"use client";

import React, { Suspense, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, Wallet, ArrowRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useChain } from "@/providers/ChainContext";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWalletClient } from "wagmi";
import { PublicKey } from "@solana/web3.js";
import { parsePaymentParams, PaymentRequest } from "@/lib/paymentLink";
import { SUPPORTED_ASSETS } from "@/config/constants";
import { CHAINS } from "@/config/chains";
import { initializePoseidon, computeAssetIdBigInt, formatProofForOnChain } from "@/lib/crypto";
import { generateDepositProof } from "@/lib/proofService";
import { solanaChainService, baseChainService } from "@/lib/chainService";
import { SolanaConnectButton, EvmConnectButton } from "@/providers/WalletProvider";

function truncate(str: string, len = 8) {
  if (str.length <= len * 2 + 4) return str;
  return str.slice(0, len) + "..." + str.slice(-len);
}

export default function PayPage() {
  return (
    <Suspense fallback={<PaySkeleton />}>
      <PayContent />
    </Suspense>
  );
}

function PaySkeleton() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
    </div>
  );
}

function PayContent() {
  const searchParams = useSearchParams();
  const parsed = parsePaymentParams(searchParams);

  if (!parsed) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center">
        <Card className="glass-card w-full border-white/10">
          <CardContent className="py-12 text-center">
            <h2 className="text-xl font-semibold">Invalid Payment Link</h2>
            <p className="mt-2 text-sm text-zinc-400">The payment URL is missing required parameters.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <PaymentCard parsed={parsed} />;
}

function PaymentCard({ parsed }: { parsed: PaymentRequest }) {
  const { activeChain, isConnected } = useChain();
  const solanaWallet = useSolanaWallet();
  const { data: evmWalletClient } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const asset = SUPPORTED_ASSETS.find((a) => a.symbol === parsed.asset);
  const amountDisplay = parsed.amount && Number(parsed.amount) > 0 ? `${parsed.amount} ${parsed.asset}` : `Any amount of ${parsed.asset}`;
  const needsSwitch = isConnected && activeChain !== parsed.chain;

  async function handlePay() {
    setBusy(true);
    setError(null);
    try {
      await initializePoseidon();
      const commitment = BigInt(parsed.commitment);
      const rawAmount = parsed.amount && asset ? parseTokenAmount(parsed.amount, asset.decimals) : 0n;
      const assetId = computeAssetIdBigInt(asset?.address || "0");

      setStep("Generating proof...");
      const dummySecret = 1n;
      const dummyNullifier = 1n;
      const { proof } = await generateDepositProof({
        secret: dummySecret,
        nullifier: dummyNullifier,
        commitment,
        amount: rawAmount,
        assetId,
      });
      const proofBytes = formatProofForOnChain(proof);

      setStep("Sending transaction...");
      let hash: string | undefined;
      if (parsed.chain === "solana") {
        if (!solanaWallet.publicKey) throw new Error("Solana wallet not connected");
        hash = await solanaChainService.deposit(
          solanaWallet,
          proofBytes,
          commitment,
          rawAmount,
          bigintToBytes32(assetId),
          new PublicKey(asset?.address || "So11111111111111111111111111111111111111112")
        );
      } else {
        if (!evmWalletClient) throw new Error("EVM wallet not connected");
        const tokenAddr = (asset?.address || "0x0000000000000000000000000000000000000000") as `0x${string}`;
        hash = await baseChainService.deposit(
          evmWalletClient,
          proofBytes,
          commitment,
          rawAmount,
          tokenAddr
        );
      }

      setTxHash(hash);
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || "Payment failed");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (success) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center p-4"
      >
        <Card className="glass-card w-full border-white/10">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="mt-4 text-xl font-semibold">Payment Sent!</h3>
            <p className="mt-1 text-sm text-zinc-400">The recipient can now claim their funds.</p>
            {txHash && (
              <a
                href={`${CHAINS[parsed.chain].blockExplorerUrl}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 break-all font-mono text-sm text-emerald-400 hover:underline"
              >
                {truncate(txHash, 20)}
              </a>
            )}
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center p-4"
    >
      <Card className="glass-card w-full border-white/10">
        <CardHeader>
          <CardTitle className="text-center text-lg">Pay {parsed.asset}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <p className="text-sm text-zinc-500">Amount</p>
            <p className="text-3xl font-bold">{amountDisplay}</p>
          </div>

          <div className="flex justify-center gap-2">
            <Badge variant="outline" className="border-white/10 text-zinc-400">
              {parsed.chain === "solana" ? "Solana" : "Base"}
            </Badge>
            <Badge variant="outline" className="border-white/10 text-zinc-400">
              White Protocol
            </Badge>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-zinc-500">Commitment</p>
            <p className="font-mono text-xs text-zinc-300">{truncate(parsed.commitment, 18)}</p>
          </div>

          {!isConnected ? (
            <div className="space-y-3">
              <p className="text-center text-sm text-zinc-400">Connect a wallet to continue</p>
              <div className="flex justify-center">
                {parsed.chain === "solana" ? <SolanaConnectButton /> : <EvmConnectButton />}
              </div>
            </div>
          ) : needsSwitch ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-amber-400">
                Please switch to {parsed.chain === "solana" ? "Solana" : "Base"} in the app header.
              </p>
            </div>
          ) : (
            <>
              {error && <p className="text-center text-sm text-red-400">{error}</p>}
              <Button
                onClick={handlePay}
                disabled={busy}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {step || "Paying..."}
                  </>
                ) : (
                  <>
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Pay Now
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function parseTokenAmount(amount: string, decimals: number): bigint {
  const [intStr, fracStr = ""] = amount.split(".");
  const padded = fracStr.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(intStr) * 10n ** BigInt(decimals) + BigInt(padded);
}
