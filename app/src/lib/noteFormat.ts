"use client";

export interface DecodedNote {
  secret: string;
  nullifier: string;
  amount: string;
  asset: string;
  chain: string;
  leafIndex?: number;
  commitment?: string;
  assetId?: string;
}

const NOTE_PREFIX = "white://note/v1/";

/** Browser-safe base64url encoding (no Buffer dependency) */
function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Browser-safe base64url decoding (no Buffer dependency) */
function decodeBase64Url(base64url: string): string {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad === 2) base64 += "==";
  else if (pad === 3) base64 += "=";
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeNote(note: DecodedNote): string {
  return `${NOTE_PREFIX}${encodeBase64Url(JSON.stringify(note))}`;
}

export function decodeNote(noteString: string): DecodedNote | null {
  try {
    const trimmed = noteString.trim();
    if (trimmed.startsWith(NOTE_PREFIX)) {
      const data = trimmed.slice(NOTE_PREFIX.length);
      return JSON.parse(decodeBase64Url(data));
    }
    // Try raw JSON
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function isValidNoteString(noteString: string): boolean {
  return decodeNote(noteString) !== null;
}

export function downloadNoteFile(note: DecodedNote, filename?: string) {
  const blob = new Blob([JSON.stringify(note, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `white-protocol-note-${note.chain}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadAllNotesFile(notes: DecodedNote[]) {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    notes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `white-protocol-notes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
