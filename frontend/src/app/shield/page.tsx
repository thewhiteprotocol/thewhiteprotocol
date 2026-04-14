"use client";

import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

export default function ShieldPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Deposit & Withdraw</h1>
        <p className="text-zinc-400">Shield your assets into the privacy pool or withdraw them.</p>
      </div>

      <Tabs defaultValue="deposit" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-white/[0.03]">
          <TabsTrigger value="deposit" className="data-[state=active]:bg-white/10">
            <ArrowDownLeft className="mr-2 h-4 w-4" />
            Deposit
          </TabsTrigger>
          <TabsTrigger value="withdraw" className="data-[state=active]:bg-white/10">
            <ArrowUpRight className="mr-2 h-4 w-4" />
            Withdraw
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deposit">
          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">Deposit to Shielded Pool</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Asset</label>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-400">
                  Select an asset
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Amount</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500"
                />
              </div>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700">Deposit</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="withdraw">
          <Card className="glass-card border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">Withdraw from Shielded Pool</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-center text-sm text-zinc-400">
                Your settled notes will appear here.
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
