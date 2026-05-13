"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Share2, RefreshCw, QrCode, Loader2, Wallet, Eye } from "lucide-react";
import { useChain } from "@/providers/ChainContext";
import { getAssetsForChain } from "@/config/constants";
import { createPaymentRequest, PaymentLinkResult } from "@/lib/paymentLink";
import { formatTokenAmount } from "@/lib/balanceService";
import { useToast } from "@/providers/ToastContext";
import { getNotes } from "@/lib/noteStore";
import { maybeCreateReceipt } from "@/lib/autoReceipt";
import { StoredNote } from "@/lib/types";
import { loadMetaAddress, type StoredStealthPayment } from "@/lib/stealth";

export default function ReceivePage() {
  const { activeChain, isConnected } = useChain();
  const assets = getAssetsForChain(activeChain);
  const [asset, setAsset] = useState<string>(assets[0]?.symbol || "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PaymentLinkResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [noteStatus, setNoteStatus] = useState<StoredNote["status"] | null>(null);
  const [copied, setCopied] = useState(false);
  const { showToast } = useToast();

  async function generate() {
    if (!asset) return;
    setBusy(true);
    try {
      const res = await createPaymentRequest(amount || undefined, asset, activeChain);
      setResult(res);
      setNoteStatus("awaiting_payment");
      showToast("Payment request generated", "success");
    } catch (err: any) {
      showToast(err?.message || "Failed to generate payment request", "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.link);
    setCopied(true);
    showToast("Link copied to clipboard", "success");
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareLink() {
    if (!result) return;
    if (navigator.share) {
      await navigator.share({
        title: "White Protocol Payment Request",
        text: `Requesting ${amount || "a"} ${asset} payment`,
        url: result.link,
      });
    } else {
      await copyLink();
    }
  }

  async function checkStatus() {
    if (!result) return;
    setChecking(true);
    try {
      const notes = await getNotes();
      const note = notes.find((n) => n.commitment === result.note.commitment);
      if (note) {
        setNoteStatus(note.status);
        if (note.status === "settled" || note.status === "spent") {
          await maybeCreateReceipt({
            type: "payment_received",
            from: { walletAddress: "Payment Link Sender" },
            to: { walletAddress: note.recipient || "You" },
            amount: Number(note.amount) / 1e9,
            asset: note.asset,
            chain: note.chain,
            txHash: note.txHash || "",
          });
          showToast("Receipt saved automatically", "success");
        }
      }
    } finally {
      setChecking(false);
    }
  }

  if (!isConnected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mx-auto max-w-2xl space-y-6"
      >
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Receive Privately</h1>
          <p className="text-zinc-400">Generate a private payment request or stealth address.</p>
        </div>
        <Card className="glass-card border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Wallet className="h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 text-lg font-medium">Connect your wallet</h3>
            <p className="mt-1 text-sm text-zinc-400">Connect a wallet to generate payment requests.</p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Receive Privately</h1>
        <p className="text-zinc-400">Generate a private payment request or stealth address.</p>
      </div>

      <StealthAddressCard />

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Payment Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Asset</label>
            <select
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {assets.map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.symbol} — {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Amount (optional)</label>
            <Input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500"
            />
          </div>

          {!result ? (
            <Button
              onClick={generate}
              disabled={busy || !asset}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <QrCode className="mr-2 h-4 w-4" />
                  Generate Payment Request
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="flex justify-center rounded-xl border border-white/10 bg-white p-4">
                <QRCodeSVG value={result.qrData} size={200} level="M" />
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <p className="text-xs text-zinc-500">Payment Link</p>
                <p className="break-all font-mono text-xs text-zinc-300">{result.link}</p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-white/10 hover:bg-white/[0.03]" onClick={copyLink}>
                  <Copy className="mr-2 h-4 w-4" />
                  {copied ? "Copied!" : "Copy Link"}
                </Button>
                <Button variant="outline" className="flex-1 border-white/10 hover:bg-white/[0.03]" onClick={shareLink}>
                  <Share2 className="mr-2 h-4 w-4" />
                  Share
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div>
                  <p className="text-xs text-zinc-500">Status</p>
                  <p className="text-sm font-medium capitalize">{noteStatus?.replace(/_/g, " ") || "Awaiting payment"}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={checkStatus} disabled={checking}>
                  <RefreshCw className={`mr-1 h-3 w-3 ${checking ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              <Button variant="outline" className="w-full border-white/10 hover:bg-white/[0.03]" onClick={() => { setResult(null); setNoteStatus(null); }}>
                Generate Another
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function StealthAddressCard() {
  const [metaAddress, setMetaAddress] = useState<string | null>(null);
  const [payments, setPayments] = useState<StoredStealthPayment[]>([]);
  const { showToast } = useToast();

  useEffect(() => {
    const saved = loadMetaAddress();
    if (saved) {
      import("@thewhiteprotocol/core").then(({ serializeMetaAddress }) => {
        setMetaAddress(serializeMetaAddress(saved));
      }).catch(() => {
        // ignore
      });
    }

    // Load stored payments
    try {
      const raw = localStorage.getItem("white_protocol_stealth_payments_v1");
      if (raw) {
        const parsed = JSON.parse(raw, (key, value) => {
          if (key === "amount" || key === "blockHeight") {
            return typeof value === "string" ? BigInt(value) : value;
          }
          return value;
        });
        setPayments(parsed || []);
      }
    } catch {
      // ignore
    }
  }, []);

  function copyMetaAddress() {
    if (metaAddress) {
      navigator.clipboard.writeText(metaAddress);
      showToast("Meta-address copied", "success");
    }
  }

  if (!metaAddress) return null;

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Eye className="h-5 w-5 text-emerald-400" />
          Stealth Address
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-zinc-500">Your meta-address — share this to receive private payments.</p>
          <p className="break-all font-mono text-xs text-zinc-300">{metaAddress}</p>
        </div>
        <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]" onClick={copyMetaAddress}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Meta-Address
        </Button>

        {payments.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Detected Stealth Payments</p>
            {payments.filter((p: StoredStealthPayment) => !p.withdrawn).map((payment: StoredStealthPayment) => (
              <div key={payment.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div>
                  <p className="text-xs text-zinc-500">Amount</p>
                  <p className="text-sm font-medium">{payment.amount.toString()}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Chain</p>
                  <p className="text-sm font-medium capitalize">{payment.chain}</p>
                </div>
                <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]" onClick={() => {
                  showToast(`Withdrawal for ${payment.amount.toString()} ${payment.chain} — derive stealth key in Settings`, "info");
                }}>
                  Withdraw
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
