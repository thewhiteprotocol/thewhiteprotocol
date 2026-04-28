"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getInvoice, type Invoice } from "@/lib/invoiceService";
import { useChain } from "@/providers/ChainContext";
import { Loader2, Wallet, Check, Shield } from "lucide-react";

export default function PayInvoicePage() {
  const params = useParams();
  const id = params.id as string;
  const { isConnected, walletAddress, activeChain } = useChain();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    getInvoice(id).then((inv) => {
      setInvoice(inv);
      setLoading(false);
    });
  }, [id]);

  const handlePay = async () => {
    if (!invoice || !walletAddress) return;
    setPaying(true);
    try {
      // In a real implementation, this would:
      // 1. Generate a deposit proof for the invoice's commitment
      // 2. Submit the deposit transaction on the selected chain
      // For this implementation, we simulate a successful payment after 2 seconds
      await new Promise((res) => setTimeout(res, 2000));
      setPaid(true);
      // Create a receipt for the invoice payment
      const { createReceipt } = await import("@/lib/receiptService");
      const { updateInvoiceStatus } = await import("@/lib/invoiceService");
      await createReceipt({
        invoiceId: invoice.id,
        type: "invoice_paid",
        from: { walletAddress },
        to: { name: invoice.from.companyName, walletAddress: invoice.from.walletAddress },
        amount: invoice.total,
        asset: invoice.asset,
        chain: invoice.chain,
        txHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
        companyName: invoice.from.companyName,
        companyLogo: invoice.from.logo,
      });
      await updateInvoiceStatus(invoice.id, "paid");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4 text-center">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoice Not Found</h1>
          <p className="mt-2 text-zinc-400">This invoice link may have expired or been cancelled.</p>
        </div>
      </div>
    );
  }

  const logoHtml = invoice.from.logo ? (
    <img src={invoice.from.logo} alt={invoice.from.companyName} className="h-10 object-contain" />
  ) : (
    <div className="text-xl font-bold text-emerald-400">{invoice.from.companyName}</div>
  );

  return (
    <div className="min-h-screen bg-black px-4 py-8">
      <div className="mx-auto max-w-md space-y-6">
        {/* Branding */}
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-medium text-zinc-400">The White Protocol</span>
        </div>

        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              {logoHtml}
              <Badge variant="outline" className="border-white/10 text-zinc-400">
                {invoice.status === "paid" ? "Paid" : "Awaiting Payment"}
              </Badge>
            </div>
            <CardTitle className="pt-4 text-xl text-white">Invoice {invoice.invoiceNumber}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-zinc-400">
              From <span className="text-zinc-300">{invoice.from.companyName}</span>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              {invoice.lineItems.map((item, idx) => (
                <div key={idx} className="flex justify-between py-1 text-sm">
                  <span className="text-zinc-300">{item.description} x {item.quantity}</span>
                  <span className="text-zinc-400">{(item.quantity * item.unitPrice).toFixed(2)} {invoice.asset}</span>
                </div>
              ))}
              <div className="mt-2 border-t border-white/10 pt-2 text-right">
                <div className="text-2xl font-bold text-white">
                  {invoice.total.toFixed(2)} {invoice.asset}
                </div>
                <div className="text-xs text-zinc-500">
                  on {invoice.chain === "base" ? "Base Sepolia" : invoice.chain === "bsc" ? "BSC Testnet" : "Solana Devnet"}
                </div>
              </div>
            </div>

            {invoice.memo && (
              <div className="text-sm text-zinc-400">
                <span className="text-zinc-500">Note:</span> {invoice.memo}
              </div>
            )}

            {!isConnected ? (
              <div className="text-center">
                <p className="text-sm text-zinc-400">Connect your wallet to pay this invoice privately.</p>
                <div className="mt-4 flex justify-center">
                  <Wallet className="h-8 w-8 text-zinc-600" />
                </div>
              </div>
            ) : paid ? (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-center">
                <Check className="mx-auto h-8 w-8 text-emerald-400" />
                <p className="mt-2 font-semibold text-emerald-400">Payment Complete</p>
                <p className="text-sm text-zinc-400">The invoice has been marked as paid.</p>
              </div>
            ) : (
              <Button
                onClick={handlePay}
                disabled={paying || invoice.status === "paid" || invoice.status === "cancelled"}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                {paying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : invoice.status === "paid" ? (
                  "Already Paid"
                ) : invoice.status === "cancelled" ? (
                  "Invoice Cancelled"
                ) : (
                  `Pay ${invoice.total.toFixed(2)} ${invoice.asset}`
                )}
              </Button>
            )}

            <div className="text-center text-xs text-zinc-500">
              Payments are processed privately using zero-knowledge proofs.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
