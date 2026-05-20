/**
 * Hosted read-only operator bundle for Base -> Solana settlement/withdraw
 * readiness. This command orchestrates the existing hosted checks and exports
 * one non-secret report. It never enables execute mode.
 */

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_RESULT_DIR = "/data/bridge-results";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type OperatorBundleReadiness =
  | "ready_for_execute"
  | "no_action_already_complete"
  | "blocked_preflight"
  | "blocked_recovery_snapshot"
  | "blocked_note_state"
  | "blocked_zkeys"
  | "blocked_leaf_index"
  | "blocked_wallet"
  | "operator_review_required";

export type OperatorBundleRecommendedAction =
  | "run_bootstrap_zkeys"
  | "restore_note_state"
  | "run_preflight"
  | "run_recovery_snapshot"
  | "run_leaf_index_evidence"
  | "run_job_execute"
  | "no_action_already_complete"
  | "operator_review_required";

type CommandName = "operator_status_initial" | "preflight" | "recovery_snapshot" | "operator_status_final" | "dry_run_job";

type CommandResult = {
  name: CommandName;
  command: string;
  ok: boolean;
  exitStatus: number | null;
  parsed: Record<string, unknown> | null;
  error: string | null;
};

type Executor = (input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => { status: number | null; stdout: string; stderr: string; error?: Error };

export type HostedOperatorBundle = {
  ok: boolean;
  generatedAt: string;
  destinationMessageHash: string | null;
  sourceMessageHash: string | null;
  initialOperatorReadiness: string | null;
  refreshedPreflight: {
    ok: boolean;
    readiness: string | null;
    reportPath: string | null;
    sha256: string | null;
  };
  recoverySnapshot: {
    ok: boolean;
    readiness: string | null;
    recommendedAction: string | null;
    reportPath: string | null;
    sha256: string | null;
  };
  spentPda: {
    derived: boolean | null;
    exists: boolean | null;
    status: string | null;
    withdrawAlreadyConsumed: boolean | null;
  };
  leafIndexEvidence: {
    found: boolean | null;
    path: string | null;
    sha256: string | null;
    source: string | null;
    leafIndex: number | null;
  };
  finalOperatorReadiness: string | null;
  dryRunJob: {
    ok: boolean;
    status: string | null;
    readiness: string | null;
    wouldExecute: boolean;
    execute: boolean;
    jobId: string | null;
  };
  final: {
    readiness: OperatorBundleReadiness;
    recommendedAction: OperatorBundleRecommendedAction;
    executionAllowed: boolean;
    alreadyComplete: boolean;
  };
  commands: CommandResult[];
  errors: string[];
  reportPath: string | null;
  transactionsSubmitted: false;
  proofsGenerated: false;
  secretsPrinted: false;
};

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function resultDir(env: Env): string {
  return path.resolve(env.BRIDGE_RESULTS_DIR || env.PR012G_PREFLIGHT_RESULT_DIR || DEFAULT_RESULT_DIR);
}

function bundleReportPath(destinationHash: string, env: Env): string {
  if (env.BRIDGE_OPERATOR_BUNDLE_PATH) return path.resolve(env.BRIDGE_OPERATOR_BUNDLE_PATH);
  return path.join(resultDir(env), `operator-bundle-${destinationHash.slice(2)}.json`);
}

function sha256File(filePath: string | null): string | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getString(value: Record<string, unknown> | null, key: string): string | null {
  const found = value?.[key];
  return typeof found === "string" ? found : null;
}

function getBool(value: Record<string, unknown> | null, key: string): boolean | null {
  const found = value?.[key];
  return typeof found === "boolean" ? found : null;
}

function getRecord(value: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  const found = value?.[key];
  return found && typeof found === "object" && !Array.isArray(found) ? found as Record<string, unknown> : null;
}

function parseJsonObject(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    return null;
  }
}

function redactParsed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactParsed);
  if (!value || typeof value !== "object") return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "destsecret" ||
      normalized === "destnullifier" ||
      normalized === "privatekey" ||
      normalized === "mnemonic" ||
      normalized === "seedphrase" ||
      normalized === "operatortoken" ||
      normalized.endsWith("rpcurl") ||
      normalized.endsWith("keypair")
    ) {
      continue;
    }
    redacted[key] = redactParsed(nested);
  }
  return redacted;
}

function defaultExecutor(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}): { status: number | null; stdout: string; stderr: string; error?: Error } {
  return spawnSync(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runNpmStep(input: {
  name: CommandName;
  script: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  executor: Executor;
}): CommandResult {
  const args = ["--silent", "run", input.script];
  const result = input.executor({ command: "npm", args, cwd: input.cwd, env: input.env });
  const parsed = redactParsed(parseJsonObject(result.stdout)) as Record<string, unknown> | null;
  return {
    name: input.name,
    command: `npm --silent run ${input.script}`,
    ok: result.status === 0 && Boolean(parsed),
    exitStatus: result.status,
    parsed,
    error: result.error ? result.error.message : parsed ? null : "json_output_missing",
  };
}

function preflightPathFrom(parsed: Record<string, unknown> | null): string | null {
  return getString(parsed, "reportPath");
}

function recoveryPathFrom(parsed: Record<string, unknown> | null): string | null {
  return getString(parsed, "reportPath");
}

function hasSubmittedTransactions(commands: CommandResult[]): boolean {
  return commands.some((command) => {
    const parsed = command.parsed;
    return getBool(parsed, "transactionsSubmitted") === true || getBool(parsed, "transactionsSubmittedByWrapper") === true;
  });
}

function hasPrintedSecrets(commands: CommandResult[]): boolean {
  return commands.some((command) => getBool(command.parsed, "secretsPrinted") === true);
}

function mapFinalReadiness(input: {
  safeModeError: string | null;
  initial: Record<string, unknown> | null;
  preflight: CommandResult | null;
  recovery: CommandResult | null;
  finalStatus: Record<string, unknown> | null;
  dryRun: CommandResult | null;
}): { readiness: OperatorBundleReadiness; recommendedAction: OperatorBundleRecommendedAction; executionAllowed: boolean; alreadyComplete: boolean } {
  if (input.safeModeError) {
    return {
      readiness: "operator_review_required",
      recommendedAction: "operator_review_required",
      executionAllowed: false,
      alreadyComplete: false,
    };
  }

  const recoveryReadiness = getString(input.recovery?.parsed || null, "readiness");
  const recoveryAction = getString(input.recovery?.parsed || null, "recommendedAction");
  const spent = getRecord(input.recovery?.parsed || null, "spentNullifier");
  const spentExists = getBool(spent, "exists");
  const alreadyWithdrawn = getBool(spent, "withdrawAlreadyConsumed") === true || recoveryReadiness === "already_withdrawn_spent_nullifier";
  if (alreadyWithdrawn) {
    return {
      readiness: "no_action_already_complete",
      recommendedAction: "no_action_already_complete",
      executionAllowed: false,
      alreadyComplete: true,
    };
  }

  if (!input.preflight?.ok) {
    return { readiness: "blocked_preflight", recommendedAction: "run_preflight", executionAllowed: false, alreadyComplete: false };
  }
  if (!input.recovery?.ok) {
    return {
      readiness: "blocked_recovery_snapshot",
      recommendedAction: "run_recovery_snapshot",
      executionAllowed: false,
      alreadyComplete: false,
    };
  }

  const final = getRecord(input.finalStatus, "final");
  const finalReadiness = getString(final, "readiness");
  if (finalReadiness === "blocked_zkeys") {
    return { readiness: "blocked_zkeys", recommendedAction: "run_bootstrap_zkeys", executionAllowed: false, alreadyComplete: false };
  }
  if (finalReadiness === "blocked_note_state") {
    return { readiness: "blocked_note_state", recommendedAction: "restore_note_state", executionAllowed: false, alreadyComplete: false };
  }
  if (finalReadiness === "blocked_leaf_index_missing") {
    return {
      readiness: "blocked_leaf_index",
      recommendedAction: "run_leaf_index_evidence",
      executionAllowed: false,
      alreadyComplete: false,
    };
  }
  if (finalReadiness === "blocked_preflight_missing" || finalReadiness === "blocked_preflight_stale") {
    return { readiness: "blocked_preflight", recommendedAction: "run_preflight", executionAllowed: false, alreadyComplete: false };
  }
  if (finalReadiness === "blocked_recovery_missing" || finalReadiness === "blocked_recovery_stale") {
    return {
      readiness: "blocked_recovery_snapshot",
      recommendedAction: "run_recovery_snapshot",
      executionAllowed: false,
      alreadyComplete: false,
    };
  }
  if (finalReadiness === "already_complete") {
    return {
      readiness: "no_action_already_complete",
      recommendedAction: "no_action_already_complete",
      executionAllowed: false,
      alreadyComplete: true,
    };
  }

  const jobStatus = getString(input.dryRun?.parsed || null, "status");
  if (finalReadiness === "ready_for_execute" && jobStatus === "dry_run_ready") {
    return {
      readiness: "ready_for_execute",
      recommendedAction: recoveryAction === "no_action_already_complete" ? "no_action_already_complete" : "run_job_execute",
      executionAllowed: true,
      alreadyComplete: false,
    };
  }

  if (getString(input.dryRun?.parsed || null, "readiness") === "blocked_wallet") {
    return { readiness: "blocked_wallet", recommendedAction: "operator_review_required", executionAllowed: false, alreadyComplete: false };
  }

  if (spentExists === false && recoveryReadiness === "ready_for_resume") {
    return {
      readiness: jobStatus === "dry_run_ready" ? "ready_for_execute" : "operator_review_required",
      recommendedAction: jobStatus === "dry_run_ready" ? "run_job_execute" : "operator_review_required",
      executionAllowed: jobStatus === "dry_run_ready",
      alreadyComplete: false,
    };
  }

  return {
    readiness: "operator_review_required",
    recommendedAction: "operator_review_required",
    executionAllowed: false,
    alreadyComplete: false,
  };
}

function assertNoSecretFields(report: HostedOperatorBundle): void {
  const rendered = JSON.stringify(report);
  for (const sentinel of [
    "destSecret",
    "destNullifier",
    "privateKey",
    "mnemonic",
    "seedPhrase",
    "witness",
    "operatorToken",
    "RPC_URL",
    "SOLANA_POOL_AUTHORITY_KEYPAIR",
  ]) {
    if (rendered.includes(sentinel)) throw new Error(`operator_bundle_contains_sensitive_field:${sentinel}`);
  }
}

export async function runOperatorBundle(input: {
  env?: Env;
  cwd?: string;
  executor?: Executor;
  nowMs?: number;
  writeReport?: boolean;
} = {}): Promise<HostedOperatorBundle> {
  const env = input.env || process.env;
  const cwd = input.cwd || process.cwd();
  const executor = input.executor || defaultExecutor;
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const destinationHash = normalizeHash(env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_DESTINATION_MESSAGE_HASH);
  const sourceHash = normalizeHash(env.PR012B_SOURCE_MESSAGE_HASH || env.BRIDGE_SOURCE_MESSAGE_HASH);
  const commands: CommandResult[] = [];
  const errors: string[] = [];

  const safetyErrors: string[] = [];
  if (env.BRIDGE_DAEMON_MODE !== "paper") safetyErrors.push("daemon_mode_not_paper");
  if (env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === "true") safetyErrors.push("live_submit_enabled");
  if (env.BRIDGE_SETTLE_WITHDRAW_EXECUTE === "true") safetyErrors.push("execute_flag_enabled");
  errors.push(...safetyErrors);

  const nodeEnv = { ...process.env, ...env } as NodeJS.ProcessEnv;

  if (safetyErrors.length === 0) {
    commands.push(runNpmStep({
      name: "operator_status_initial",
      script: "bridge:operator:status",
      cwd,
      env: { ...nodeEnv, BRIDGE_SETTLE_WITHDRAW_EXECUTE: "false" },
      executor,
    }));
    commands.push(runNpmStep({
      name: "preflight",
      script: "bridge:preflight:settle-withdraw",
      cwd,
      env: { ...nodeEnv, BRIDGE_SETTLE_WITHDRAW_EXECUTE: "false" },
      executor,
    }));
    commands.push(runNpmStep({
      name: "recovery_snapshot",
      script: "bridge:recovery:snapshot",
      cwd,
      env: { ...nodeEnv, BRIDGE_SETTLE_WITHDRAW_EXECUTE: "false" },
      executor,
    }));
    commands.push(runNpmStep({
      name: "operator_status_final",
      script: "bridge:operator:status",
      cwd,
      env: { ...nodeEnv, BRIDGE_SETTLE_WITHDRAW_EXECUTE: "false" },
      executor,
    }));
    commands.push(runNpmStep({
      name: "dry_run_job",
      script: "bridge:job:settle-withdraw",
      cwd,
      env: { ...nodeEnv, BRIDGE_SETTLE_WITHDRAW_EXECUTE: "false" },
      executor,
    }));
  }

  const initial = commands.find((command) => command.name === "operator_status_initial")?.parsed || null;
  const preflight = commands.find((command) => command.name === "preflight") || null;
  const recovery = commands.find((command) => command.name === "recovery_snapshot") || null;
  const finalStatus = commands.find((command) => command.name === "operator_status_final")?.parsed || null;
  const dryRun = commands.find((command) => command.name === "dry_run_job") || null;
  const preflightReportPath = preflightPathFrom(preflight?.parsed || null);
  const recoveryReportPath = recoveryPathFrom(recovery?.parsed || null);
  const spent = getRecord(recovery?.parsed || null, "spentNullifier");
  const leaf = getRecord(recovery?.parsed || null, "leafIndexEvidence") || getRecord(finalStatus, "leafIndex");
  const final = mapFinalReadiness({
    safeModeError: safetyErrors[0] || null,
    initial,
    preflight,
    recovery,
    finalStatus,
    dryRun,
  });

  if (hasSubmittedTransactions(commands)) errors.push("unexpected_transaction_submission_reported");
  if (hasPrintedSecrets(commands)) errors.push("child_command_reported_secrets_printed");

  const report: HostedOperatorBundle = {
    ok: errors.length === 0 && (final.readiness === "ready_for_execute" || final.readiness === "no_action_already_complete"),
    generatedAt,
    destinationMessageHash: destinationHash,
    sourceMessageHash: sourceHash,
    initialOperatorReadiness: getString(getRecord(initial, "final"), "readiness"),
    refreshedPreflight: {
      ok: preflight?.ok === true && getString(preflight.parsed, "readiness") === "ready",
      readiness: getString(preflight?.parsed || null, "readiness"),
      reportPath: preflightReportPath,
      sha256: sha256File(preflightReportPath) || getString(preflight?.parsed || null, "preflightReportSha256"),
    },
    recoverySnapshot: {
      ok: recovery?.ok === true,
      readiness: getString(recovery?.parsed || null, "readiness"),
      recommendedAction: getString(recovery?.parsed || null, "recommendedAction"),
      reportPath: recoveryReportPath,
      sha256: sha256File(recoveryReportPath) || getString(dryRun?.parsed || null, "recoverySnapshotSha256"),
    },
    spentPda: {
      derived: getBool(spent, "derived"),
      exists: getBool(spent, "exists"),
      status: getString(spent, "status"),
      withdrawAlreadyConsumed: getBool(spent, "withdrawAlreadyConsumed"),
    },
    leafIndexEvidence: {
      found: getBool(leaf, "found") ?? getBool(leaf, "present"),
      path: getString(leaf, "path"),
      sha256: getString(leaf, "sha256"),
      source: getString(leaf, "source") || getString(leaf, "evidenceSource"),
      leafIndex: typeof leaf?.leafIndex === "number" ? leaf.leafIndex : null,
    },
    finalOperatorReadiness: getString(getRecord(finalStatus, "final"), "readiness"),
    dryRunJob: {
      ok: dryRun?.ok === true && getString(dryRun.parsed, "status") === "dry_run_ready",
      status: getString(dryRun?.parsed || null, "status"),
      readiness: getString(dryRun?.parsed || null, "readiness"),
      wouldExecute: getBool(dryRun?.parsed || null, "wouldExecute") === true,
      execute: getBool(dryRun?.parsed || null, "execute") === true,
      jobId: getString(dryRun?.parsed || null, "jobId"),
    },
    final,
    commands,
    errors,
    reportPath: null,
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
  };

  assertNoSecretFields(report);
  if (input.writeReport !== false && destinationHash) {
    const outputPath = bundleReportPath(destinationHash, env);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    report.reportPath = outputPath;
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  return report;
}

async function main(): Promise<void> {
  const result = await runOperatorBundle({ cwd: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
