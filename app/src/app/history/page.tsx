"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Search, Wallet, Loader2 } from "lucide-react";
import { getNotes } from "@/lib/noteStore";
import { StoredNote } from "@/lib/types";
import { useChain } from "@/providers/ChainContext";
import { CHAINS } from "@/config/chains";
import { SUPPORTED_ASSETS } from "@/config/constants";
import { formatTokenAmount } from "@/lib/balanceService";

function truncate(str: string, len = 8) {
  if (str.length <= len * 2 + 4) return str;
  return str.slice(0, len) + "..." + str.slice(-len);
}

export default function HistoryPage() {
  const { isConnected } = useChain();
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterChain, setFilterChain] = useState<"all" | "solana" | "base">("all");
  const [filterAsset, setFilterAsset] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  useEffect(() => {
    if (!isConnected) {
      setLoading(false);
      return;
    }
    getNotes()
      .then((n) => setNotes(n))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isConnected]);

  const filtered = useMemo(() => {
    return notes
      .filter((n) => (filterChain === "all" ? true : n.chain === filterChain))
      .filter((n) => (filterAsset === "all" ? true : n.asset === filterAsset))
      .filter((n) => (filterStatus === "all" ? true : n.status === filterStatus))
      .filter(
        (n) =>
          !search ||
          n.commitment.toLowerCase().includes(search.toLowerCase()) ||
          (n.txHash && n.txHash.toLowerCase().includes(search.toLowerCase())) ||
          n.asset.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [notes, filterChain, filterAsset, filterStatus, search]);

  function exportCSV() {
    const headers = ["Date", "Type", "Asset", "Chain", "Amount", "Status", "Commitment", "TxHash"];
    const rows = filtered.map((n) => [
      new Date(n.timestamp).toISOString(),
      n.status,
      n.asset,
      n.chain,
      formatTokenAmount(BigInt(n.amount), SUPPORTED_ASSETS.find((a) => a.symbol === n.asset)?.decimals || 9),
      n.status,
      n.commitment,
      n.txHash || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `white-protocol-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    // Minimal PDF export via printable window
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const html = `
      <html><head><title>Transaction History</title>
      <style>body{font-family:system-ui,sans-serif;padding:40px;color:#111}h1{font-size:24px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}</style>
      </head><body>
      <h1>White Protocol - Transaction History</h1>
      <p>Generated on ${new Date().toLocaleString()}</p>
      <table>
        <tr><th>Date</th><th>Type</th><th>Asset</th><th>Chain</th><th>Amount</th><th>Status</th></tr>
        ${filtered
          .map(
            (n) =>
              `<tr><td>${new Date(n.timestamp).toLocaleString()}</td><td>${n.status}</td><td>${n.asset}</td><td>${n.chain}</td><td>${formatTokenAmount(
                BigInt(n.amount),
                SUPPORTED_ASSETS.find((a) => a.symbol === n.asset)?.decimals || 9
              )}</td><td>${n.status}</td></tr>`
          )
          .join("")}
      </table>
      </body></html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  if (!isConnected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mx-auto max-w-5xl space-y-6"
      >
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Transaction History</h1>
          <p className="text-zinc-400">All your private transactions in one place.</p>
        </div>
        <Card className="glass-card border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Wallet className="h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 text-lg font-medium">Connect your wallet</h3>
            <p className="mt-1 text-sm text-zinc-400">Connect a wallet to view transaction history.</p>
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
      className="mx-auto max-w-6xl space-y-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Transaction History</h1>
          <p className="text-zinc-400">All your private transactions in one place.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]" onClick={exportCSV}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]" onClick={exportPDF}>
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      <Card className="glass-card border-white/10">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search commitment, tx hash, or asset..."
                className="border-white/10 bg-white/[0.03] pl-9 text-white placeholder:text-zinc-500"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={filterChain}
                onChange={(e) => setFilterChain(e.target.value as any)}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all">All Chains</option>
                <option value="solana">Solana</option>
                <option value="base">Base</option>
              </select>
              <select
                value={filterAsset}
                onChange={(e) => setFilterAsset(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all">All Assets</option>
                {SUPPORTED_ASSETS.map((a) => (
                  <option key={a.symbol} value={a.symbol}>
                    {a.symbol}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="settled">Settled</option>
                <option value="spent">Spent</option>
                <option value="awaiting_payment">Awaiting Payment</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-zinc-400">No transactions found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-zinc-400">
                    <th className="pb-3 pr-4 font-medium">Date</th>
                    <th className="pb-3 pr-4 font-medium">Type</th>
                    <th className="pb-3 pr-4 font-medium">Asset</th>
                    <th className="pb-3 pr-4 font-medium">Chain</th>
                    <th className="pb-3 pr-4 font-medium">Amount</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((note) => {
                    const asset = SUPPORTED_ASSETS.find((a) => a.symbol === note.asset);
                    return (
                      <tr key={note.commitment} className="text-zinc-200">
                        <td className="py-3 pr-4 text-zinc-400">
                          {new Date(note.timestamp).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-4 capitalize">
                          {note.status === "awaiting_payment" ? "Payment Request" : note.status}
                        </td>
                        <td className="py-3 pr-4">{note.asset}</td>
                        <td className="py-3 pr-4 capitalize">{note.chain}</td>
                        <td className="py-3 pr-4">
                          {formatTokenAmount(BigInt(note.amount), asset?.decimals || 9)} {note.asset}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant="outline"
                            className={
                              note.status === "spent"
                                ? "border-red-500/30 text-red-400"
                                : note.status === "settled"
                                ? "border-emerald-500/30 text-emerald-400"
                                : "border-amber-500/30 text-amber-400"
                            }
                          >
                            {note.status}
                          </Badge>
                        </td>
                        <td className="py-3">
                          <div className="space-y-1">
                            <p className="font-mono text-xs text-zinc-500">
                              C: {truncate(note.commitment, 10)}
                            </p>
                            {note.txHash && (
                              <a
                                href={`${CHAINS[note.chain].blockExplorerUrl}/tx/${note.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-xs text-emerald-400 hover:underline"
                              >
                                Tx: {truncate(note.txHash, 10)}
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
