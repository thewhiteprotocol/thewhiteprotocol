"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrCode, Link2, Camera, ArrowRight, Loader2, CheckCircle2, Wallet } from "lucide-react";
import { useChain } from "@/providers/ChainContext";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWalletClient } from "wagmi";
import { BrowserQRCodeReader } from "@zxing/browser";
import { PublicKey } from "@solana/web3.js";
import { parsePaymentLink, PaymentRequest } from "@/lib/paymentLink";
import { SUPPORTED_ASSETS } from "@/config/constants";
import { CHAINS } from "@/config/chains";
import { initializePoseidon, computeAssetIdBigInt, formatProofForOnChain } from "@/lib/crypto";
import { generateDepositProof } from "@/lib/proofService";
import { solanaChainService, baseChainService } from "@/lib/chainService";
import { useToast } from "@/providers/ToastContext";
import { addNote } from "@/lib/noteStore";
import { maybeCreateReceipt } from "@/lib/autoReceipt";

function truncate(str: string, len = 8) {
  if (str.length <= len * 2 + 4) return str;
  return str.slice(0, len) + "..." + str.slice(-len);
}

export default function SendPage() {
  const { isConnected } = useChain();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Private Payment</h1>
        <p className="text-zinc-400">Send funds privately to any recipient.</p>
      </div>

      {!isConnected ? (
        <Card className="glass-card border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Wallet className="h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 text-lg font-medium">Connect your wallet</h3>
            <p className="mt-1 text-sm text-zinc-400">Connect a wallet to send private payments.</p>
          </CardContent>
        </Card>
      ) : (
        <PaymentForm />
      )}
    </motion.div>
  );
}

function PaymentForm() {
  const [mode, setMode] = useState<"scan" | "link">("scan");
  const [parsed, setParsed] = useState<PaymentRequest | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);

  // QR Scanner
  useEffect(() => {
    if (mode !== "scan" || parsed) return;
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    const reader = new BrowserQRCodeReader();
    setScanning(true);

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result, err) => {
        if (cancelled) return;
        if (result) {
          const text = result.getText();
          const payment = parsePaymentLink(text);
          if (payment) {
            setParsed(payment);
            setScanning(false);
            cancelled = true;
            controls?.stop();
          } else {
            setScanError("Invalid QR code");
          }
        }
      })
      .then((c) => {
        controls = c as any;
      })
      .catch(() => {
        setScanError("Camera access denied or not available");
        setScanning(false);
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [mode, parsed]);

  function handleLinkPaste(raw: string) {
    const payment = parsePaymentLink(raw);
    if (payment) {
      setParsed(payment);
      setScanError(null);
    } else {
      setScanError("Invalid payment link");
    }
  }

  if (parsed) {
    return <PaymentConfirm parsed={parsed} onReset={() => setParsed(null)} />;
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">Scan or Paste Payment Request</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-white/[0.03]">
            <TabsTrigger value="scan" className="data-[state=active]:bg-white/10">
              <Camera className="mr-2 h-4 w-4" />
              Scan QR
            </TabsTrigger>
            <TabsTrigger value="link" className="data-[state=active]:bg-white/10">
              <Link2 className="mr-2 h-4 w-4" />
              Paste Link
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scan" className="pt-2">
            <div className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" />
              {!scanning && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-sm text-zinc-400">Camera inactive</p>
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-lg border-2 border-dashed border-emerald-500/50" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="link" className="pt-2">
            <div className="space-y-3">
              <Input
                placeholder="https://white.protocol/pay?c=..."
                onChange={(e) => handleLinkPaste(e.target.value)}
                className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500"
              />
              <p className="text-xs text-zinc-500">Paste a White Protocol payment link above.</p>
            </div>
          </TabsContent>
        </Tabs>

        {scanError && <p className="text-center text-sm text-red-400">{scanError}</p>}
      </CardContent>
    </Card>
  );
}

function PaymentConfirm({ parsed, onReset }: { parsed: PaymentRequest; onReset: () => void }) {
  const { activeChain, walletAddress } = useChain();
  const solanaWallet = useSolanaWallet();
  const { data: evmWalletClient } = useWalletClient();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const asset = SUPPORTED_ASSETS.find((a) => a.symbol === parsed.asset);
  const amountDisplay = parsed.amount && Number(parsed.amount) > 0 ? `${parsed.amount} ${parsed.asset}` : `Any amount of ${parsed.asset}`;

  async function handlePay() {
    setBusy(true);
    setError(null);
    try {
      await initializePoseidon();
      const commitment = BigInt(parsed.commitment);
      const rawAmount = parsed.amount && asset ? parseTokenAmount(parsed.amount, asset.decimals) : 0n;
      const assetId = computeAssetIdBigInt(asset?.address || "0");

      // For payment links, we pay to the receiver's commitment
      // We generate a "deposit proof" for that commitment (with dummy secret/nullifier)
      // In reality, the sender doesn't need to know the secret - they just deposit to the commitment
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
      await maybeCreateReceipt({
        type: "payment_sent",
        from: { walletAddress: walletAddress || "" },
        to: { walletAddress: "Payment Link Recipient" },
        amount: parsed.amount ? Number(parsed.amount) : 0,
        asset: parsed.asset,
        chain: parsed.chain,
        txHash: hash || "",
      });
      showToast("Payment sent successfully", "success");
    } catch (err: any) {
      setError(err?.message || "Payment failed");
      showToast(err?.message || "Payment failed", "error");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (success) {
    return (
      <Card className="glass-card border-white/10">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
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
          <Button onClick={onReset} className="mt-6 bg-emerald-600 hover:bg-emerald-700">
            Send Another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="text-lg">Confirm Payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs text-zinc-500">To</p>
          <p className="font-mono text-sm text-zinc-200">{truncate(parsed.commitment, 16)}</p>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs text-zinc-500">Amount</p>
          <p className="text-xl font-semibold">{amountDisplay}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-white/10 text-zinc-400">
            {parsed.chain}
          </Badge>
          <Badge variant="outline" className="border-white/10 text-zinc-400">
            {parsed.asset}
          </Badge>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 border-white/10 hover:bg-white/[0.03]" onClick={onReset}>
            Cancel
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            disabled={busy}
            onClick={handlePay}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {step || "Paying..."}
              </>
            ) : (
              <>
                <ArrowRight className="mr-2 h-4 w-4" />
                Pay
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
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
