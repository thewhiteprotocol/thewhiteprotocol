/**
 * Persistent bridge watcher finding store.
 *
 * JSON file-backed and atomic, matching the bridge message state store style.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BridgePolicyAction, BridgeRiskSeverity } from './types';

const FINDINGS_FILE = 'bridge-watcher-findings.json';

export type BridgeWatcherFindingStatus =
  | 'open'
  | 'acknowledged'
  | 'ignored'
  | 'freeze_requested'
  | 'freeze_submitted'
  | 'resolved';

export interface BridgeWatcherFindingRecord {
  findingId: string;
  messageHash: string;
  route: string;
  sourceChain: string;
  destinationChain: string;
  severity: BridgeRiskSeverity;
  code: string;
  reason: string;
  recommendedAction: BridgePolicyAction;
  status: BridgeWatcherFindingStatus;
  createdAt: number;
  updatedAt: number;
  evidence: Record<string, unknown>;
  evidenceHash: string;
  dryRun: boolean;
  txHash?: string;
  lastAlertedAt?: number;
  lastAlertEvidenceHash?: string;
}

export interface UpsertWatcherFindingInput {
  messageHash: string;
  sourceChain: string;
  destinationChain: string;
  severity: BridgeRiskSeverity;
  code: string;
  reason: string;
  recommendedAction: BridgePolicyAction;
  evidence: Record<string, unknown>;
  dryRun: boolean;
  now?: number;
}

export interface BridgeWatcherCleanupResult {
  deleted: number;
  retainedOpenCritical: number;
}

function normalizeHash(hash: string): string {
  return hash.toLowerCase();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value, jsonReplacer);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function evidenceFingerprint(evidence: Record<string, unknown>): string {
  let hash = 0;
  const input = stableStringify(evidence);
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function makeFindingId(messageHash: string, code: string): string {
  const normalized = normalizeHash(messageHash).replace(/^0x/, '');
  const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${normalized}:${safeCode}`;
}

export class BridgeWatcherFindingStore {
  private readonly filePath: string;

  constructor(stateDir: string, options: { findingsPath?: string } = {}) {
    this.filePath = options.findingsPath || path.join(stateDir, FINDINGS_FILE);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): Record<string, BridgeWatcherFindingRecord> {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Record<
        string,
        BridgeWatcherFindingRecord
      >;
    } catch {
      return {};
    }
  }

  private save(state: Record<string, BridgeWatcherFindingRecord>): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, jsonReplacer, 2));
    fs.renameSync(tmp, this.filePath);
  }

  get(findingId: string): BridgeWatcherFindingRecord | undefined {
    return this.load()[findingId];
  }

  list(filter: Partial<Pick<BridgeWatcherFindingRecord, 'status' | 'severity' | 'messageHash'>> = {}): BridgeWatcherFindingRecord[] {
    return Object.values(this.load())
      .filter((finding) => {
        if (filter.status && finding.status !== filter.status) return false;
        if (filter.severity && finding.severity !== filter.severity) return false;
        if (filter.messageHash && normalizeHash(finding.messageHash) !== normalizeHash(filter.messageHash)) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  upsert(input: UpsertWatcherFindingInput): BridgeWatcherFindingRecord {
    const state = this.load();
    const findingId = makeFindingId(input.messageHash, input.code);
    const existing = state[findingId];
    const now = input.now ?? Date.now();
    const evidenceHash = evidenceFingerprint(input.evidence);

    if (
      existing &&
      existing.evidenceHash === evidenceHash &&
      (existing.status === 'acknowledged' ||
        existing.status === 'ignored' ||
        existing.status === 'resolved')
    ) {
      return existing;
    }

    const status: BridgeWatcherFindingStatus =
      existing && existing.evidenceHash !== evidenceHash ? 'open' : existing?.status ?? 'open';

    const record: BridgeWatcherFindingRecord = {
      findingId,
      messageHash: normalizeHash(input.messageHash),
      route: `${input.sourceChain}->${input.destinationChain}`,
      sourceChain: input.sourceChain,
      destinationChain: input.destinationChain,
      severity: input.severity,
      code: input.code,
      reason: input.reason,
      recommendedAction: input.recommendedAction,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing && existing.evidenceHash === evidenceHash ? existing.updatedAt : now,
      evidence: input.evidence,
      evidenceHash,
      dryRun: input.dryRun,
      txHash: existing?.txHash,
      lastAlertedAt: existing?.lastAlertedAt,
      lastAlertEvidenceHash: existing?.lastAlertEvidenceHash,
    };

    state[findingId] = record;
    this.save(state);
    return record;
  }

  updateStatus(
    findingId: string,
    status: BridgeWatcherFindingStatus,
    patch: Partial<Pick<BridgeWatcherFindingRecord, 'txHash' | 'dryRun' | 'evidence'>> & {
      now?: number;
    } = {}
  ): BridgeWatcherFindingRecord {
    const state = this.load();
    const existing = state[findingId];
    if (!existing) {
      throw new Error(`Watcher finding not found: ${findingId}`);
    }
    const { now, ...recordPatch } = patch;
    const evidence = recordPatch.evidence ?? existing.evidence;
    const updated: BridgeWatcherFindingRecord = {
      ...existing,
      ...recordPatch,
      status,
      evidence,
      evidenceHash: evidenceFingerprint(evidence),
      updatedAt: now ?? Date.now(),
    };
    state[findingId] = updated;
    this.save(state);
    return updated;
  }

  acknowledge(findingId: string): BridgeWatcherFindingRecord {
    return this.updateStatus(findingId, 'acknowledged');
  }

  ignore(findingId: string): BridgeWatcherFindingRecord {
    return this.updateStatus(findingId, 'ignored');
  }

  markAlerted(findingId: string, now: number = Date.now()): BridgeWatcherFindingRecord {
    const state = this.load();
    const existing = state[findingId];
    if (!existing) {
      throw new Error(`Watcher finding not found: ${findingId}`);
    }
    const updated: BridgeWatcherFindingRecord = {
      ...existing,
      lastAlertedAt: now,
      lastAlertEvidenceHash: existing.evidenceHash,
      updatedAt: now,
    };
    state[findingId] = updated;
    this.save(state);
    return updated;
  }

  cleanup(retentionDays: number, now: number = Date.now()): BridgeWatcherCleanupResult {
    const state = this.load();
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    let retainedOpenCritical = 0;

    for (const [findingId, finding] of Object.entries(state)) {
      if (finding.status === 'open' && finding.severity === 'critical') {
        retainedOpenCritical += 1;
        continue;
      }
      const canDelete = finding.status === 'resolved' || finding.status === 'ignored';
      if (canDelete && finding.updatedAt < cutoff) {
        delete state[findingId];
        deleted += 1;
      }
    }

    if (deleted > 0) {
      this.save(state);
    }

    return { deleted, retainedOpenCritical };
  }

  clear(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }
}
