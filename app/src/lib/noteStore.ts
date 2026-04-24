"use client";

import {
  initEncryption,
  hasSessionKey as hasEncryptionSession,
  saveToStore,
  loadFromStore,
  getStorageKey,
  isStoreInitialized as isEncryptionStoreInitialized,
  getCachedWalletAddress,
  encryptData,
  decryptData,
} from "./encryption";
import { EncryptedNoteStore, StoredNote } from "./types";

const STORAGE_PREFIX = "white_protocol_notes_v2";

export async function initNoteStore(
  walletAddress: string,
  signature: Uint8Array,
  chain?: string
): Promise<StoredNote[]> {
  await initEncryption(walletAddress, signature, chain);
  return await loadNotes();
}

export async function addNote(note: StoredNote): Promise<void> {
  const notes = await loadNotes();
  // Prevent duplicate notes (same commitment) which can happen from
  // double-clicks, retries, or race conditions between tabs.
  if (notes.some((n) => n.commitment === note.commitment)) {
    return;
  }
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
  const walletAddress = getCachedWalletAddress();
  if (!walletAddress) throw new Error("Note store not initialized");
  const storageKey = getStorageKey(STORAGE_PREFIX, walletAddress);
  const raw = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
  if (!raw) return "";
  return raw;
}

export async function importNotes(backup: string): Promise<StoredNote[]> {
  const walletAddress = getCachedWalletAddress();
  if (!walletAddress) throw new Error("Note store not initialized");
  const parsed: EncryptedNoteStore = JSON.parse(backup);
  const notes = await decryptData<StoredNote[]>(parsed);
  const storageKey = getStorageKey(STORAGE_PREFIX, walletAddress);
  localStorage.setItem(storageKey, backup);
  return notes;
}

export function isStoreInitialized(walletAddress?: string): boolean {
  if (!walletAddress) return false;
  return isEncryptionStoreInitialized(STORAGE_PREFIX, walletAddress);
}

export { hasEncryptionSession as hasSessionKey };

async function loadNotes(): Promise<StoredNote[]> {
  try {
    const notes = await loadFromStore<StoredNote[]>(STORAGE_PREFIX);
    return notes ?? [];
  } catch (err: any) {
    // Re-throw decryption failures so UI can show a proper error message
    if (err?.message?.includes("DECRYPTION_FAILED")) {
      throw err;
    }
    // For other errors (missing store, corrupt JSON), start fresh
    return [];
  }
}

async function saveNotes(notes: StoredNote[]): Promise<void> {
  await saveToStore(STORAGE_PREFIX, notes);
}
