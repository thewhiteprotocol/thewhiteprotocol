"use client";

import { EncryptedNoteStore, StoredNote } from "./types";

const STORE_VERSION = 1;
const STORAGE_PREFIX = "white_protocol_notes_v2";

let cachedKey: CryptoKey | null = null;
let cachedWalletAddress: string | null = null;

async function deriveKeyFromSignature(signature: Uint8Array): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", signature as unknown as ArrayBuffer);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function getStorageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}_${walletAddress.toLowerCase()}`;
}

export async function initNoteStore(
  walletAddress: string,
  signature: Uint8Array
): Promise<StoredNote[]> {
  cachedKey = await deriveKeyFromSignature(signature);
  cachedWalletAddress = walletAddress.toLowerCase();
  return await loadNotes();
}

export async function addNote(note: StoredNote): Promise<void> {
  const notes = await loadNotes();
  notes.push(note);
  await saveNotes(notes);
}

export async function updateNote(commitment: string, updates: Partial<StoredNote>): Promise<void> {
  const notes = await loadNotes();
  const idx = notes.findIndex((n) => n.commitment === commitment);
  if (idx >= 0) {
    notes[idx] = { ...notes[idx], ...updates };
    await saveNotes(notes);
  }
}

export async function getNotes(): Promise<StoredNote[]> {
  return await loadNotes();
}

export async function markSpent(nullifier: string, txHash?: string): Promise<void> {
  const notes = await loadNotes();
  const note = notes.find((n) => n.nullifier === nullifier);
  if (note) {
    note.status = "spent";
    if (txHash) note.txHash = txHash;
    await saveNotes(notes);
  }
}

export async function exportNotes(): Promise<string> {
  const key = getStoreKey();
  if (!key) throw new Error("Note store not initialized");
  const storageKey = getStorageKey(cachedWalletAddress!);
  const raw = localStorage.getItem(storageKey);
  if (!raw) return "";
  return raw;
}

export async function importNotes(backup: string): Promise<StoredNote[]> {
  const key = getStoreKey();
  if (!key) throw new Error("Note store not initialized");
  const parsed: EncryptedNoteStore = JSON.parse(backup);
  const notes = await decryptStore(parsed, key);
  const storageKey = getStorageKey(cachedWalletAddress!);
  localStorage.setItem(storageKey, backup);
  return notes;
}

export function isStoreInitialized(walletAddress?: string): boolean {
  if (!walletAddress) return false;
  const storageKey = getStorageKey(walletAddress);
  return typeof window !== "undefined" && localStorage.getItem(storageKey) !== null;
}

export function hasSessionKey(): boolean {
  return cachedKey !== null && cachedWalletAddress !== null;
}

function getStoreKey(): CryptoKey | null {
  return cachedKey;
}

async function loadNotes(): Promise<StoredNote[]> {
  const key = getStoreKey();
  if (!key || !cachedWalletAddress) {
    throw new Error("Note store not initialized. Call initNoteStore first.");
  }
  const storageKey = getStorageKey(cachedWalletAddress);
  const raw = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
  if (!raw) return [];
  const parsed: EncryptedNoteStore = JSON.parse(raw);
  return await decryptStore(parsed, key);
}

async function saveNotes(notes: StoredNote[]): Promise<void> {
  const key = getStoreKey();
  if (!key || !cachedWalletAddress) {
    throw new Error("Note store not initialized. Call initNoteStore first.");
  }
  const encrypted = await encryptStore(notes, key);
  const storageKey = getStorageKey(cachedWalletAddress);
  if (typeof window !== "undefined") {
    localStorage.setItem(storageKey, JSON.stringify(encrypted));
  }
}

async function encryptStore(notes: StoredNote[], key: CryptoKey): Promise<EncryptedNoteStore> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const plaintext = new TextEncoder().encode(JSON.stringify(notes));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext as unknown as ArrayBuffer
  );
  return {
    version: STORE_VERSION,
    iv: arrayBufferToBase64((iv as unknown as Uint8Array).buffer as ArrayBuffer),
    ciphertext: arrayBufferToBase64(ciphertext),
    salt: arrayBufferToBase64((salt as unknown as Uint8Array).buffer as ArrayBuffer),
  };
}

async function decryptStore(store: EncryptedNoteStore, key: CryptoKey): Promise<StoredNote[]> {
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
  return JSON.parse(new TextDecoder().decode(plaintext)) as StoredNote[];
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
