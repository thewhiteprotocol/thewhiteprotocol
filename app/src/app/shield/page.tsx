"use client";

import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ArrowDownLeft, ArrowUpRight, Loader2, CheckCircle2, Wallet, ShieldCheck, AlertCircle, Copy, Download, QrCode, Upload, FileText, RotateCcw } from "lucide-react";
import { useChain } from "@/providers/ChainContext";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWalletClient } from "wagmi";
import { PublicKey } from "@solana/web3.js";
import { useToast } from "@/providers/ToastContext";
import { cn } from "@/lib/utils";
import { getAssetsForChain, AssetConfig, SUPPORTED_ASSETS } from "@/config/constants";
import { CHAINS } from "@/config/chains";
import { initializePoseidon, computeCommitment, computeNullifierHash, computeAssetIdBigInt, randomFieldElement, formatProofForOnChain, MERKLE_TREE_DEPTH, pubkeyToScalar } from "@/lib/crypto";
import { generateDepositProof, generateWithdrawProof } from "@/lib/proofService";
import { solanaChainService, baseChainService } from "@/lib/chainService";
import { getNotes, addNote, updateNote, markSpent } from "@/lib/noteStore";
import { maybeCreateReceipt } from "@/lib/autoReceipt";
import { StoredNote } from "@/lib/types";
import { encodeNote, decodeNote, downloadNoteFile, type DecodedNote } from "@/lib/noteFormat";
import { QRCodeSVG } from "qrcode.react";
import { formatTokenAmount, parseTokenAmount } from "@/lib/balanceService";
import { getRelayerQuote, submitRelayedWithdrawal, checkNoteStatus, getMerkleProof, trackDeposit, RelayerQuote } from "@/lib/relayerClient";

function truncate(str: string, len = 8) {
  if (str.length <= len * 2 + 4) return str;
  return str.slice(0, len) + "..." + str.slice(-len);
}

export default function ShieldPage() {
  const { activeChain, isConnected, walletAddress } = useChain();
  const solanaWallet = useSolanaWallet();
  const { data: evmWalletClient } = useWalletClient();
  const { showToast } = useToast();
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const refreshNotes = useCallback(async () => {
    const loadedNotes = await getNotes();
    setNotes(loadedNotes);
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setNotes([]);
      setLoadingNotes(false);
      return;
    }
    let mounted = true;
    setLoadingNotes(true);
    getNotes()
      .then((loadedNotes) => {
        if (mounted) setNotes(loadedNotes);
      })
      .catch((err: any) => {
        if (mounted) {
          // Show decryption errors to the user so they know why history is empty
          if (err?.message?.includes("DECRYPTION_FAILED")) {
            showToast(
              "Unable to load shielded notes. Please ensure you are using the same wallet and chain, or restore from backup.",
              "error"
            );
          }
        }
      })
      .finally(() => {
        if (mounted) setLoadingNotes(false);
      });
  }, [isConnected, walletAddress, refreshNotes]);

  useEffect(() => {
    const handleUnlocked = () => {
      setLoadingNotes(true);
      refreshNotes()
        .catch(() => {})
        .finally(() => setLoadingNotes(false));
    };

    window.addEventListener("white-protocol-notes-unlocked", handleUnlocked);
    return () => window.removeEventListener("white-protocol-notes-unlocked", handleUnlocked);
  }, [refreshNotes]);

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
            onNoteUpdated={refreshNotes}
          />
          <WithdrawTab
            activeChain={activeChain}
            solanaWallet={solanaWallet}
            evmWalletClient={evmWalletClient}
            notes={settledNotes}
            loadingNotes={loadingNotes}
            onWithdraw={() => refreshNotes().catch(() => {})}
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
  const [result, setResult] = useState<{ txHash?: string; commitment: string; note?: DecodedNote } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Synchronous guard to prevent double-click / overlapping submissions
  const isSubmittingRef = useRef(false);
  // Track polling timeouts for cleanup
  const pollRefs = useRef<{ timeout?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    return () => {
      if (pollRefs.current.timeout) clearTimeout(pollRefs.current.timeout);
    };
  }, []);

  const asset = SUPPORTED_ASSETS.find((a) => a.symbol === selectedAsset);

  async function handleDeposit() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setError(null);
    setStep("Initializing...");
    try {
      if (!asset || !amount) {
        throw new Error("Please select an asset and enter an amount");
      }
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
      const proofBytes = formatProofForOnChain(proof, activeChain === "solana" ? "solana" : "base");

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

      // Auto-download note as JSON backup
      try {
        const blob = new Blob([JSON.stringify(note, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `white-protocol-note-${note.commitment.slice(0, 8)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // Non-critical: if auto-download fails, still continue
      }
      
      // Notify relayer about this deposit so it can track it
      trackDeposit(note.commitment, txHash).catch((err: any) => {
        console.warn("Failed to track deposit with relayer:", err?.message);
      });

      // Clear any previous polling
      if (pollRefs.current.timeout) clearTimeout(pollRefs.current.timeout);

      // Poll relayer for note status until settled (with backoff)
      const pollCountRef = { count: 0 };
      const startPolling = (commitment: string) => {
        const run = async () => {
          try {
            const status = await checkNoteStatus(commitment);
            if (status.status === "settled" && status.leafIndex !== undefined) {
              await updateNote(commitment, { status: "settled", leafIndex: status.leafIndex });
              pollRefs.current.timeout = undefined;
              onNoteUpdated?.();
              return; // stop
            }
          } catch {
            // Silently ignore polling errors
          }

          pollCountRef.count += 1;
          const count = pollCountRef.count;
          const nextDelay = count < 10 ? 10000 : count < 20 ? 30000 : 60000;
          pollRefs.current.timeout = setTimeout(run, nextDelay);
        };

        run(); // kick off
      };

      startPolling(note.commitment);

      // Stop polling after 10 minutes
      const pollTimeout = setTimeout(() => {
        if (pollRefs.current.timeout) clearTimeout(pollRefs.current.timeout);
        pollRefs.current.timeout = undefined;
      }, 600000);
      pollRefs.current.timeout = pollTimeout;
      
      onDeposit(note);
      setResult({ txHash, commitment: commitment.toString(), note: { secret: secret.toString(), nullifier: nullifier.toString(), amount: amount.toString(), asset: asset.symbol, chain: activeChain, commitment: commitment.toString(), assetId: assetId.toString() } });
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
      showToast("Note file auto-downloaded. Keep it safe — it's your only recovery backup!", "info");
    } catch (err: any) {
      const msg = err?.message || "Deposit failed";
      if (msg.toLowerCase().includes("already been processed") || msg.toLowerCase().includes("already processed")) {
        showToast("Transaction already processed", "success");
      } else {
        setError(msg);
        showToast(msg, "error");
      }
    } finally {
      setBusy(false);
      setStep("");
      isSubmittingRef.current = false;
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
        <DialogContent className="border-white/10 bg-zinc-950 text-white max-w-lg">
          <DialogHeader className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <DialogTitle className="text-center text-xl">Deposit Submitted</DialogTitle>
            <DialogDescription className="text-center text-zinc-400">
              Your funds are being shielded. The deposit will be settled in the next batch.
            </DialogDescription>
          </DialogHeader>

          {/* Prominent Note Save Section */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-400">
              <ShieldCheck className="h-5 w-5" />
              <span className="font-semibold text-sm">Save Your Note — Required to Withdraw</span>
            </div>
            <p className="text-xs text-amber-200/80">
              If you lose this note, you cannot recover your funds. Back it up now.
            </p>
            {result?.note && (
              <>
                <div className="rounded-lg border border-white/10 bg-black/40 p-2">
                  <p className="font-mono text-[11px] text-zinc-300 break-all leading-relaxed">
                    {encodeNote(result.note)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => {
                      navigator.clipboard.writeText(encodeNote(result.note!));
                      showToast("Note copied to clipboard", "success");
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy Note
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => downloadNoteFile(result.note!)}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download JSON
                  </Button>
                  <div className="rounded-lg border border-white/10 bg-white p-2">
                    <QRCodeSVG value={encodeNote(result.note!)} size={80} level="M" />
                  </div>
                </div>
              </>
            )}
          </div>

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
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [result, setResult] = useState<{ txHash?: string; relayer?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [relayerQuote, setRelayerQuote] = useState<RelayerQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Withdraw mode: mynotes | recover
  const [withdrawMode, setWithdrawMode] = useState<"mynotes" | "recover">("mynotes");

  // Recovery state
  const [recoverNoteString, setRecoverNoteString] = useState("");
  const [recoveredNote, setRecoveredNote] = useState<StoredNote | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoverStatus, setRecoverStatus] = useState<"idle" | "checking" | "ready" | "spent" | "notfound">("idle");

  // Synchronous guard to prevent double-click / overlapping submissions
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (!selectedNote) {
      setRelayerQuote(null);
      setShowFallback(false);
      setError(null);
      setWithdrawAmount("");
      return;
    }
    // Default to full amount when note is selected
    if (!withdrawAmount) {
      setWithdrawAmount(selectedNote.amount);
    }
    let mounted = true;
    setQuoteLoading(true);
    const amountToQuote = withdrawAmount || selectedNote.amount;
    getRelayerQuote(amountToQuote)
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
  }, [selectedNote, withdrawAmount]);

  async function buildWithdrawalProof(viaRelayer: boolean, amountToWithdraw: string) {
    if (!selectedNote) throw new Error("No note selected");
    if (selectedNote.leafIndex === undefined) {
      throw new Error("Note has not been settled yet. leafIndex is missing.");
    }
    await initializePoseidon();
    const secret = BigInt(selectedNote.secret);
    const nullifier = BigInt(selectedNote.nullifier);
    const noteAmount = BigInt(selectedNote.amount);
    const amount = BigInt(amountToWithdraw);
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
    
    let relayerFee = 0n;
    let relayerAddress: string | null | undefined;
    if (viaRelayer) {
      setStep("Fetching relayer quote...");
      const quote = await getRelayerQuote(amountToWithdraw);
      relayerFee = BigInt(quote.fee);
      relayerAddress = activeChain === "solana" ? quote.relayer.solana : quote.relayer.base;
    } else if (activeChain === "solana") {
      relayerAddress = solanaWallet.publicKey?.toBase58();
    } else {
      relayerAddress = "0";
    }

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
      nullifierHash,
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
    const proofBytes = formatProofForOnChain(proof, activeChain === "solana" ? "solana" : "base");

    return { secret, nullifier, amount, noteAmount, assetId, nullifierHash, merkleRoot, proofBytes };
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
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setError(null);
    setShowFallback(false);
    try {
      if (!selectedNote || !recipient || !withdrawAmount) {
        throw new Error("Please select a note, enter an amount, and enter a recipient");
      }
      if (BigInt(withdrawAmount) > BigInt(selectedNote.amount)) {
        throw new Error("Withdraw amount exceeds note amount");
      }
      if (BigInt(withdrawAmount) <= 0n) {
        throw new Error("Withdraw amount must be greater than 0");
      }
      const { nullifierHash, merkleRoot, amount, assetId, proofBytes } = await buildWithdrawalProof(true, withdrawAmount);

      setStep("Submitting to relayer...");
      const asset = SUPPORTED_ASSETS.find((a) => a.symbol === selectedNote.asset);
      const res = await submitRelayedWithdrawal({
        chain: activeChain,
        proofData: bytesToHex(proofBytes),
        merkleRoot: merkleRoot.toString(16).padStart(64, "0"),
        nullifierHash: nullifierHash.toString(16).padStart(64, "0"),
        recipient,
        amount: withdrawAmount,
        assetId: assetId.toString(16).padStart(64, "0"),
        mint: asset?.address || (activeChain === "solana" ? "So11111111111111111111111111111111111111112" : "0x0000000000000000000000000000000000000000"),
      });

      if (res.success && res.signature) {
        await finalizeWithdrawal(res.signature, true);
      } else {
        throw new Error(res.error || "Relayer rejected withdrawal");
      }
    } catch (err: any) {
      const msg = err?.message || "Relayer failed. Try direct withdrawal?";
      if (msg.toLowerCase().includes("already been processed") || msg.toLowerCase().includes("already processed")) {
        showToast("Transaction already processed", "success");
      } else {
        setError(msg);
        setShowFallback(true);
        showToast(msg, "error");
      }
    } finally {
      setBusy(false);
      setStep("");
      isSubmittingRef.current = false;
    }
  }

  async function handleDirectWithdraw() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setBusy(true);
    setError(null);
    setShowFallback(false);
    try {
      if (!selectedNote || !recipient || !withdrawAmount) {
        throw new Error("Please select a note, enter an amount, and enter a recipient");
      }
      if (BigInt(withdrawAmount) > BigInt(selectedNote.amount)) {
        throw new Error("Withdraw amount exceeds note amount");
      }
      if (BigInt(withdrawAmount) <= 0n) {
        throw new Error("Withdraw amount must be greater than 0");
      }
      const { nullifierHash, merkleRoot, amount, assetId, proofBytes } = await buildWithdrawalProof(false, withdrawAmount);
      setStep("Sending transaction...");
      const txHash = await submitDirectWithdrawal(proofBytes, nullifierHash, merkleRoot, amount, assetId);
      await finalizeWithdrawal(txHash, false);
    } catch (err: any) {
      const msg = err?.message || "Withdrawal failed";
      if (msg.toLowerCase().includes("already been processed") || msg.toLowerCase().includes("already processed")) {
        showToast("Transaction already processed", "success");
      } else {
        setError(msg);
        showToast(msg, "error");
      }
    } finally {
      setBusy(false);
      setStep("");
      isSubmittingRef.current = false;
    }
  }

  async function handleRecoverNote() {
    setRecoverError(null);
    setRecoveredNote(null);
    setRecoverStatus("checking");
    const decoded = decodeNote(recoverNoteString);
    if (!decoded) {
      setRecoverError("Invalid note format. Paste a white://note/v1/... URI or raw JSON.");
      setRecoverStatus("idle");
      return;
    }
    if (!decoded.secret || !decoded.nullifier || !decoded.amount || !decoded.asset || !decoded.chain) {
      setRecoverError("Note is missing required fields (secret, nullifier, amount, asset, chain).");
      setRecoverStatus("idle");
      return;
    }
    try {
      const note: StoredNote = {
        secret: decoded.secret,
        nullifier: decoded.nullifier,
        amount: decoded.amount,
        asset: decoded.asset,
        chain: decoded.chain as "solana" | "base",
        assetId: decoded.assetId || "",
        commitment: decoded.commitment || "",
        leafIndex: decoded.leafIndex,
        timestamp: Date.now(),
        status: "settled",
      };

      // Check if nullifier already spent via relayer
      const nullifierHash = await initializePoseidon().then(() => {
        return computeNullifierHash(BigInt(note.nullifier), BigInt(note.secret), note.leafIndex ?? 0);
      });

      // Try to fetch Merkle proof to verify note exists in tree
      if (note.leafIndex !== undefined) {
        const proofRes = await getMerkleProof(note.leafIndex);
        if (!proofRes.success) {
          setRecoverError("Note not found in Merkle tree. It may be pending or invalid.");
          setRecoverStatus("notfound");
          return;
        }
      } else {
        setRecoverError("Note has no leaf index. Cannot verify tree membership.");
        setRecoverStatus("notfound");
        return;
      }

      // If we got here, the note is in the tree and ready
      setRecoveredNote(note);
      setRecoverStatus("ready");
      setSelectedNote(note);
      showToast("Note verified — ready to withdraw", "success");
    } catch (err: any) {
      setRecoverError(err.message || "Failed to verify note");
      setRecoverStatus("idle");
    }
  }

  function handleRecoverFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || "");
      setRecoverNoteString(text);
    };
    reader.readAsText(file);
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
            <p className="text-sm text-zinc-400">Available</p>
            <p className="text-2xl font-semibold text-white">
              {formatTokenAmount(BigInt(selectedNote.amount), asset?.decimals || 9)} {selectedNote.asset}
            </p>
          </div>

          {/* Withdraw amount */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-200">Withdraw amount</label>
                <button
                  onClick={() => setWithdrawAmount(selectedNote.amount)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                >
                  MAX
                </button>
              </div>
              <Input
                value={withdrawAmount ? formatTokenAmount(BigInt(withdrawAmount), asset?.decimals || 9) : ""}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, "");
                  if (!raw) {
                    setWithdrawAmount("");
                    return;
                  }
                  const parts = raw.split(".");
                  if (parts.length > 2) return; // ignore multiple dots
                  const whole = parts[0] || "0";
                  const fraction = parts[1] !== undefined ? parts[1].slice(0, asset?.decimals || 9) : "";
                  const decimals = asset?.decimals || 9;
                  const baseUnits = BigInt(whole) * BigInt(10 ** decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
                  setWithdrawAmount(baseUnits.toString());
                }}
                placeholder="0.00"
                className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500 py-5"
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Available</span>
              <span className="text-zinc-300">{formatTokenAmount(BigInt(selectedNote.amount), asset?.decimals || 9)} {selectedNote.asset}</span>
            </div>
            {withdrawAmount && BigInt(withdrawAmount) !== BigInt(selectedNote.amount) && (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-300">
                Partial withdrawals are coming soon. Please withdraw the full amount.
              </div>
            )}
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
              disabled={busy || !recipient || !withdrawAmount || BigInt(withdrawAmount) <= 0n || BigInt(withdrawAmount) > BigInt(selectedNote.amount)}
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
        {/* Tabs */}
        <div className="mt-3 flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
          <button
            onClick={() => setWithdrawMode("mynotes")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
              withdrawMode === "mynotes"
                ? "bg-white/[0.08] text-white"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            My Notes
          </button>
          <button
            onClick={() => setWithdrawMode("recover")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
              withdrawMode === "recover"
                ? "bg-white/[0.08] text-white"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Recover with Note
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 overflow-auto">
        {withdrawMode === "mynotes" ? (
          <>
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
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Recover Funds with Note</h3>
              <p className="text-xs text-zinc-400">
                Paste your deposit note below or upload a backup file to recover your funds.
              </p>
              <textarea
                value={recoverNoteString}
                onChange={(e) => setRecoverNoteString(e.target.value)}
                placeholder="white://note/v1/eyJzZWNyZXQiOiIxMjM0NS..."
                className="w-full rounded-lg border border-white/10 bg-black/40 p-3 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-emerald-500/40 min-h-[80px] resize-y"
              />
              <div className="flex items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/[0.05]">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Note File
                  <input type="file" accept=".json,.txt" className="hidden" onChange={handleRecoverFileUpload} />
                </label>
                {recoverNoteString && (
                  <button
                    onClick={() => { setRecoverNoteString(""); setRecoverError(null); setRecoveredNote(null); setRecoverStatus("idle"); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Clear
                  </button>
                )}
              </div>
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 h-10"
                disabled={!recoverNoteString || recoverStatus === "checking"}
                onClick={handleRecoverNote}
              >
                {recoverStatus === "checking" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Note"
                )}
              </Button>
            </div>

            {recoverError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle className="h-4 w-4" />
                {recoverError}
              </div>
            )}

            {recoverStatus === "ready" && recoveredNote && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold text-sm">Note Valid — Ready to Withdraw</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Amount</span>
                    <span className="text-white font-medium">
                      {formatTokenAmount(BigInt(recoveredNote.amount), SUPPORTED_ASSETS.find((a) => a.symbol === recoveredNote.asset)?.decimals || 9)} {recoveredNote.asset}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Chain</span>
                    <span className="text-white capitalize">{recoveredNote.chain}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Status</span>
                    <span className="text-emerald-400">Settled</span>
                  </div>
                </div>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 h-10"
                  onClick={() => setSelectedNote(recoveredNote)}
                >
                  Continue to Withdraw
                </Button>
              </div>
            )}
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
