"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowDownLeft, ArrowUpRight, Loader2, CheckCircle2, Wallet, ShieldCheck, AlertCircle } from "lucide-react";
import { useChain } from "@/providers/ChainContext";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWalletClient } from "wagmi";
import { PublicKey } from "@solana/web3.js";
import { useToast } from "@/providers/ToastContext";
import { getAssetsForChain, AssetConfig, SUPPORTED_ASSETS } from "@/config/constants";
import { CHAINS } from "@/config/chains";
import { initializePoseidon, computeCommitment, computeNullifierHash, computeAssetIdBigInt, randomFieldElement, formatProofForOnChain, MERKLE_TREE_DEPTH } from "@/lib/crypto";
import { generateDepositProof, generateWithdrawProof } from "@/lib/proofService";
import { solanaChainService, baseChainService } from "@/lib/chainService";
import { getNotes, addNote, updateNote, markSpent } from "@/lib/noteStore";
import { maybeCreateReceipt } from "@/lib/autoReceipt";
import { StoredNote } from "@/lib/types";
import { formatTokenAmount, parseTokenAmount } from "@/lib/balanceService";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { getRelayerQuote, submitRelayedWithdrawal, checkNoteStatus, getMerkleProof, trackDeposit, RelayerQuote } from "@/lib/relayerClient";

function truncate(str: string, len = 8) {
  if (str.length <= len * 2 + 4) return str;
  return str.slice(0, len) + "..." + str.slice(-len);
}

export default function ShieldPage() {
  const { activeChain, isConnected, walletAddress } = useChain();
  const solanaWallet = useSolanaWallet();
  const { data: evmWalletClient } = useWalletClient();
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  useEffect(() => {
    if (!isConnected) {
      setLoadingNotes(false);
      return;
    }
    let mounted = true;
    getNotes()
      .then((n) => {
        if (mounted) setNotes(n);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingNotes(false);
      });
  }, [isConnected, walletAddress]);

  const settledNotes = useMemo(
    () => notes.filter((n) => n.status === "settled" && n.chain === activeChain),
    [notes, activeChain]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-6xl space-y-8"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Deposit & Withdraw</h1>
        <p className="text-zinc-400">Shield your assets into the privacy pool or withdraw them privately.</p>
      </div>

      {!isConnected ? (
        <Card className="glass-card border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="rounded-2xl bg-white/[0.03] p-4 border border-white/10">
              <Wallet className="h-10 w-10 text-zinc-400" />
            </div>
            <h3 className="mt-6 text-xl font-medium text-white">Connect your wallet</h3>
            <p className="mt-2 text-base text-zinc-400">Connect a wallet to deposit or withdraw from the shielded pool.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch">
          <DepositTab
            activeChain={activeChain}
            solanaWallet={solanaWallet}
            evmWalletClient={evmWalletClient}
            onDeposit={(note) => setNotes((prev) => [...prev, note])}
            onNoteUpdated={async () => {
              const n = await getNotes();
              setNotes(n);
            }}
          />
          <WithdrawTab
            activeChain={activeChain}
            solanaWallet={solanaWallet}
            evmWalletClient={evmWalletClient}
            notes={settledNotes}
            loadingNotes={loadingNotes}
            onWithdraw={() =>
              getNotes().then((n) => setNotes(n)).catch(() => {})
            }
          />
        </div>
      )}
    </motion.div>
  );
}

// ─── Deposit Tab ───
function DepositTab({
  activeChain,
  solanaWallet,
  evmWalletClient,
  onDeposit,
  onNoteUpdated,
}: {
  activeChain: "solana" | "base";
  solanaWallet: any;
  evmWalletClient: any;
  onDeposit: (note: StoredNote) => void;
  onNoteUpdated?: () => void;
}) {
  const { showToast } = useToast();
  const assets = getAssetsForChain(activeChain);
  const [selectedAsset, setSelectedAsset] = useState<string>(assets[0]?.symbol || "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [result, setResult] = useState<{ txHash?: string; commitment: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const asset = SUPPORTED_ASSETS.find((a) => a.symbol === selectedAsset);

  async function handleDeposit() {
    if (!asset || !amount) return;
    setBusy(true);
    setError(null);
    setStep("Initializing...");
    try {
      await initializePoseidon();
      const rawAmount = parseTokenAmount(amount, asset.decimals);

      setStep("Generating secret & commitment...");
      const secret = randomFieldElement();
      const nullifier = randomFieldElement();
      const assetId = computeAssetIdBigInt(asset.address || "0");
      const commitment = computeCommitment(secret, nullifier, rawAmount, assetId);

      setStep("Generating ZK proof...");
      const { proof } = await generateDepositProof({
        secret,
        nullifier,
        commitment,
        amount: rawAmount,
        assetId,
      });
      const proofBytes = formatProofForOnChain(proof);

      setStep("Sending transaction...");
      let txHash: string | undefined;
      if (activeChain === "solana") {
        if (!solanaWallet.publicKey || !solanaWallet.signTransaction) {
          throw new Error("Solana wallet not connected");
        }
        txHash = await solanaChainService.deposit(
          solanaWallet,
          proofBytes,
          commitment,
          rawAmount,
          bigintToBytes32(assetId),
          new PublicKey(asset.address!)
        );
      } else {
        if (!evmWalletClient) throw new Error("EVM wallet not connected");
        const tokenAddr = (asset.address || "0x0000000000000000000000000000000000000000") as `0x${string}`;
        txHash = await baseChainService.deposit(
          evmWalletClient,
          proofBytes,
          commitment,
          rawAmount,
          tokenAddr
        );
      }

      const note: StoredNote = {
        secret: secret.toString(),
        nullifier: nullifier.toString(),
        commitment: commitment.toString(),
        amount: rawAmount.toString(),
        asset: asset.symbol,
        assetId: assetId.toString(),
        chain: activeChain,
        timestamp: Date.now(),
        status: "pending",
        txHash,
      };
      await addNote(note);
      
      // Notify relayer about this deposit so it can track it
      trackDeposit(note.commitment, txHash).catch((err: any) => {
        console.warn("Failed to track deposit with relayer:", err?.message);
      });
      
      // Poll relayer for note status until settled
      const pollInterval = setInterval(async () => {
        try {
          const status = await checkNoteStatus(note.commitment);
          if (status.status === "settled" && status.leafIndex !== undefined) {
            await updateNote(note.commitment, { status: "settled", leafIndex: status.leafIndex });
            clearInterval(pollInterval);
            // Refresh notes list
            onNoteUpdated?.();
          }
        } catch {
          // Silently ignore polling errors
        }
      }, 10000);
      
      // Stop polling after 10 minutes
      setTimeout(() => clearInterval(pollInterval), 600000);
      
      onDeposit(note);
      setResult({ txHash, commitment: commitment.toString() });
      setAmount("");
      await maybeCreateReceipt({
        type: "payment_sent",
        from: { walletAddress: solanaWallet.publicKey?.toBase58() || evmWalletClient?.account?.address || "" },
        to: { walletAddress: "Shielded Pool" },
        amount: Number(amount),
        asset: asset.symbol,
        chain: activeChain,
        txHash: txHash || "",
      });
      showToast("Deposit submitted successfully", "success");
    } catch (err: any) {
      setError(err?.message || "Deposit failed");
      showToast(err?.message || "Deposit failed", "error");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  return (
    <>
      <Card className="glass-card border-white/10 h-full flex flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <ArrowDownLeft className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-lg text-white">Deposit</CardTitle>
              <CardDescription className="text-zinc-400">Shield tokens into the privacy pool</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200">Asset</label>
            <select
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {assets.map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.symbol} — {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200">Amount</label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500 py-5"
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-white/10 hover:bg-white/[0.03] px-4"
                onClick={() => setAmount("100")}
              >
                MAX
              </Button>
            </div>
          </div>

          <Button
            onClick={handleDeposit}
            disabled={busy || !amount || Number(amount) <= 0}
            className="w-full bg-emerald-600 hover:bg-emerald-700 h-11"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {step || "Processing..."}
              </>
            ) : (
              "Deposit"
            )}
          </Button>

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-400 mt-0.5" />
              <p className="text-sm text-zinc-300 leading-relaxed">
                Your secret and nullifier are generated in your browser. The protocol only stores the commitment on-chain.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!result} onOpenChange={() => setResult(null)}>
        <DialogContent className="border-white/10 bg-zinc-950 text-white">
          <DialogHeader className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <DialogTitle className="text-center text-xl">Deposit Submitted</DialogTitle>
            <DialogDescription className="text-center text-zinc-400">
              Your funds are being shielded. The deposit will be settled in the next batch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <p className="text-xs text-zinc-500">Commitment</p>
              <p className="font-mono text-sm text-zinc-200">{truncate(result?.commitment || "", 16)}</p>
            </div>
            {result?.txHash && (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs text-zinc-500">Transaction</p>
                <a
                  href={`${CHAINS[activeChain].blockExplorerUrl}/tx/${result.txHash}${activeChain === "solana" ? "" : ""}`}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-sm text-emerald-400 hover:underline"
                >
                  {truncate(result.txHash, 20)}
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Withdraw Tab ───
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function WithdrawTab({
  activeChain,
  solanaWallet,
  evmWalletClient,
  notes,
  loadingNotes,
  onWithdraw,
}: {
  activeChain: "solana" | "base";
  solanaWallet: any;
  evmWalletClient: any;
  notes: StoredNote[];
  loadingNotes: boolean;
  onWithdraw: () => void;
}) {
  const { showToast } = useToast();
  const [selectedNote, setSelectedNote] = useState<StoredNote | null>(null);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [result, setResult] = useState<{ txHash?: string; relayer?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [relayerQuote, setRelayerQuote] = useState<RelayerQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    if (!selectedNote) {
      setRelayerQuote(null);
      setShowFallback(false);
      setError(null);
      return;
    }
    let mounted = true;
    setQuoteLoading(true);
    getRelayerQuote(selectedNote.amount)
      .then((q) => {
        if (mounted) setRelayerQuote(q);
      })
      .catch(() => {
        if (mounted) setRelayerQuote(null);
      })
      .finally(() => {
        if (mounted) setQuoteLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedNote]);

  async function buildWithdrawalProof() {
    if (!selectedNote) throw new Error("No note selected");
    if (selectedNote.leafIndex === undefined) {
      throw new Error("Note has not been settled yet. leafIndex is missing.");
    }
    await initializePoseidon();
    const secret = BigInt(selectedNote.secret);
    const nullifier = BigInt(selectedNote.nullifier);
    const amount = BigInt(selectedNote.amount);
    const assetId = BigInt(selectedNote.assetId);
    const nullifierHash = computeNullifierHash(nullifier, secret, selectedNote.leafIndex);

    setStep("Fetching Merkle proof...");
    let pathElements: bigint[];
    let pathIndices: number[];
    let merkleRoot: bigint;
    
    const proofRes = await getMerkleProof(selectedNote.leafIndex);
    if (!proofRes.success) {
      throw new Error(proofRes.error || "Failed to fetch Merkle proof from relayer");
    }
    merkleRoot = BigInt(proofRes.merkleRoot);
    pathElements = proofRes.pathElements.map((p) => BigInt(p));
    pathIndices = proofRes.pathIndices;

    const recipientScalar = activeChain === "solana"
      ? pubkeyToScalar(recipient)
      : BigInt(recipient);
    
    // Fetch relayer quote for gasless withdrawal
    setStep("Fetching relayer quote...");
    const quote = await getRelayerQuote(selectedNote.amount);
    const relayerFee = BigInt(quote.fee);
    const relayerAddress = activeChain === "solana" ? quote.relayer.solana : quote.relayer.base;
    if (!relayerAddress) {
      throw new Error("Relayer address not available for this chain");
    }
    const relayerScalar = activeChain === "solana"
      ? pubkeyToScalar(relayerAddress)
      : BigInt(relayerAddress);

    setStep("Generating ZK proof...");
    const { proof } = await generateWithdrawProof({
      secret,
      nullifier,
      amount,
      assetId,
      leafIndex: BigInt(selectedNote.leafIndex),
      merkleRoot,
      pathElements,
      pathIndices,
      recipient: recipientScalar,
      relayer: relayerScalar,
      relayerFee,
    });
    const proofBytes = formatProofForOnChain(proof);

    return { secret, nullifier, amount, assetId, nullifierHash, merkleRoot, proofBytes };
  }

  async function submitDirectWithdrawal(
    proofBytes: Uint8Array,
    nullifierHash: bigint,
    merkleRoot: bigint,
    amount: bigint,
    assetId: bigint
  ) {
    let txHash: string | undefined;
    if (activeChain === "solana") {
      if (!solanaWallet.publicKey) throw new Error("Solana wallet not connected");
      const asset = SUPPORTED_ASSETS.find((a) => a.symbol === selectedNote!.asset);
      txHash = await solanaChainService.withdraw(
        solanaWallet,
        proofBytes,
        nullifierHash,
        merkleRoot,
        new PublicKey(recipient),
        amount,
        bigintToBytes32(assetId),
        new PublicKey(asset?.address || "So11111111111111111111111111111111111111112"),
        0n
      );
    } else {
      if (!evmWalletClient) throw new Error("EVM wallet not connected");
      const asset = SUPPORTED_ASSETS.find((a) => a.symbol === selectedNote!.asset);
      const tokenAddr = (asset?.address || "0x0000000000000000000000000000000000000000") as `0x${string}`;
      txHash = await baseChainService.withdraw(
        evmWalletClient,
        proofBytes,
        nullifierHash,
        merkleRoot,
        recipient as `0x${string}`,
        tokenAddr,
        amount,
        0n,
        "0x0000000000000000000000000000000000000000"
      );
    }
    return txHash;
  }

  async function finalizeWithdrawal(txHash: string | undefined, viaRelayer: boolean) {
    await markSpent(selectedNote!.nullifier, txHash);
    onWithdraw();
    setResult({ txHash, relayer: viaRelayer });
    setSelectedNote(null);
    setRecipient("");
    setShowFallback(false);
    await maybeCreateReceipt({
      type: "payment_received",
      from: { walletAddress: "Shielded Pool" },
      to: { walletAddress: recipient },
      amount: Number(selectedNote!.amount) / 1e9,
      asset: selectedNote!.asset,
      chain: activeChain,
      txHash: txHash || "",
    });
    showToast("Withdrawal submitted successfully", "success");
  }

  async function handleWithdraw() {
    if (!selectedNote || !recipient) return;
    setBusy(true);
    setError(null);
    setShowFallback(false);
    try {
      const { nullifierHash, merkleRoot, amount, assetId, proofBytes } = await buildWithdrawalProof();

      setStep("Submitting to relayer...");
      const asset = SUPPORTED_ASSETS.find((a) => a.symbol === selectedNote.asset);
      const res = await submitRelayedWithdrawal({
        chain: activeChain,
        proofData: bytesToHex(proofBytes),
        merkleRoot: merkleRoot.toString(16).padStart(64, "0"),
        nullifierHash: nullifierHash.toString(16).padStart(64, "0"),
        recipient,
        amount: selectedNote.amount,
        assetId: assetId.toString(16).padStart(64, "0"),
        mint: asset?.address || (activeChain === "solana" ? "So11111111111111111111111111111111111111112" : "0x0000000000000000000000000000000000000000"),
      });

      if (res.success && res.signature) {
        await finalizeWithdrawal(res.signature, true);
      } else {
        throw new Error(res.error || "Relayer rejected withdrawal");
      }
    } catch (err: any) {
      setError(err?.message || "Relayer failed. Try direct withdrawal?");
      setShowFallback(true);
      showToast(err?.message || "Relayer failed", "error");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  async function handleDirectWithdraw() {
    if (!selectedNote || !recipient) return;
    setBusy(true);
    setError(null);
    setShowFallback(false);
    try {
      const { nullifierHash, merkleRoot, amount, assetId, proofBytes } = await buildWithdrawalProof();
      setStep("Sending transaction...");
      const txHash = await submitDirectWithdrawal(proofBytes, nullifierHash, merkleRoot, amount, assetId);
      await finalizeWithdrawal(txHash, false);
    } catch (err: any) {
      setError(err?.message || "Withdrawal failed");
      showToast(err?.message || "Withdrawal failed", "error");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (selectedNote) {
    const asset = SUPPORTED_ASSETS.find((a) => a.symbol === selectedNote.asset);
    return (
      <Card className="glass-card border-white/10 h-full flex flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
              <ArrowUpRight className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-lg text-white">Withdraw {selectedNote.asset}</CardTitle>
              <CardDescription className="text-zinc-400">Send privately to any address</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-5">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm text-zinc-400">Amount</p>
            <p className="text-2xl font-semibold text-white">
              {formatTokenAmount(BigInt(selectedNote.amount), asset?.decimals || 9)} {selectedNote.asset}
            </p>
          </div>

          {quoteLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching relayer quote...
            </div>
          ) : relayerQuote ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">Relayer fee</span>
                <span className="font-medium text-white">{relayerQuote.feeBps / 100}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">You receive</span>
                <span className="font-medium text-white">{formatTokenAmount(BigInt(relayerQuote.netAmount), asset?.decimals || 9)} {selectedNote.asset}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">Gas</span>
                <span className="font-medium text-white">Paid by relayer</span>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200">
              Recipient {activeChain === "solana" ? "Address" : "Address"}
            </label>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={activeChain === "solana" ? "Solana address..." : "0x..."}
              className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500 py-5"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {showFallback && (
            <Button variant="outline" className="w-full border-white/10 hover:bg-white/[0.03] h-11" onClick={handleDirectWithdraw} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Try direct withdrawal
            </Button>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 border-white/10 hover:bg-white/[0.03] h-11" onClick={() => setSelectedNote(null)}>
              Back
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-11"
              disabled={busy || !recipient}
              onClick={handleWithdraw}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {step || "Processing..."}
                </>
              ) : (
                "Withdraw"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card border-white/10 h-full flex flex-col">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
            <ArrowUpRight className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <CardTitle className="text-lg text-white">Withdraw</CardTitle>
            <CardDescription className="text-zinc-400">Withdraw from the shielded pool</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4">
        {loadingNotes ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="text-base text-zinc-300 font-medium">No settled notes</p>
            <p className="text-sm text-zinc-500 mt-1">
              No settled notes available for withdrawal on {activeChain}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => {
              const asset = SUPPORTED_ASSETS.find((a) => a.symbol === note.asset);
              return (
                <button
                  key={note.commitment}
                  onClick={() => setSelectedNote(note)}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05] hover:border-white/15"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-medium text-white">
                        {formatTokenAmount(BigInt(note.amount), asset?.decimals || 9)} {note.asset}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {new Date(note.timestamp).toLocaleDateString()} · Leaf #{note.leafIndex ?? "?"}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                      Settled
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function pubkeyToScalar(pubkey: string): bigint {
  // Solana addresses are base58; hash them to fit in BN254 field
  const bytes = keccak_256(new TextEncoder().encode(pubkey));
  const fieldBytes = bytes.slice(0, 31);
  return BigInt("0x" + Buffer.from(fieldBytes).toString("hex"));
}
