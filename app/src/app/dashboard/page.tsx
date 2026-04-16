"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownLeft, Shield, Wallet, Loader2 } from "lucide-react";
import Link from "next/link";
import { getNotes } from "@/lib/noteStore";
import { StoredNote } from "@/lib/types";
import { getTotalBalanceUsd, formatTokenAmount, getPendingBalance } from "@/lib/balanceService";
import { useChain } from "@/providers/ChainContext";

const ASSET_DECIMALS: Record<string, number> = {
  SOL: 9,
  ETH: 18,
  WETH: 18,
  USDC: 6,
};

export default function DashboardPage() {
  const { isConnected, walletAddress } = useChain();
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [totalUsd, setTotalUsd] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<
    Array<{ asset: string; chain: "solana" | "base"; amount: bigint; usdValue: number }>
  >([]);
  const [pendingBalance, setPendingBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConnected) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function load() {
      try {
        const n = await getNotes();
        if (!mounted) return;
        setNotes(n);
        const { total, breakdown } = await getTotalBalanceUsd(n);
        if (!mounted) return;
        setTotalUsd(total);
        setBreakdown(breakdown);
        setPendingBalance(getPendingBalance(n));
      } catch {
        // Store may not be initialized yet
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isConnected, walletAddress]);

  const recentNotes = notes.slice(-5).reverse();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-6xl space-y-6"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Shielded Balance Dashboard</h1>
        <p className="text-zinc-400">Your private assets across Solana and Base.</p>
      </div>

      {!isConnected ? (
        <Card className="glass-card border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Wallet className="h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 text-lg font-medium">Connect your wallet</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Connect a wallet to view your shielded balances.
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card className="glass-card border-white/10">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="glass-card border-white/10">
            <CardContent className="p-8">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-400">Total Shielded Balance</p>
                <p className="text-5xl font-bold tracking-tight gradient-text">
                  ${totalUsd?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "0.00"}
                </p>
                {pendingBalance > 0n && (
                  <p className="text-sm text-amber-400">
                    + {formatTokenAmount(pendingBalance, 9)} pending
                  </p>
                )}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/send">
                  <Button className="bg-emerald-600 hover:bg-emerald-700">
                    <ArrowUpRight className="mr-2 h-4 w-4" />
                    Send
                  </Button>
                </Link>
                <Link href="/receive">
                  <Button variant="outline" className="border-white/10 hover:bg-white/[0.03]">
                    <ArrowDownLeft className="mr-2 h-4 w-4" />
                    Receive
                  </Button>
                </Link>
                <Link href="/shield">
                  <Button variant="outline" className="border-white/10 hover:bg-white/[0.03]">
                    <Shield className="mr-2 h-4 w-4" />
                    Deposit
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {breakdown.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {breakdown.map((item) => {
                const decimals = ASSET_DECIMALS[item.asset] || 18;
                return (
                  <Card key={`${item.chain}-${item.asset}`} className="glass-card border-white/10">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium text-zinc-400">
                          {item.asset} — {item.chain === "solana" ? "Solana" : "Base"}
                        </CardTitle>
                        <Badge variant="outline" className="border-white/10 text-zinc-400">
                          {item.chain}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-semibold">
                        {formatTokenAmount(item.amount, decimals)} {item.asset}
                      </div>
                      <p className="text-sm text-zinc-500">
                        ${item.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="glass-card border-white/10">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Wallet className="h-12 w-12 text-zinc-600" />
                <h3 className="mt-4 text-lg font-medium">No shielded assets yet</h3>
                <p className="mt-1 max-w-sm text-sm text-zinc-400">
                  Deposit assets to get started with private payments.
                </p>
                <Link href="/shield" className="mt-4">
                  <Button className="bg-emerald-600 hover:bg-emerald-700">Make First Deposit</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {recentNotes.length > 0 ? (
                <div className="space-y-3">
                  {recentNotes.map((note, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium capitalize">
                          {note.status === "awaiting_payment" ? "Payment Request" : note.status}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {new Date(note.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {formatTokenAmount(BigInt(note.amount), ASSET_DECIMALS[note.asset] || 18)}{" "}
                          {note.asset}
                        </p>
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
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-zinc-500">No recent activity</div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </motion.div>
  );
}
