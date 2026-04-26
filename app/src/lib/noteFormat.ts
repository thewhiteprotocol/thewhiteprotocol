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

export function encodeNote(note: DecodedNote): string {
  const data = Buffer.from(JSON.stringify(note)).toString("base64url");
  return `${NOTE_PREFIX}${data}`;
}

export function decodeNote(noteString: string): DecodedNote | null {
  try {
    const trimmed = noteString.trim();
    if (trimmed.startsWith(NOTE_PREFIX)) {
      const data = trimmed.replace(NOTE_PREFIX, "");
      return JSON.parse(Buffer.from(data, "base64url").toString());
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
