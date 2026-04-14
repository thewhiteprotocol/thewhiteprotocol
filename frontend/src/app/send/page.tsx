"use client";

import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QrCode, Link2 } from "lucide-react";

export default function SendPage() {
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

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Scan or Paste Payment Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" className="w-full h-24 flex-col gap-2 border-white/10 hover:bg-white/[0.03]">
            <QrCode className="h-6 w-6" />
            <span>Scan QR Code</span>
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-black px-2 text-zinc-500">or</span>
            </div>
          </div>
          <Button variant="outline" className="w-full h-24 flex-col gap-2 border-white/10 hover:bg-white/[0.03]">
            <Link2 className="h-6 w-6" />
            <span>Paste Payment Link</span>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
