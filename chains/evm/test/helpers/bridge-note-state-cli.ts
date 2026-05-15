import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type JsonRecord = Record<string, any>;

type Summary = {
  path: string;
  exists: boolean;
  sourceBridgeOutHash: string | null;
  destinationBridgeMintHash: string | null;
  destinationCommitment: string | null;
  amount: string | null;
  destinationAmount: string | null;
  assetId: string | null;
  hasDestSecret: boolean;
  hasDestNullifier: boolean;
  hasWitness: boolean;
  hasPrivateFields: boolean;
};

type ValidationResult = {
  valid: boolean;
  summary: Summary;
  checks: Record<string, boolean>;
  errors: string[];
};

const DEFAULT_OUTPUT_DIR = "/tmp/white-bridge-note-state";
const SECRET_KEY_RE = /(secret|nullifier|witness|private[_-]?key|mnemonic|seed|signature)/i;

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeScalar(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return BigInt(value).toString();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed).toString();
  if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed).toString();
  return null;
}

function hasKeyDeep(value: unknown, matcher: RegExp): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => hasKeyDeep(entry, matcher));
  return Object.entries(value as JsonRecord).some(([key, child]) => matcher.test(key) || hasKeyDeep(child, matcher));
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function summarizeState(filePath: string): Summary {
  const exists = fs.existsSync(filePath);
  if (!exists) {
    return {
      path: filePath,
      exists,
      sourceBridgeOutHash: null,
      destinationBridgeMintHash: null,
      destinationCommitment: null,
      amount: null,
      destinationAmount: null,
      assetId: null,
      hasDestSecret: false,
      hasDestNullifier: false,
      hasWitness: false,
      hasPrivateFields: false,
    };
  }

  const state = readJson(filePath);
  const sourceMessage = state.sourceMessage || state.message || {};
  const bridgeMintMessage = state.bridgeMintMessage || {};

  return {
    path: filePath,
    exists,
    sourceBridgeOutHash:
      normalizeHash(state.sourceMessageHash) ||
      normalizeHash(state.sourceBridgeOutHash) ||
      normalizeHash(state.messageHash),
    destinationBridgeMintHash:
      normalizeHash(state.bridgeMintMessageHash) ||
      normalizeHash(state.destinationBridgeMintHash) ||
      normalizeHash(state.destinationMessageHash),
    destinationCommitment:
      normalizeScalar(state.destinationCommitment) ||
      normalizeScalar(state.destCommitment) ||
      normalizeScalar(bridgeMintMessage.destinationCommitment) ||
      normalizeScalar(sourceMessage.destinationCommitment),
    amount: normalizeScalar(state.amount),
    destinationAmount: normalizeScalar(state.destinationAmount) || normalizeScalar(state.destAmount),
    assetId:
      normalizeScalar(state.solanaAssetId) ||
      normalizeScalar(bridgeMintMessage.destinationLocalAssetId) ||
      normalizeScalar(sourceMessage.destinationLocalAssetId),
    hasDestSecret: state.destSecret !== undefined && state.destSecret !== null && state.destSecret !== "",
    hasDestNullifier: state.destNullifier !== undefined && state.destNullifier !== null && state.destNullifier !== "",
    hasWitness: Boolean(state.witness || state.withdrawWitness || state.proofWitness),
    hasPrivateFields: hasKeyDeep(state, SECRET_KEY_RE),
  };
}

function validateState(filePath: string, env = process.env): ValidationResult {
  const summary = summarizeState(filePath);
  const checks: Record<string, boolean> = {
    exists: summary.exists,
    sourceHash: true,
    destinationHash: true,
    destinationCommitment: true,
    hasDestSecret: summary.hasDestSecret,
    hasDestNullifier: summary.hasDestNullifier,
    amount: true,
    asset: true,
  };
  const errors: string[] = [];

  const expectedSource = normalizeHash(env.BRIDGE_NOTE_EXPECTED_SOURCE_HASH);
  const expectedDestination = normalizeHash(env.BRIDGE_NOTE_EXPECTED_DESTINATION_HASH);
  const expectedCommitment = normalizeScalar(env.BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT);
  const expectedAmount = normalizeScalar(env.BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT);
  const expectedAsset = normalizeScalar(env.BRIDGE_NOTE_EXPECTED_ASSET_ID);

  if (!summary.exists) errors.push("state_file_missing");
  if (expectedSource) {
    checks.sourceHash = summary.sourceBridgeOutHash === expectedSource;
    if (!checks.sourceHash) errors.push("source_hash_mismatch");
  }
  if (expectedDestination) {
    checks.destinationHash = summary.destinationBridgeMintHash === expectedDestination;
    if (!checks.destinationHash) errors.push("destination_hash_mismatch");
  }
  if (expectedCommitment) {
    checks.destinationCommitment = summary.destinationCommitment === expectedCommitment;
    if (!checks.destinationCommitment) errors.push("destination_commitment_mismatch");
  }
  if (expectedAmount) {
    checks.amount = summary.destinationAmount === expectedAmount || summary.amount === expectedAmount;
    if (!checks.amount) errors.push("amount_mismatch");
  }
  if (expectedAsset) {
    checks.asset = summary.assetId === expectedAsset;
    if (!checks.asset) errors.push("asset_mismatch");
  }
  if (!summary.hasDestSecret) errors.push("dest_secret_missing");
  if (!summary.hasDestNullifier) errors.push("dest_nullifier_missing");

  return {
    valid: Object.values(checks).every(Boolean) && errors.length === 0,
    summary,
    checks,
    errors,
  };
}

function assertSafeOutputPath(outputPath: string): void {
  const resolved = path.resolve(outputPath);
  const root = repoRoot();
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    throw new Error("refusing_to_write_note_state_inside_repo");
  }
}

function destinationFileName(destinationHash: string | null): string {
  const suffix = destinationHash ? destinationHash.slice(2) : crypto.randomBytes(16).toString("hex");
  return `${suffix}.bridge-note-state.json`;
}

function exportState(inputPath: string, env = process.env): Record<string, unknown> {
  const validation = validateState(inputPath, env);
  if (!validation.valid) {
    return { ok: false, status: "invalid", validation };
  }

  const outputPath = env.BRIDGE_NOTE_STATE_OUTPUT
    ? path.resolve(env.BRIDGE_NOTE_STATE_OUTPUT)
    : path.join(
        path.resolve(env.BRIDGE_NOTE_STATE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR),
        destinationFileName(validation.summary.destinationBridgeMintHash)
      );
  assertSafeOutputPath(outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.copyFileSync(inputPath, outputPath);
  fs.chmodSync(outputPath, 0o600);

  return {
    ok: true,
    status: "exported",
    outputPath,
    validation,
  };
}

function redactResult(value: unknown): unknown {
  // Output objects should only include booleans/hashes/path metadata. Keep field
  // names such as hasDestSecret visible so operators can validate safely.
  return value;
}

function print(value: unknown): void {
  console.log(JSON.stringify(redactResult(value), null, 2));
}

function writeFixture(dir: string, overrides: JsonRecord = {}): string {
  const fixture = {
    sourceMessageHash: "0x" + "11".repeat(32),
    bridgeMintMessageHash: "0x" + "22".repeat(32),
    bridgeMintMessage: {
      destinationCommitment: "0x" + "33".repeat(32),
      destinationLocalAssetId: "0x" + "44".repeat(32),
    },
    destinationAmount: "1000000",
    destSecret: "super-secret-sentinel",
    destNullifier: "super-nullifier-sentinel",
    manualMessageEditUsed: false,
    ...overrides,
  };
  const filePath = path.join(dir, `${crypto.randomBytes(6).toString("hex")}.fixture.bridge-state.json`);
  fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
  return filePath;
}

function runSelfTest(): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-note-state-test-"));
  const fixturePath = writeFixture(tempDir);
  const env = {
    BRIDGE_NOTE_EXPECTED_SOURCE_HASH: "0x" + "11".repeat(32),
    BRIDGE_NOTE_EXPECTED_DESTINATION_HASH: "0x" + "22".repeat(32),
    BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT: "0x" + "33".repeat(32),
    BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT: "1000000",
    BRIDGE_NOTE_EXPECTED_ASSET_ID: "0x" + "44".repeat(32),
    BRIDGE_NOTE_STATE_OUTPUT_DIR: path.join(tempDir, "exports"),
  };

  assert.strictEqual(validateState(fixturePath, env).valid, true);
  assert.strictEqual(
    validateState(fixturePath, { ...env, BRIDGE_NOTE_EXPECTED_DESTINATION_HASH: "0x" + "55".repeat(32) }).valid,
    false
  );
  assert.strictEqual(validateState(writeFixture(tempDir, { destSecret: undefined }), env).valid, false);
  assert.strictEqual(validateState(writeFixture(tempDir, { destNullifier: undefined }), env).valid, false);
  assert.throws(() =>
    exportState(fixturePath, { ...env, BRIDGE_NOTE_STATE_OUTPUT: path.join(repoRoot(), "note-state.json") })
  );
  const exported = exportState(fixturePath, env) as any;
  assert.strictEqual(exported.ok, true);
  assert.strictEqual(fs.existsSync(exported.outputPath), true);
  const rendered = JSON.stringify(redactResult(exported));
  assert.ok(!rendered.includes("super-secret-sentinel"));
  assert.ok(!rendered.includes("super-nullifier-sentinel"));

  const ignorePaths = [
    path.join(repoRoot(), ".gitignore"),
    path.resolve(repoRoot(), "../..", ".gitignore"),
  ];
  const ignore = ignorePaths
    .filter((ignorePath) => fs.existsSync(ignorePath))
    .map((ignorePath) => fs.readFileSync(ignorePath, "utf8"))
    .join("\n");
  for (const pattern of [
    "chains/evm/test/*bridge-state*.json",
    "**/*bridge-state*.json",
    "**/*note-state*.json",
    "**/.bridge-notes/**",
    ".bridge-signers.env",
  ]) {
    assert.ok(ignore.includes(pattern), `missing ignore pattern: ${pattern}`);
  }

  print({ ok: true, status: "self_test_passed" });
}

function main(): void {
  const command = process.argv[2] || "validate";
  if (command === "self-test") {
    runSelfTest();
    return;
  }

  const inputPath = process.env.BRIDGE_NOTE_STATE_INPUT || process.argv[3];
  if (!inputPath) {
    throw new Error("BRIDGE_NOTE_STATE_INPUT or input path argument is required");
  }
  const resolvedInput = path.resolve(inputPath);

  if (command === "summary") {
    print(summarizeState(resolvedInput));
    return;
  }
  if (command === "validate") {
    const result = validateState(resolvedInput);
    print(result);
    process.exit(result.valid ? 0 : 1);
  }
  if (command === "export") {
    const result = exportState(resolvedInput);
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }

  throw new Error(`unknown command: ${command}`);
}

main();
