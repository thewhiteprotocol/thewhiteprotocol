"use client";

import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCode } from "lucide-react";

export default function ReceivePage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Receive Payment</h1>
        <p className="text-zinc-400">Generate a QR code or payment link to receive funds privately.</p>
      </div>

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Payment Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Amount (optional)</label>
            <Input
              type="number"
              placeholder="0.00"
              className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500"
            />
          </div>
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700">
            <QrCode className="mr-2 h-4 w-4" />
            Generate QR Code
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
