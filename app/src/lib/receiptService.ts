"use client";

import { saveToStore, loadFromStore } from "./encryption";

const STORAGE_PREFIX = "white_protocol_receipts_v1";

export interface Receipt {
  id: string;
  invoiceId?: string;
  type: "payment_sent" | "payment_received" | "invoice_paid";

  from: { name?: string; walletAddress: string };
  to: { name?: string; walletAddress: string };

  amount: number;
  asset: string;
  chain: string;
  txHash: string;

  companyName?: string;
  companyLogo?: string;

  createdAt: number;
  memo?: string;
}

export interface CreateReceiptParams {
  invoiceId?: string;
  type: Receipt["type"];
  from: Receipt["from"];
  to: Receipt["to"];
  amount: number;
  asset: string;
  chain: string;
  txHash: string;
  companyName?: string;
  companyLogo?: string;
  memo?: string;
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function createReceipt(params: CreateReceiptParams): Promise<Receipt> {
  const receipt: Receipt = {
    id: generateUUID(),
    invoiceId: params.invoiceId,
    type: params.type,
    from: params.from,
    to: params.to,
    amount: params.amount,
    asset: params.asset,
    chain: params.chain,
    txHash: params.txHash,
    companyName: params.companyName,
    companyLogo: params.companyLogo,
    memo: params.memo,
    createdAt: Date.now(),
  };
  const receipts = await getReceipts();
  receipts.push(receipt);
  await saveReceipts(receipts);
  return receipt;
}

export async function getReceipts(): Promise<Receipt[]> {
  const receipts = await loadFromStore<Receipt[]>(STORAGE_PREFIX);
  return receipts ?? [];
}

export async function getReceipt(id: string): Promise<Receipt | null> {
  const receipts = await getReceipts();
  return receipts.find((r) => r.id === id) || null;
}

async function saveReceipts(receipts: Receipt[]): Promise<void> {
  await saveToStore(STORAGE_PREFIX, receipts);
}
