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
const BASE_MERKLE_STATE_PATH = path.join(STATE_DIR, 'base-merkle-state.json');
const BASE_PENDING_STATE_PATH = path.join(STATE_DIR, 'base-pending-state.json');
const BASE_SETTLED_PATH = path.join(STATE_DIR, 'base-settled-commitments.json');

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

// ─── Base (EVM) state persistence ───

export interface BaseMerkleTreeState {
  leaves: string[];
}

export interface BasePendingState {
  pendingCommitments: string[];
  nextLeafIndex: number;
  lastScannedBlock: string;
  lastSyncedAt: number;
  inFlight?: {
    txHash: string;
    startIndex: number;
    batchSize: number;
    submittedAt: number;
    expectedNextIndex: number;
    commitments: string[];
  } | null;
}

export function loadBaseMerkleState(): BaseMerkleTreeState | null {
  try {
    if (!fs.existsSync(BASE_MERKLE_STATE_PATH)) return null;
    const raw = fs.readFileSync(BASE_MERKLE_STATE_PATH, 'utf8');
    return JSON.parse(raw) as BaseMerkleTreeState;
  } catch (err) {
    console.error('[StateStore] Failed to load Base merkle state:', err);
    return null;
  }
}

export function saveBaseMerkleState(state: BaseMerkleTreeState): void {
  ensureDir();
  const tmp = BASE_MERKLE_STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, BASE_MERKLE_STATE_PATH);
}

export function loadBasePendingState(): BasePendingState | null {
  try {
    if (!fs.existsSync(BASE_PENDING_STATE_PATH)) return null;
    const raw = fs.readFileSync(BASE_PENDING_STATE_PATH, 'utf8');
    return JSON.parse(raw) as BasePendingState;
  } catch (err) {
    console.error('[StateStore] Failed to load Base pending state:', err);
    return null;
  }
}

export function saveBasePendingState(state: BasePendingState): void {
  ensureDir();
  const tmp = BASE_PENDING_STATE_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, BASE_PENDING_STATE_PATH);
}

export function loadBaseSettledCommitments(): SettledCommitmentsState | null {
  try {
    if (!fs.existsSync(BASE_SETTLED_PATH)) return null;
    const raw = fs.readFileSync(BASE_SETTLED_PATH, 'utf8');
    return JSON.parse(raw) as SettledCommitmentsState;
  } catch (err) {
    console.error('[StateStore] Failed to load Base settled commitments:', err);
    return null;
  }
}

export function saveBaseSettledCommitments(state: SettledCommitmentsState): void {
  ensureDir();
  const tmp = BASE_SETTLED_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, BASE_SETTLED_PATH);
}

export function appendBaseSettledCommitment(entry: SettledCommitment): void {
  const state = loadBaseSettledCommitments() || { commitments: [] };
  state.commitments.push(entry);
  saveBaseSettledCommitments(state);
}

// ─── Per-Chain EVM state persistence ───

function getEvmMerkleStatePath(chainName: string): string {
  return path.join(STATE_DIR, `${chainName}-merkle-state.json`);
}

function getEvmPendingStatePath(chainName: string): string {
  return path.join(STATE_DIR, `${chainName}-pending-state.json`);
}

function getEvmSettledPath(chainName: string): string {
  return path.join(STATE_DIR, `${chainName}-settled-commitments.json`);
}

export function loadEvmMerkleState(chainName: string): BaseMerkleTreeState | null {
  const filePath = getEvmMerkleStatePath(chainName);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as BaseMerkleTreeState;
  } catch (err) {
    console.error(`[StateStore] Failed to load ${chainName} merkle state:`, err);
    return null;
  }
}

export function saveEvmMerkleState(chainName: string, state: BaseMerkleTreeState): void {
  ensureDir();
  const filePath = getEvmMerkleStatePath(chainName);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath);
}

export function loadEvmPendingState(chainName: string): BasePendingState | null {
  const filePath = getEvmPendingStatePath(chainName);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as BasePendingState;
  } catch (err) {
    console.error(`[StateStore] Failed to load ${chainName} pending state:`, err);
    return null;
  }
}

export function saveEvmPendingState(chainName: string, state: BasePendingState): void {
  ensureDir();
  const filePath = getEvmPendingStatePath(chainName);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath);
}

export function loadEvmSettledCommitments(chainName: string): SettledCommitmentsState | null {
  const filePath = getEvmSettledPath(chainName);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as SettledCommitmentsState;
  } catch (err) {
    console.error(`[StateStore] Failed to load ${chainName} settled commitments:`, err);
    return null;
  }
}

export function saveEvmSettledCommitments(chainName: string, state: SettledCommitmentsState): void {
  ensureDir();
  const filePath = getEvmSettledPath(chainName);
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, filePath);
}

export function appendEvmSettledCommitment(chainName: string, entry: SettledCommitment): void {
  const state = loadEvmSettledCommitments(chainName) || { commitments: [] };
  state.commitments.push(entry);
  saveEvmSettledCommitments(chainName, state);
}
