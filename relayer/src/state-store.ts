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

export interface PendingState {
  /** Pending commitments not yet settled into the Merkle tree */
  pendingCommitments: string[];
  /** Last known nextLeafIndex from on-chain Merkle tree */
  nextLeafIndex: number;
  /** Last known block height / timestamp for Solana sync */
  lastSyncedAt: number;
}

export interface SettledCommitment {
  commitment: string;
  leafIndex: number;
  settledAt: number;
  signature: string;
}

export interface SettledCommitmentsState {
  commitments: SettledCommitment[];
}

const STATE_DIR = process.env.STATE_DIR || path.join(process.cwd(), 'data');
const RELAYER_STATE_PATH = path.join(STATE_DIR, 'relayer-state.json');
const MERKLE_STATE_PATH = path.join(STATE_DIR, 'merkle-tree-state.json');
const PENDING_STATE_PATH = path.join(STATE_DIR, 'pending-state.json');
const SETTLED_COMMITMENTS_PATH = path.join(STATE_DIR, 'settled-commitments.json');

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
  const tmp = RELAYER_STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, RELAYER_STATE_PATH);
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
  const tmp = MERKLE_STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, MERKLE_STATE_PATH);
}

export function loadPendingState(): PendingState | null {
  try {
    if (!fs.existsSync(PENDING_STATE_PATH)) return null;
    const raw = fs.readFileSync(PENDING_STATE_PATH, 'utf8');
    return JSON.parse(raw) as PendingState;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[StateStore] Failed to load pending state:', err);
    return null;
  }
}

export function savePendingState(state: PendingState): void {
  ensureDir();
  const tmp = PENDING_STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, PENDING_STATE_PATH);
}

export function loadSettledCommitments(): SettledCommitmentsState | null {
  try {
    if (!fs.existsSync(SETTLED_COMMITMENTS_PATH)) return null;
    const raw = fs.readFileSync(SETTLED_COMMITMENTS_PATH, 'utf8');
    return JSON.parse(raw) as SettledCommitmentsState;
  } catch (err) {
    console.error('[StateStore] Failed to load settled commitments:', err);
    return null;
  }
}

export function saveSettledCommitments(state: SettledCommitmentsState): void {
  ensureDir();
  const tmp = SETTLED_COMMITMENTS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, SETTLED_COMMITMENTS_PATH);
}

export function appendSettledCommitment(entry: SettledCommitment): void {
  const state = loadSettledCommitments() || { commitments: [] };
  state.commitments.push(entry);
  saveSettledCommitments(state);
}
