"use client";

import { createReceipt, type CreateReceiptParams } from "./receiptService";

export async function maybeCreateReceipt(params: CreateReceiptParams): Promise<void> {
  await createReceipt(params);
}
