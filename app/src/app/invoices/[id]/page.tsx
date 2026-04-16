"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getInvoice, updateInvoiceStatus, type Invoice } from "@/lib/invoiceService";
import { createReceipt } from "@/lib/receiptService";
import { generateInvoicePDF } from "@/lib/pdfGenerator";
import { getTierConfig } from "@/lib/userTier";
import { useChain } from "@/providers/ChainContext";
import { baseChainService, solanaChainService } from "@/lib/chainService";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Copy, Download, Check, FileText, X, ArrowLeft } from "lucide-react";

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { walletAddress } = useChain();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    const inv = await getInvoice(id);
    setInvoice(inv);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-poll for payment on-chain
  useEffect(() => {
    if (!invoice || invoice.status === "paid" || invoice.status === "cancelled") return;
    setPolling(true);

    let checks = 0;
    const MAX_CHECKS = 240; // stop after ~1 hour (240 * 15s)

    const checkPayment = async () => {
      if (!invoice) return;
      checks++;
      if (checks > MAX_CHECKS) {
        setPolling(false);
        return;
      }

      try {
        let paid = false;
        let txHash: string | undefined;

        if (invoice.chain === "base") {
          const pendingIndex = await baseChainService.getCommitmentPendingIndex(BigInt(invoice.commitment));
          if (pendingIndex > 0n) {
            // Still pending, keep polling
            return;
          }
          // Not pending - check if it was ever deposited (settled)
          const event = await baseChainService.findDepositEvent(BigInt(invoice.commitment));
          if (event) {
            paid = true;
            txHash = event.blockNumber.toString(); // use blockNumber as proxy since event doesn't include txHash directly
          }
        } else {
          const isPending = await solanaChainService.isCommitmentPending(invoice.commitment);
          if (isPending) {
            // Still pending, keep polling
            return;
          }
          // Not pending - check recent program logs for the commitment
          const foundInLogs = await solanaChainService.findDepositInLogs(invoice.commitment);
          if (foundInLogs) {
            paid = true;
          }
        }

        if (paid) {
          await updateInvoiceStatus(invoice.id, "paid", txHash);
          setInvoice((prev) => (prev ? { ...prev, status: "paid", paidAt: Date.now(), paidTxHash: txHash } : prev));
          await createReceipt({
            invoiceId: invoice.id,
            type: "invoice_paid",
            from: { name: invoice.to.name, walletAddress: invoice.to.walletAddress || "Unknown" },
            to: { name: invoice.from.companyName, walletAddress: invoice.from.walletAddress },
            amount: invoice.total,
            asset: invoice.asset,
            chain: invoice.chain,
            txHash: txHash || "",
            companyName: invoice.from.companyName,
            companyLogo: invoice.from.logo,
          });
          setPolling(false);
          clearInterval(interval);
        }
      } catch (err) {
        // Ignore polling errors (e.g., network issues)
      }
    };

    const interval = setInterval(checkPayment, 15000);
    checkPayment(); // initial check
    return () => clearInterval(interval);
  }, [invoice]);

  const handleCopy = () => {
    if (!invoice) return;
    navigator.clipboard.writeText(invoice.paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPDF = () => {
    if (!invoice) return;
    generateInvoicePDF(invoice);
  };

  const handleMarkSent = async () => {
    if (!invoice) return;
    await updateInvoiceStatus(invoice.id, "sent");
    setInvoice({ ...invoice, status: "sent" });
  };

  const handleCancel = async () => {
    if (!invoice || !confirm("Cancel this invoice?")) return;
    await updateInvoiceStatus(invoice.id, "cancelled");
    setInvoice({ ...invoice, status: "cancelled" });
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold text-white">Invoice Not Found</h1>
        <Button onClick={() => router.push("/invoices")} variant="outline" className="mt-4 border-white/10">
          Back to Invoices
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <Button onClick={() => router.push("/invoices")} variant="outline" className="border-white/10 text-zinc-300 hover:bg-white/[0.05]">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{invoice.invoiceNumber}</h1>
          <p className="text-sm text-zinc-400">Created {new Date(invoice.createdAt).toLocaleDateString()}</p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      {/* Timeline */}
      <div className="flex items-center gap-2 text-sm">
        <TimelineStep active={true} label="Created" />
        <div className="h-px flex-1 bg-white/10" />
        <TimelineStep active={invoice.status === "sent" || invoice.status === "paid"} label="Sent" />
        <div className="h-px flex-1 bg-white/10" />
        <TimelineStep active={invoice.status === "paid"} label="Paid" />
      </div>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">From</div>
              <div className="mt-1 font-medium text-white">{invoice.from.companyName}</div>
              {invoice.from.email && <div className="text-sm text-zinc-400">{invoice.from.email}</div>}
              <div className="text-xs text-zinc-500 break-all">{invoice.from.walletAddress}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Bill To</div>
              <div className="mt-1 font-medium text-white">{invoice.to.name}</div>
              {invoice.to.email && <div className="text-sm text-zinc-400">{invoice.to.email}</div>}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02]">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-zinc-300">Description</th>
                  <th className="px-4 py-2 text-center font-medium text-zinc-300">Qty</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-300">Price</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-300">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((item, idx) => (
                  <tr key={idx} className="border-t border-white/10">
                    <td className="px-4 py-2 text-zinc-300">{item.description}</td>
                    <td className="px-4 py-2 text-center text-zinc-400">{item.quantity}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{item.unitPrice} {invoice.asset}</td>
                    <td className="px-4 py-2 text-right text-zinc-300">{(item.quantity * item.unitPrice).toFixed(2)} {invoice.asset}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 text-right">
            <div className="text-sm text-zinc-400">Subtotal: {invoice.subtotal.toFixed(2)} {invoice.asset}</div>
            <div className="text-sm text-zinc-400">Tax ({invoice.taxRate ?? 0}%): {(invoice.tax ?? 0).toFixed(2)} {invoice.asset}</div>
            <div className="text-lg font-bold text-white">Total: {invoice.total.toFixed(2)} {invoice.asset}</div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Section */}
      {invoice.status !== "paid" && invoice.status !== "cancelled" && (
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="text-white">Payment Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              <div className="rounded-xl border border-white/10 bg-white p-2">
                <QRCodeSVG value={invoice.paymentLink} size={160} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCopy} variant="outline" className="flex-1 border-white/10 text-zinc-300 hover:bg-white/[0.05]">
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied" : "Copy Link"}
              </Button>
              <Button onClick={handleDownloadPDF} variant="outline" className="flex-1 border-white/10 text-zinc-300 hover:bg-white/[0.05]">
                <FileText className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
            </div>
            {polling && (
              <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for payment...
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {invoice.status === "paid" && (
        <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">Paid on {new Date(invoice.paidAt!).toLocaleDateString()}</div>
              {invoice.paidTxHash && (
                <div className="text-sm text-zinc-400 break-all">Tx: {invoice.paidTxHash}</div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {invoice.status === "draft" && (
          <Button onClick={handleMarkSent} className="bg-emerald-600 hover:bg-emerald-700">
            <Check className="mr-2 h-4 w-4" />
            Mark as Sent
          </Button>
        )}
        {invoice.status !== "paid" && invoice.status !== "cancelled" && (
          <Button onClick={handleCancel} variant="outline" className="border-red-500/20 text-red-400 hover:bg-red-500/10">
            <X className="mr-2 h-4 w-4" />
            Cancel Invoice
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Invoice["status"] }) {
  const colors: Record<Invoice["status"], string> = {
    draft: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    sent: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    paid: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    expired: "bg-red-500/10 text-red-400 border-red-500/20",
    cancelled: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  };
  return (
    <Badge variant="outline" className={`text-sm ${colors[status]}`}>
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function TimelineStep({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1 text-xs font-medium ${active ? "text-emerald-400" : "text-zinc-600"}`}>
      <div className={`h-2 w-2 rounded-full ${active ? "bg-emerald-400" : "bg-zinc-600"}`} />
      {label}
    </div>
  );
}
