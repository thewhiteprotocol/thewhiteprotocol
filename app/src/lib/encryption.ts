"use client";

export const STORE_VERSION = 1;

let cachedKey: CryptoKey | null = null;
let cachedWalletAddress: string | null = null;

export function getCachedKey(): CryptoKey | null {
  return cachedKey;
}

export function getCachedWalletAddress(): string | null {
  return cachedWalletAddress;
}

export function hasSessionKey(): boolean {
  return cachedKey !== null && cachedWalletAddress !== null;
}

/**
 * Normalize an EVM signature for stable key derivation.
 * EVM signatures can vary in `v` encoding (27/28, 0/1, EIP-155 chain-encoded).
 * We canonicalize `v` to 27/28 so the same message + key always produces
 * the same derivation input, preventing "notes disappeared" bugs.
 */
function normalizeSignature(signature: Uint8Array, chain?: string): Uint8Array {
  // Solana ed25519 signatures are deterministic — no normalization needed
  if (chain === "solana" || signature.length !== 65) {
    return signature;
  }

  // EVM ECDSA signature: r (32 bytes) || s (32 bytes) || v (1 byte)
  const normalized = new Uint8Array(signature);
  const v = normalized[64];

  // Canonicalize v to 27 or 28
  let canonicalV: number;
  if (v >= 35) {
    // EIP-155 encoded: v = chainId * 2 + 35 or chainId * 2 + 36
    canonicalV = ((v - 35) % 2 === 0) ? 27 : 28;
  } else if (v === 0 || v === 1) {
    canonicalV = v + 27;
  } else {
    canonicalV = v; // already 27 or 28
  }

  normalized[64] = canonicalV;
  return normalized;
}

export async function initEncryption(
  walletAddress: string,
  signature: Uint8Array,
  chain?: string
): Promise<void> {
  const normalized = normalizeSignature(signature, chain);
  // Include wallet address in the key derivation so:
  // 1. Different wallets never share keys (even if signatures collide)
  // 2. We have a stable component for debugging / partial recovery
  const combined = new Uint8Array(20 + normalized.length);
  const addressBytes = new TextEncoder().encode(walletAddress.toLowerCase().slice(0, 20));
  combined.set(addressBytes, 0);
  combined.set(normalized, 20);

  const hash = await crypto.subtle.digest("SHA-256", combined as unknown as ArrayBuffer);
  cachedKey = await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  cachedWalletAddress = walletAddress.toLowerCase();
}

export interface EncryptedStore {
  version: number;
  iv: string;
  ciphertext: string;
  salt: string;
}

export async function encryptData<T>(data: T): Promise<EncryptedStore> {
  const key = cachedKey;
  const walletAddress = cachedWalletAddress;
  if (!key || !walletAddress) {
    throw new Error("Encryption not initialized. Call initEncryption first.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext as unknown as ArrayBuffer
  );
  return {
    version: STORE_VERSION,
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    ciphertext: arrayBufferToBase64(ciphertext),
    salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
  };
}

export async function decryptData<T>(store: EncryptedStore): Promise<T> {
  const key = cachedKey;
  if (!key) {
    throw new Error("Encryption not initialized. Call initEncryption first.");
  }
  if (store.version !== STORE_VERSION) {
    throw new Error(`Unsupported store version: ${store.version}`);
  }
  const iv = base64ToArrayBuffer(store.iv);
  const ciphertext = base64ToArrayBuffer(store.ciphertext);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext as ArrayBuffer
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch (err) {
    // Distinguish decryption failures from other errors so callers can
    // show helpful UI instead of silently showing empty history.
    throw new Error(
      "DECRYPTION_FAILED: Unable to decrypt private notes. " +
      "This usually means your wallet produced a different signature than before. " +
      "Try restoring from a backup, or ensure you are using the same wallet and chain."
    );
  }
}

export function getStorageKey(prefix: string, walletAddress: string): string {
  return `${prefix}_${walletAddress.toLowerCase()}`;
}

export function isStoreInitialized(prefix: string, walletAddress: string): boolean {
  const storageKey = getStorageKey(prefix, walletAddress);
  return typeof window !== "undefined" && localStorage.getItem(storageKey) !== null;
}

export async function saveToStore<T>(prefix: string, data: T): Promise<void> {
  if (!cachedWalletAddress) {
    throw new Error("Encryption not initialized. Call initEncryption first.");
  }
  const encrypted = await encryptData(data);
  const storageKey = getStorageKey(prefix, cachedWalletAddress);
  if (typeof window !== "undefined") {
    localStorage.setItem(storageKey, JSON.stringify(encrypted));
  }
}

export async function loadFromStore<T>(prefix: string): Promise<T | null> {
  if (!cachedWalletAddress) {
    throw new Error("Encryption not initialized. Call initEncryption first.");
  }
  const storageKey = getStorageKey(prefix, cachedWalletAddress);
  const raw = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
  if (!raw) return null;
  const parsed: EncryptedStore = JSON.parse(raw);
  return await decryptData<T>(parsed);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
