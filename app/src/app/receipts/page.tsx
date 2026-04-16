"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getReceipts, type Receipt } from "@/lib/receiptService";
import { generateReceiptPDF } from "@/lib/pdfGenerator";
import { useChain } from "@/providers/ChainContext";
import { Loader2, Receipt as ReceiptIcon, FileText, Download, Calendar } from "lucide-react";

export default function ReceiptsPage() {
  const { isConnected, walletAddress } = useChain();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConnected || !walletAddress) {
      setLoading(false);
      return;
    }
    getReceipts().then((data) => {
      setReceipts(data.sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    });
  }, [isConnected, walletAddress]);

  const handleDownload = async (receipt: Receipt) => {
    await generateReceiptPDF(receipt);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!isConnected || !walletAddress) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold text-white">Connect Your Wallet</h1>
        <p className="mt-2 text-zinc-400">Please connect your wallet to view receipts.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Receipts</h1>
          <p className="text-sm text-zinc-400">Auto-generated receipts from your transactions.</p>
        </div>
      </div>

      {receipts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
          <ReceiptIcon className="mx-auto h-10 w-10 text-zinc-600" />
          <p className="mt-4 text-zinc-400">No receipts yet.</p>
          <p className="text-sm text-zinc-500">Business users get automatic receipts on every transaction.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map((r) => (
            <Card key={r.id} className="border-white/10 bg-white/[0.03]">
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.05]">
                    <FileText className="h-5 w-5 text-zinc-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{formatType(r.type)}</span>
                      <Badge variant="outline" className="border-white/10 text-zinc-400 text-xs">
                        {r.chain}
                      </Badge>
                    </div>
                    <div className="text-sm text-zinc-400">
                      {r.amount.toFixed(4)} {r.asset} · {r.from.walletAddress.slice(0, 6)}...{r.from.walletAddress.slice(-4)} →{" "}
                      {r.to.walletAddress.slice(0, 6)}...{r.to.walletAddress.slice(-4)}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <Calendar className="h-3 w-3" />
                      {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/10 text-zinc-300 hover:bg-white/[0.05]"
                  onClick={() => handleDownload(r)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  PDF
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatType(type: Receipt["type"]) {
  switch (type) {
    case "payment_sent":
      return "Payment Sent";
    case "payment_received":
      return "Payment Received";
    case "invoice_paid":
      return "Invoice Paid";
    default:
      return type;
  }
}
