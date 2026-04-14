"use client";

import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownLeft, Shield, Wallet } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
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

      <Card className="glass-card border-white/10">
        <CardContent className="p-8">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-400">Total Shielded Balance</p>
            <p className="text-5xl font-bold tracking-tight gradient-text">$0.00</p>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="glass-card border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">SOL — Solana</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">0 SOL</div>
            <p className="text-sm text-zinc-500">$0.00</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">ETH — Base</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">0 ETH</div>
            <p className="text-sm text-zinc-500">$0.00</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">USDC — Solana</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">0 USDC</div>
            <p className="text-sm text-zinc-500">$0.00</p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Wallet className="h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 text-lg font-medium">No transactions yet</h3>
            <p className="mt-1 max-w-sm text-sm text-zinc-400">
              Deposit assets to get started with private payments.
            </p>
            <Link href="/shield" className="mt-4">
              <Button className="bg-emerald-600 hover:bg-emerald-700">Make First Deposit</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
