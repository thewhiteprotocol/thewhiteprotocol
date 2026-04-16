"use client";

import { isBusinessUser, getTierConfig } from "./userTier";
import { createReceipt, type CreateReceiptParams } from "./receiptService";

export async function maybeCreateReceipt(params: CreateReceiptParams): Promise<void> {
  const business = await isBusinessUser();
  if (!business) return;
  const tierConfig = await getTierConfig();
  await createReceipt({
    ...params,
    companyName: tierConfig.businessProfile?.companyName,
    companyLogo: tierConfig.businessProfile?.logo,
  });
}
