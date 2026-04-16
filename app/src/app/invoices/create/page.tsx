"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createInvoice, type InvoiceLineItem } from "@/lib/invoiceService";
import { generateInvoicePDF } from "@/lib/pdfGenerator";
import { getTierConfig, type BusinessProfile } from "@/lib/userTier";
import { useChain } from "@/providers/ChainContext";
import { Loader2, Plus, Trash2, FileText, Copy, Download, Check } from "lucide-react";

export default function CreateInvoicePage() {
  const router = useRouter();
  const { walletAddress } = useChain();
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    { description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [taxRate, setTaxRate] = useState<number>(0);
  const [asset, setAsset] = useState("ETH");
  const [chain, setChain] = useState<"solana" | "base">("base");
  const [dueDate, setDueDate] = useState("");
  const [memo, setMemo] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeLineItem = (idx: number) => {
    setLineItems(lineItems.filter((_, i) => i !== idx));
  };

  const updateLineItem = (idx: number, field: keyof InvoiceLineItem, value: any) => {
    const updated = [...lineItems];
    updated[idx] = { ...updated[idx], [field]: value };
    setLineItems(updated);
  };

  const handleCreate = async () => {
    if (!clientName.trim() || !walletAddress) return;
    setCreating(true);
    try {
      const tierConfig = await getTierConfig();
      const profile = tierConfig.businessProfile || { companyName: "My Business" };
      const invoice = await createInvoice({
        from: {
          companyName: profile.companyName,
          logo: profile.logo,
          email: profile.email,
          address: profile.address,
          taxId: profile.taxId,
          walletAddress,
        },
        to: { name: clientName, email: clientEmail || undefined },
        lineItems: lineItems.filter((i) => i.description.trim()),
        taxRate,
        asset,
        chain,
        dueDate: dueDate ? new Date(dueDate).getTime() : undefined,
        memo: memo || undefined,
      });
      setCreatedInvoice(invoice);
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = () => {
    if (!createdInvoice) return;
    navigator.clipboard.writeText(createdInvoice.paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPDF = () => {
    if (!createdInvoice) return;
    generateInvoicePDF(createdInvoice);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Create Invoice</h1>
        <p className="text-sm text-zinc-400">Send a private invoice with a shielded payment link.</p>
      </div>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardContent className="space-y-6 p-6">
          {/* Client */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Client Name *</label>
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Acme Inc."
                className="border-white/10 bg-white/[0.03] text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Client Email</label>
              <Input
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="billing@acme.com"
                className="border-white/10 bg-white/[0.03] text-white"
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-300">Line Items</label>
            {lineItems.map((item, idx) => (
              <div key={idx} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-[1fr,80px,120px,auto]">
                <Input
                  value={item.description}
                  onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                  placeholder="Description"
                  className="border-white/10 bg-white/[0.03] text-white"
                />
                <Input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateLineItem(idx, "quantity", Number(e.target.value))}
                  placeholder="Qty"
                  className="border-white/10 bg-white/[0.03] text-white"
                />
                <Input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={item.unitPrice}
                  onChange={(e) => updateLineItem(idx, "unitPrice", Number(e.target.value))}
                  placeholder={`Price (${asset})`}
                  className="border-white/10 bg-white/[0.03] text-white"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="border-white/10 text-zinc-400 hover:bg-white/[0.05]"
                  onClick={() => removeLineItem(idx)}
                  disabled={lineItems.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={addLineItem}
              className="w-full border-dashed border-white/10 text-zinc-400 hover:bg-white/[0.05]"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Line Item
            </Button>
          </div>

          {/* Totals */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Tax Rate (%)</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value))}
                  className="border-white/10 bg-white/[0.03] text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Asset</label>
                <select
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                  className="h-10 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 text-white outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="ETH">ETH</option>
                  <option value="WETH">WETH</option>
                  <option value="SOL">SOL</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Chain</label>
                <select
                  value={chain}
                  onChange={(e) => setChain(e.target.value as "solana" | "base")}
                  className="h-10 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 text-white outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="base">Base Sepolia</option>
                  <option value="solana">Solana Devnet</option>
                </select>
              </div>
            </div>
            <div className="mt-4 space-y-1 text-right">
              <div className="text-sm text-zinc-400">Subtotal: {subtotal.toFixed(4)} {asset}</div>
              <div className="text-sm text-zinc-400">Tax ({taxRate}%): {tax.toFixed(4)} {asset}</div>
              <div className="text-lg font-bold text-white">Total: {total.toFixed(4)} {asset}</div>
            </div>
          </div>

          {/* Due date + memo */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Due Date</label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="border-white/10 bg-white/[0.03] text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Memo</label>
              <Input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Optional note..."
                className="border-white/10 bg-white/[0.03] text-white"
              />
            </div>
          </div>

          <Button
            onClick={handleCreate}
            disabled={creating || !clientName.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create & Send Invoice"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Success Modal */}
      <Dialog open={!!createdInvoice} onOpenChange={() => setCreatedInvoice(null)}>
        <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">Invoice Created!</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4 text-center">
            <p className="text-zinc-400">
              Share this private payment link with your client.
            </p>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm break-all text-zinc-300">
              {createdInvoice?.paymentLink}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCopyLink} variant="outline" className="flex-1 border-white/10 text-zinc-300 hover:bg-white/[0.05]">
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied" : "Copy Link"}
              </Button>
              <Button onClick={handleDownloadPDF} variant="outline" className="flex-1 border-white/10 text-zinc-300 hover:bg-white/[0.05]">
                <FileText className="mr-2 h-4 w-4" />
                PDF
              </Button>
            </div>
            {clientEmail && (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left text-sm text-zinc-400">
                <p className="font-medium text-zinc-300">Suggested email message:</p>
                <p className="mt-1 italic">
                  Hi {clientName},<br />
                  Please find your invoice attached. You can pay securely and privately here:<br />
                  {createdInvoice?.paymentLink}
                </p>
              </div>
            )}
            <Button onClick={() => router.push(`/invoices/${createdInvoice?.id}`)} className="w-full bg-emerald-600 hover:bg-emerald-700">
              View Invoice
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
