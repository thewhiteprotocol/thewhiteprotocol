/**
 * Non-secret leaf-index evidence for hosted Base -> Solana recovery.
 *
 * This command is read-only. It never submits transactions, generates proofs,
 * settles, withdraws, or prints note secrets.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import type { HostedSettleWithdrawPreflight } from "./hosted-settle-withdraw-preflight";
import { jobIndexPathFor, type OperatorJobIndex } from "./hosted-settle-withdraw-job";

const DEFAULT_RESULT_DIR = "/data/bridge-results";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type LeafIndexEvidenceSource =
  | "settlement_result"
  | "settlement_tx_logs"
  | "pre_settlement_snapshot"
  | "manual_operator_review";

export type LeafIndexEvidence = {
  destinationMessageHash: string;
  sourceMessageHash: string | null;
  destinationCommitment: string;
  settlementTx: string | null;
  leafIndex: number;
  pendingIndexBeforeSettlement: number | null;
  merkleNextLeafIndexBefore: number | null;
  merkleNextLeafIndexAfter: number | null;
  rootBefore: string | null;
  rootAfter: string | null;
  evidenceSource: LeafIndexEvidenceSource;
  createdAt: string;
  evidenceSha256?: string | null;
};

export type LeafIndexEvidenceResult = {
  ok: boolean;
  status: "leaf_index_evidence_written" | "leaf_index_evidence_ready" | "blocked_leaf_index_evidence_missing";
  evidencePath: string | null;
  evidenceSha256: string | null;
  evidence: LeafIndexEvidence | null;
  errors: string[];
  transactionsSubmitted: false;
  proofsGenerated: false;
  secretsPrinted: false;
};

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeCommitmentHex(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" || typeof value === "bigint") {
    return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed.toLowerCase()}`;
  if (/^[0-9]+$/.test(trimmed)) return `0x${BigInt(trimmed).toString(16).padStart(64, "0")}`;
  return null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n) return Number(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  return null;
}

function resultDir(env: Env): string {
  return path.resolve(env.BRIDGE_RESULTS_DIR || env.PR012G_PREFLIGHT_RESULT_DIR || DEFAULT_RESULT_DIR);
}

export function leafIndexEvidencePathFor(destinationHash: string, env: Env = process.env): string {
  if (env.BRIDGE_LEAF_INDEX_EVIDENCE_PATH) return path.resolve(env.BRIDGE_LEAF_INDEX_EVIDENCE_PATH);
  return path.join(resultDir(env), `leaf-index-${destinationHash.slice(2)}.json`);
}

function defaultPreflightPath(destinationHash: string, env: Env): string {
  if (env.BRIDGE_PREFLIGHT_REPORT_PATH) return path.resolve(env.BRIDGE_PREFLIGHT_REPORT_PATH);
  return path.join(resultDir(env), `preflight-${destinationHash.slice(2)}.json`);
}

function defaultResultPath(destinationHash: string, env: Env): string {
  if (env.BRIDGE_SETTLE_WITHDRAW_RESULT_PATH) return path.resolve(env.BRIDGE_SETTLE_WITHDRAW_RESULT_PATH);
  if (env.PR012B_RESULT_PATH) return path.resolve(env.PR012B_RESULT_PATH);
  return path.join(resultDir(env), `settle-withdraw-${destinationHash.slice(2)}.json`);
}

function readJson<T>(filePath: string | null | undefined): T | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function evidenceHash(evidence: LeafIndexEvidence): string {
  const copy = { ...evidence, evidenceSha256: null };
  return createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

function ensureNoSecretsRendered(value: unknown): void {
  const rendered = JSON.stringify(value);
  for (const sentinel of ["destSecret", "destNullifier", "privateKey", "mnemonic", "seedPhrase", "witness"]) {
    if (rendered.includes(sentinel)) throw new Error(`leaf_index_evidence_contains_sensitive_field:${sentinel}`);
  }
}

function latestResultPathFromJobIndex(destinationHash: string, env: Env): string | null {
  const index = readJson<OperatorJobIndex>(jobIndexPathFor(env));
  if (!index?.jobs) return null;
  const job = [...index.jobs]
    .reverse()
    .find((entry) => entry.destinationMessageHash?.toLowerCase() === destinationHash.toLowerCase() && entry.resultReportPath);
  return job?.resultReportPath || null;
}

function evidenceFromSettlementResult(input: {
  destinationHash: string;
  sourceHash: string | null;
  expectedCommitment: string | null;
  resultPath: string;
  nowIso: string;
}): { evidence: LeafIndexEvidence | null; errors: string[] } {
  const errors: string[] = [];
  const result = readJson<any>(input.resultPath);
  const evidence = result?.verifyResult?.evidence || result?.evidence;
  if (!evidence) return { evidence: null, errors: ["settlement_result_missing_evidence"] };

  const destinationMessageHash = normalizeHash(evidence.destinationBridgeMintHash);
  const sourceMessageHash = normalizeHash(evidence.sourceBridgeOutHash);
  const destinationCommitment = normalizeCommitmentHex(evidence.destinationCommitment);
  const leafIndex = normalizeNumber(evidence.nextLeafIndexBefore);
  if (destinationMessageHash !== input.destinationHash) errors.push("destination_hash_mismatch");
  if (input.sourceHash && sourceMessageHash && sourceMessageHash !== input.sourceHash) errors.push("source_hash_mismatch");
  if (input.expectedCommitment && destinationCommitment && destinationCommitment !== input.expectedCommitment) {
    errors.push("destination_commitment_mismatch");
  }
  if (leafIndex === null) errors.push("leaf_index_missing");
  if (!destinationCommitment) errors.push("destination_commitment_missing");
  if (errors.length > 0 || leafIndex === null || !destinationCommitment) return { evidence: null, errors };

  const after = normalizeNumber(evidence.nextLeafIndexAfter);
  return {
    evidence: {
      destinationMessageHash: input.destinationHash,
      sourceMessageHash: sourceMessageHash || input.sourceHash,
      destinationCommitment,
      settlementTx: typeof evidence.settleTx === "string" ? evidence.settleTx : null,
      leafIndex,
      pendingIndexBeforeSettlement: normalizeNumber(evidence.pendingBeforeTargetSettle),
      merkleNextLeafIndexBefore: leafIndex,
      merkleNextLeafIndexAfter: after,
      rootBefore: typeof evidence.oldRoot === "string" ? evidence.oldRoot : null,
      rootAfter: typeof evidence.newRoot === "string" ? evidence.newRoot : null,
      evidenceSource: "settlement_result",
      createdAt: input.nowIso,
      evidenceSha256: null,
    },
    errors: [],
  };
}

function evidenceFromPreSettlementSnapshot(input: {
  destinationHash: string;
  sourceHash: string | null;
  expectedCommitment: string | null;
  preflightPath: string;
  nowIso: string;
}): { evidence: LeafIndexEvidence | null; errors: string[] } {
  const report = readJson<HostedSettleWithdrawPreflight>(input.preflightPath);
  if (!report) return { evidence: null, errors: ["preflight_missing"] };
  const errors: string[] = [];
  const destinationHash = normalizeHash(report.destinationBridgeMintHash);
  const sourceHash = normalizeHash(report.sourceBridgeOutHash);
  const destinationCommitment = normalizeCommitmentHex(report.destinationCommitment);
  if (destinationHash !== input.destinationHash) errors.push("destination_hash_mismatch");
  if (input.sourceHash && sourceHash && sourceHash !== input.sourceHash) errors.push("source_hash_mismatch");
  if (input.expectedCommitment && destinationCommitment && destinationCommitment !== input.expectedCommitment) {
    errors.push("destination_commitment_mismatch");
  }
  if (report.pending.status !== "ready" && report.pending.status !== "requires_fifo_prefix") {
    errors.push("preflight_not_pre_settlement");
  }
  if (report.pending.targetPendingIndex === null || report.pending.nextLeafIndex === null) {
    errors.push("pre_settlement_leaf_inputs_missing");
  }
  if (!destinationCommitment) errors.push("destination_commitment_missing");
  if (
    errors.length > 0 ||
    !destinationCommitment ||
    report.pending.targetPendingIndex === null ||
    report.pending.nextLeafIndex === null
  ) {
    return { evidence: null, errors };
  }
  const leafIndex = report.pending.nextLeafIndex + report.pending.targetPendingIndex;
  return {
    evidence: {
      destinationMessageHash: input.destinationHash,
      sourceMessageHash: sourceHash || input.sourceHash,
      destinationCommitment,
      settlementTx: null,
      leafIndex,
      pendingIndexBeforeSettlement: report.pending.targetPendingIndex,
      merkleNextLeafIndexBefore: report.pending.nextLeafIndex,
      merkleNextLeafIndexAfter: null,
      rootBefore: report.pending.currentMerkleRoot,
      rootAfter: null,
      evidenceSource: "pre_settlement_snapshot",
      createdAt: input.nowIso,
      evidenceSha256: null,
    },
    errors: [],
  };
}

function evidenceFromManualReview(input: {
  destinationHash: string;
  sourceHash: string | null;
  expectedCommitment: string | null;
  env: Env;
  nowIso: string;
}): { evidence: LeafIndexEvidence | null; errors: string[] } {
  if (input.env.BRIDGE_LEAF_INDEX_MANUAL_REVIEW !== "true") {
    return { evidence: null, errors: ["manual_operator_review_not_enabled"] };
  }
  const leafIndex = normalizeNumber(input.env.BRIDGE_LEAF_INDEX);
  const destinationCommitment = normalizeCommitmentHex(input.env.BRIDGE_LEAF_INDEX_DESTINATION_COMMITMENT || input.expectedCommitment);
  const destinationHash = normalizeHash(input.env.BRIDGE_LEAF_INDEX_DESTINATION_HASH || input.destinationHash);
  const sourceHash = normalizeHash(input.env.BRIDGE_LEAF_INDEX_SOURCE_HASH || input.sourceHash);
  const errors: string[] = [];
  if (destinationHash !== input.destinationHash) errors.push("destination_hash_mismatch");
  if (input.sourceHash && sourceHash && sourceHash !== input.sourceHash) errors.push("source_hash_mismatch");
  if (input.expectedCommitment && destinationCommitment && destinationCommitment !== input.expectedCommitment) {
    errors.push("destination_commitment_mismatch");
  }
  if (leafIndex === null) errors.push("leaf_index_missing");
  if (!destinationCommitment) errors.push("destination_commitment_missing");
  if (errors.length > 0 || leafIndex === null || !destinationCommitment) return { evidence: null, errors };
  return {
    evidence: {
      destinationMessageHash: input.destinationHash,
      sourceMessageHash: sourceHash || input.sourceHash,
      destinationCommitment,
      settlementTx: input.env.PR012B_SETTLEMENT_TX || null,
      leafIndex,
      pendingIndexBeforeSettlement: normalizeNumber(input.env.BRIDGE_LEAF_INDEX_PENDING_INDEX_BEFORE),
      merkleNextLeafIndexBefore: normalizeNumber(input.env.BRIDGE_LEAF_INDEX_MERKLE_NEXT_BEFORE),
      merkleNextLeafIndexAfter: normalizeNumber(input.env.BRIDGE_LEAF_INDEX_MERKLE_NEXT_AFTER),
      rootBefore: typeof input.env.BRIDGE_LEAF_INDEX_ROOT_BEFORE === "string" ? input.env.BRIDGE_LEAF_INDEX_ROOT_BEFORE : null,
      rootAfter: typeof input.env.BRIDGE_LEAF_INDEX_ROOT_AFTER === "string" ? input.env.BRIDGE_LEAF_INDEX_ROOT_AFTER : null,
      evidenceSource: "manual_operator_review",
      createdAt: input.nowIso,
      evidenceSha256: null,
    },
    errors: [],
  };
}

function finalizeEvidence(evidence: LeafIndexEvidence): LeafIndexEvidence {
  const finalized = { ...evidence, evidenceSha256: null };
  finalized.evidenceSha256 = evidenceHash(finalized);
  return finalized;
}

export function validateLeafIndexEvidence(input: {
  evidence: LeafIndexEvidence | null;
  destinationHash: string;
  sourceHash?: string | null;
  destinationCommitment?: string | null;
}): string[] {
  const errors: string[] = [];
  if (!input.evidence) return ["leaf_index_evidence_missing"];
  if (normalizeHash(input.evidence.destinationMessageHash) !== input.destinationHash.toLowerCase()) {
    errors.push("leaf_index_destination_hash_mismatch");
  }
  if (
    input.sourceHash &&
    input.evidence.sourceMessageHash &&
    normalizeHash(input.evidence.sourceMessageHash) !== input.sourceHash.toLowerCase()
  ) {
    errors.push("leaf_index_source_hash_mismatch");
  }
  const expectedCommitment = normalizeCommitmentHex(input.destinationCommitment);
  if (
    expectedCommitment &&
    normalizeCommitmentHex(input.evidence.destinationCommitment) !== expectedCommitment
  ) {
    errors.push("leaf_index_destination_commitment_mismatch");
  }
  if (!Number.isInteger(input.evidence.leafIndex) || input.evidence.leafIndex < 0) {
    errors.push("leaf_index_invalid");
  }
  if (!input.evidence.evidenceSource) errors.push("leaf_index_evidence_source_missing");
  return errors;
}

export function readLeafIndexEvidence(input: {
  destinationHash: string;
  env?: Env;
  sourceHash?: string | null;
  destinationCommitment?: string | null;
}): { path: string; sha256: string | null; evidence: LeafIndexEvidence | null; errors: string[] } {
  const env = input.env || process.env;
  const evidencePath = leafIndexEvidencePathFor(input.destinationHash, env);
  const evidence = readJson<LeafIndexEvidence>(evidencePath);
  const sha256 = evidence && fs.existsSync(evidencePath) ? sha256File(evidencePath) : null;
  const errors = validateLeafIndexEvidence({
    evidence,
    destinationHash: input.destinationHash,
    sourceHash: input.sourceHash,
    destinationCommitment: input.destinationCommitment,
  });
  return { path: evidencePath, sha256, evidence: errors.length === 0 ? evidence : null, errors };
}

export function buildLeafIndexEvidence(input: {
  env?: Env;
  nowMs?: number;
} = {}): LeafIndexEvidenceResult {
  const env = input.env || process.env;
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  const destinationHash = normalizeHash(env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_DESTINATION_MESSAGE_HASH);
  const sourceHash = normalizeHash(env.PR012B_SOURCE_MESSAGE_HASH || env.BRIDGE_SOURCE_MESSAGE_HASH);
  const expectedCommitment = normalizeCommitmentHex(
    env.BRIDGE_LEAF_INDEX_DESTINATION_COMMITMENT ||
      env.BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT ||
      env.PR012B_DESTINATION_COMMITMENT
  );
  const errors: string[] = [];
  if (!destinationHash) errors.push("destination_hash_missing");
  if (!destinationHash) {
    return {
      ok: false,
      status: "blocked_leaf_index_evidence_missing",
      evidencePath: null,
      evidenceSha256: null,
      evidence: null,
      errors,
      transactionsSubmitted: false,
      proofsGenerated: false,
      secretsPrinted: false,
    };
  }

  const candidates: Array<{ evidence: LeafIndexEvidence | null; errors: string[] }> = [];
  const resultPaths = [
    defaultResultPath(destinationHash, env),
    latestResultPathFromJobIndex(destinationHash, env),
  ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
  for (const resultPath of resultPaths) {
    candidates.push(evidenceFromSettlementResult({
      destinationHash,
      sourceHash,
      expectedCommitment,
      resultPath,
      nowIso,
    }));
  }
  candidates.push(evidenceFromPreSettlementSnapshot({
    destinationHash,
    sourceHash,
    expectedCommitment,
    preflightPath: defaultPreflightPath(destinationHash, env),
    nowIso,
  }));
  candidates.push(evidenceFromManualReview({
    destinationHash,
    sourceHash,
    expectedCommitment,
    env,
    nowIso,
  }));

  const selected = candidates.find((candidate) => candidate.evidence);
  if (!selected?.evidence) {
    const blockedErrors = [...new Set(candidates.flatMap((candidate) => candidate.errors))];
    return {
      ok: false,
      status: "blocked_leaf_index_evidence_missing",
      evidencePath: leafIndexEvidencePathFor(destinationHash, env),
      evidenceSha256: null,
      evidence: null,
      errors: blockedErrors.length > 0 ? blockedErrors : ["leaf_index_evidence_missing"],
      transactionsSubmitted: false,
      proofsGenerated: false,
      secretsPrinted: false,
    };
  }

  const evidence = finalizeEvidence(selected.evidence);
  const evidencePath = leafIndexEvidencePathFor(destinationHash, env);
  const validationErrors = validateLeafIndexEvidence({
    evidence,
    destinationHash,
    sourceHash,
    destinationCommitment: expectedCommitment,
  });
  if (validationErrors.length > 0) {
    return {
      ok: false,
      status: "blocked_leaf_index_evidence_missing",
      evidencePath,
      evidenceSha256: null,
      evidence: null,
      errors: validationErrors,
      transactionsSubmitted: false,
      proofsGenerated: false,
      secretsPrinted: false,
    };
  }
  ensureNoSecretsRendered(evidence);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  return {
    ok: true,
    status: "leaf_index_evidence_written",
    evidencePath,
    evidenceSha256: sha256File(evidencePath),
    evidence,
    errors: [],
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
  };
}

async function main(): Promise<void> {
  const result = buildLeafIndexEvidence();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
