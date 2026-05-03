"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getInvoices, deleteInvoice, type Invoice } from "@/lib/invoiceService";
import { useChain } from "@/providers/ChainContext";
import {
  Plus,
  Search,
  FileText,
  Trash2,
  Loader2,
  Eye,
  Send,
} from "lucide-react";

type FilterStatus = "all" | "draft" | "sent" | "paid" | "expired" | "cancelled";

export default function InvoicesPage() {
  const router = useRouter();
  const { isConnected, walletAddress } = useChain();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");

  useEffect(() => {
    if (!isConnected || !walletAddress) {
      setLoading(false);
      return;
    }
    getInvoices().then((data) => {
      setInvoices(data.sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    });
  }, [isConnected, walletAddress]);

  const filtered = invoices.filter((inv) => {
    const matchesSearch =
      inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      inv.to.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || inv.status === filter;
    return matchesSearch && matchesFilter;
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this invoice?")) return;
    await deleteInvoice(id);
    setInvoices((prev) => prev.filter((i) => i.id !== id));
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
        <p className="mt-2 text-zinc-400">Please connect your wallet to view invoices.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoices</h1>
          <p className="text-sm text-zinc-400">Create and manage private payment invoices.</p>
        </div>
        <Link href="/invoices/create">
          <Button className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="mr-2 h-4 w-4" />
            Create Invoice
          </Button>
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices..."
            className="border-white/10 bg-white/[0.03] pl-10 text-white"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["all", "draft", "sent", "paid", "expired"] as FilterStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                filter === f
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
              }`}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-zinc-600" />
          <p className="mt-4 text-zinc-400">No invoices found.</p>
          <Link href="/invoices/create">
            <Button variant="outline" className="mt-4 border-white/10 text-zinc-300 hover:bg-white/[0.05]">
              Create your first invoice
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((inv) => (
            <Card
              key={inv.id}
              className="border-white/10 bg-white/[0.03] transition-all hover:border-white/20"
            >
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.05]">
                    <FileText className="h-5 w-5 text-zinc-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{inv.invoiceNumber}</span>
                      <StatusBadge status={inv.status} />
                    </div>
                    <div className="text-sm text-zinc-400">
                      {inv.to.name} · {inv.total.toFixed(2)} {inv.asset} · {inv.chain === "base" ? "Base" : inv.chain === "bsc" ? "BNB Chain" : "Solana"}
                    </div>
                    <div className="text-xs text-zinc-500">{new Date(inv.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/10 text-zinc-300 hover:bg-white/[0.05]"
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                  >
                    <Eye className="mr-1 h-4 w-4" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/20 text-red-400 hover:bg-red-500/10"
                    onClick={() => handleDelete(inv.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
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
    <Badge variant="outline" className={`text-xs ${colors[status]}`}>
      {status[0].toUpperCase() + status.slice(1)}
    </Badge>
  );
}
