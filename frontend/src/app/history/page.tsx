"use client";

import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";

export default function HistoryPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-5xl space-y-6"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Transaction History</h1>
          <p className="text-zinc-400">All your private transactions in one place.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]">
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]">
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      <Card className="glass-card border-white/10">
        <CardContent className="p-8 text-center">
          <p className="text-zinc-400">Your transaction history will appear here.</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
