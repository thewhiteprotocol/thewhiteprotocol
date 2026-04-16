"use client";

import { saveToStore, loadFromStore, isStoreInitialized, getCachedWalletAddress } from "./encryption";

const STORAGE_PREFIX = "white_protocol_tier_v1";

export type UserTier = "personal" | "business";

export interface BusinessProfile {
  companyName: string;
  logo?: string; // base64 or data URL
  email?: string;
  website?: string;
  address?: string;
  taxId?: string;
}

export interface TierConfig {
  tier: UserTier;
  businessProfile?: BusinessProfile;
  activatedAt?: number;
}

export async function initTierStore(): Promise<void> {
  // Tier store uses the same encryption key initialized by unlock modal via noteStore/initEncryption
  // No-op here; just ensure we have a default if none exists
  const existing = await loadFromStore<TierConfig>(STORAGE_PREFIX);
  if (!existing) {
    await saveToStore<TierConfig>(STORAGE_PREFIX, { tier: "personal" });
  }
}

export async function getTierConfig(): Promise<TierConfig> {
  const config = await loadFromStore<TierConfig>(STORAGE_PREFIX);
  return config ?? { tier: "personal" };
}

export async function setTier(tier: UserTier): Promise<void> {
  const config = await getTierConfig();
  config.tier = tier;
  if (tier === "business" && !config.activatedAt) {
    config.activatedAt = Date.now();
  }
  await saveToStore(STORAGE_PREFIX, config);
}

export async function setBusinessProfile(profile: BusinessProfile): Promise<void> {
  const config = await getTierConfig();
  config.businessProfile = profile;
  await saveToStore(STORAGE_PREFIX, config);
}

export async function isBusinessUser(): Promise<boolean> {
  const config = await getTierConfig();
  return config.tier === "business";
}

export function isTierStoreInitialized(walletAddress?: string): boolean {
  if (!walletAddress) return false;
  return isStoreInitialized(STORAGE_PREFIX, walletAddress);
}

export function getBusinessFeatures(): { label: string; locked: boolean }[] {
  return [
    { label: "Private Invoicing", locked: false },
    { label: "Auto-Receipts", locked: false },
    { label: "Accounting Exports", locked: false },
    { label: "Team Management", locked: true },
  ];
}
