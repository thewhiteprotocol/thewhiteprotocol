/**
 * Simple JSON file-based state store for the relayer.
 * Persists critical in-memory state across restarts.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface RelayerState {
  totalTransactions: number;
  totalFeesEarned: string;
  supportedAssets: string[];
}

export interface MerkleTreeState {
  leaves: string[];
}

const STATE_DIR = process.env.STATE_DIR || path.join(process.cwd(), 'data');
const RELAYER_STATE_PATH = path.join(STATE_DIR, 'relayer-state.json');
const MERKLE_STATE_PATH = path.join(STATE_DIR, 'merkle-tree-state.json');

function ensureDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

export function loadRelayerState(): RelayerState | null {
  try {
    if (!fs.existsSync(RELAYER_STATE_PATH)) return null;
    const raw = fs.readFileSync(RELAYER_STATE_PATH, 'utf8');
    return JSON.parse(raw) as RelayerState;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[StateStore] Failed to load relayer state:', err);
    return null;
  }
}

export function saveRelayerState(state: RelayerState): void {
  ensureDir();
  fs.writeFileSync(RELAYER_STATE_PATH, JSON.stringify(state, null, 2));
}

export function loadMerkleTreeState(): MerkleTreeState | null {
  try {
    if (!fs.existsSync(MERKLE_STATE_PATH)) return null;
    const raw = fs.readFileSync(MERKLE_STATE_PATH, 'utf8');
    return JSON.parse(raw) as MerkleTreeState;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[StateStore] Failed to load merkle tree state:', err);
    return null;
  }
}

export function saveMerkleTreeState(state: MerkleTreeState): void {
  ensureDir();
  fs.writeFileSync(MERKLE_STATE_PATH, JSON.stringify(state, null, 2));
}
