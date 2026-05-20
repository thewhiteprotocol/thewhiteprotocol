#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function bool(value) {
  return value === "true" || value === "1" || value === "yes";
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function statusPath() {
  if (process.env.BRIDGE_HOSTED_STARTUP_STATUS_PATH) {
    return path.resolve(process.env.BRIDGE_HOSTED_STARTUP_STATUS_PATH);
  }
  const resultDir = process.env.BRIDGE_RESULTS_DIR || "/data/bridge-results";
  return path.join(resultDir, "hosted-startup-status.json");
}

function readiness(input) {
  if (input.detail.includes("live_submit_startup_guard")) return "blocked_live_submit_guard";
  if (input.zkeyBootstrapAttempted && !input.zkeyBootstrapOk) return "blocked_zkeys";
  if (input.operatorPrereqAttempted && !input.operatorPrereqOk) return "blocked_operator_prereq";
  if (input.hostedBootstrapEnabled && !input.operatorPrereqAttempted) return "warning_operator_prereq_skipped";
  return "ready";
}

const zkeys = readJson("/tmp/white-bridge-hosted-startup-zkeys.json");
const prereq = readJson("/tmp/white-bridge-hosted-startup-prereq.json");
const hostedBootstrapEnabled = bool(process.env.BRIDGE_HOSTED_STARTUP_BOOTSTRAP || "false");
const requireZkeys = bool(process.env.BRIDGE_HOSTED_REQUIRE_ZKEYS || "false");
const requirePrereq = bool(process.env.BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ || "false");
const detail = process.env.BRIDGE_HOSTED_STARTUP_DETAIL || "";
const zkeyBootstrapAttempted = hostedBootstrapEnabled && requireZkeys;
const operatorPrereqAttempted = hostedBootstrapEnabled && requirePrereq;

const report = {
  timestamp: new Date().toISOString(),
  gitCommit: process.env.BRIDGE_HOSTED_STARTUP_GIT_COMMIT || null,
  hostedBootstrapEnabled,
  failClosed: bool(process.env.BRIDGE_HOSTED_FAIL_CLOSED || "true"),
  zkeyBootstrapAttempted,
  zkeyBootstrapOk: zkeyBootstrapAttempted ? zkeys?.ok === true : null,
  merkleZkeyHashOk: zkeys?.merkleZkey?.hashMatches === true,
  withdrawZkeyHashOk: zkeys?.withdrawZkey?.hashMatches === true,
  merkleSymlinkOk: zkeys?.merkleZkey?.linkTargetMatches === true,
  withdrawSymlinkOk: zkeys?.withdrawZkey?.linkTargetMatches === true,
  operatorPrereqAttempted,
  operatorPrereqOk: operatorPrereqAttempted ? prereq?.ok === true : null,
  daemonMode: process.env.BRIDGE_DAEMON_MODE || null,
  liveSubmitEnabled: bool(process.env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT || "false"),
  circuitArtifactDir: process.env.BRIDGE_CIRCUIT_ARTIFACT_DIR || "/data/circuit-artifacts",
  noteStateDir: process.env.BRIDGE_NOTE_STATE_BACKUP_DIR || "/data/white-bridge-note-state",
  bridgeResultsDir: process.env.BRIDGE_RESULTS_DIR || "/data/bridge-results",
  readiness: "ready",
  detail,
  transactionsSubmitted: false,
  proofsGenerated: false,
  secretsPrinted: false,
};

report.readiness = readiness(report);

const out = statusPath();
try {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
} catch {
  process.exit(0);
}
