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

export async function initEncryption(
  walletAddress: string,
  signature: Uint8Array
): Promise<void> {
  const hash = await crypto.subtle.digest("SHA-256", signature as unknown as ArrayBuffer);
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
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext as ArrayBuffer
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
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
