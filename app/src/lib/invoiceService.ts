"use client";

import { saveToStore, loadFromStore } from "./encryption";
import { computeCommitment, randomFieldElement } from "./crypto";

const STORAGE_PREFIX = "white_protocol_invoices_v1";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number; // in asset units (e.g., 0.5 ETH)
}

export interface Invoice {
  id: string; // UUID
  invoiceNumber: string; // e.g., "INV-2026-001"
  status: "draft" | "sent" | "paid" | "expired" | "cancelled";

  from: {
    companyName: string;
    logo?: string;
    email?: string;
    address?: string;
    taxId?: string;
    walletAddress: string;
  };

  to: {
    name: string;
    email?: string;
    walletAddress?: string;
  };

  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax?: number;
  taxRate?: number; // percentage
  total: number;

  asset: string; // 'ETH', 'SOL', 'USDC', 'WETH'
  chain: "solana" | "base";

  commitment: string;
  secret: string;
  nullifier: string;

  paymentLink: string;

  createdAt: number;
  dueDate?: number;
  paidAt?: number;
  paidTxHash?: string;

  memo?: string;
}

export interface CreateInvoiceParams {
  from: Invoice["from"];
  to: Invoice["to"];
  lineItems: InvoiceLineItem[];
  taxRate?: number;
  asset: string;
  chain: "solana" | "base";
  dueDate?: number;
  memo?: string;
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getNextInvoiceNumber(): Promise<string> {
  const invoices = await getInvoices();
  const year = new Date().getFullYear();
  const yearInvoices = invoices.filter((inv) =>
    inv.invoiceNumber.startsWith(`INV-${year}-`)
  );
  const nextNum = yearInvoices.length + 1;
  return `INV-${year}-${String(nextNum).padStart(3, "0")}`;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<Invoice> {
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();
  const assetId = params.asset === "SOL" || params.asset === "WETH" ? "1" : "2";
  const amount = Math.floor(
    params.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 1e9
  ).toString();
  const commitment = computeCommitment(secret, nullifier, BigInt(amount), BigInt(assetId));

  const subtotal = params.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxRate = params.taxRate ?? 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  const id = generateUUID();
  const invoice: Invoice = {
    id,
    invoiceNumber: await getNextInvoiceNumber(),
    status: "draft",
    from: params.from,
    to: params.to,
    lineItems: params.lineItems,
    subtotal,
    tax,
    taxRate,
    total,
    asset: params.asset,
    chain: params.chain,
    commitment: commitment.toString(),
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    paymentLink: `https://app.thewhiteprotocol.com/pay/invoice/${id}`,
    createdAt: Date.now(),
    dueDate: params.dueDate,
    memo: params.memo,
  };

  const invoices = await getInvoices();
  invoices.push(invoice);
  await saveInvoices(invoices);
  return invoice;
}

export async function getInvoices(): Promise<Invoice[]> {
  const invoices = await loadFromStore<Invoice[]>(STORAGE_PREFIX);
  return invoices ?? [];
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const invoices = await getInvoices();
  return invoices.find((inv) => inv.id === id) || null;
}

export async function updateInvoiceStatus(
  id: string,
  status: Invoice["status"],
  txHash?: string
): Promise<void> {
  const invoices = await getInvoices();
  const idx = invoices.findIndex((inv) => inv.id === id);
  if (idx >= 0) {
    invoices[idx].status = status;
    if (status === "paid") {
      invoices[idx].paidAt = Date.now();
      if (txHash) invoices[idx].paidTxHash = txHash;
    }
    await saveInvoices(invoices);
  }
}

export async function deleteInvoice(id: string): Promise<void> {
  const invoices = await getInvoices();
  const filtered = invoices.filter((inv) => inv.id !== id);
  await saveInvoices(filtered);
}

async function saveInvoices(invoices: Invoice[]): Promise<void> {
  await saveToStore(STORAGE_PREFIX, invoices);
}
