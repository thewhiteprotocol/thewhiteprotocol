#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scanner = require('./no-secret-artifact-scan.js');

function withTempRepo(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-scan-test-'));
  try {
    fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function writeFile(root, relPath, value) {
  const absPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, value);
}

withTempRepo((tmp) => {
  writeFile(tmp, '.env', 'PRIVATE_KEY=0x' + 'a'.repeat(64));
  writeFile(tmp, 'keys/signer-key.json', '{}');
  writeFile(tmp, 'notes/base-destination-note-state.json', '{}');
  writeFile(tmp, 'circuits/test.zkey', 'public-ish but forbidden here');
  writeFile(tmp, 'proof.json', '{}');
  writeFile(tmp, 'witness.wtns', 'not-real');
  writeFile(tmp, 'data/bridge-results/report.json', '{}');
  writeFile(tmp, 'secret.txt', 'BRIDGE_OPERATOR_API_TOKEN=' + 'b'.repeat(40));
  writeFile(tmp, 'safe.txt', 'BRIDGE_OPERATOR_API_TOKEN=<placeholder>');

  const findings = scanner.scanFiles([
    '.env',
    'keys/signer-key.json',
    'notes/base-destination-note-state.json',
    'circuits/test.zkey',
    'proof.json',
    'witness.wtns',
    'data/bridge-results/report.json',
    'secret.txt',
    'safe.txt',
  ], tmp);
  const issues = new Set(findings.map((finding) => finding.issue));

  assert(issues.has('env_file'), 'detects .env files');
  assert(issues.has('private_key_value'), 'detects private key patterns');
  assert(issues.has('secret_json_artifact'), 'detects signer key files');
  assert(issues.has('note_state_artifact'), 'detects note-state JSON');
  assert(issues.has('zkey_artifact'), 'detects zkey artifacts');
  assert(issues.has('witness_artifact'), 'detects witness files');
  assert(issues.has('proof_or_witness_json'), 'detects proof files');
  assert(issues.has('operator_result_path'), 'detects /data copied into repo');
  assert(issues.has('operator_token_value'), 'detects operator token values');
  assert(!findings.some((finding) => finding.path === 'safe.txt'), 'allows placeholder token values');

  const baseline = new Set(['proof.json\0proof_or_witness_json']);
  const split = scanner.splitBaseline(findings, baseline);
  assert.strictEqual(split.baselineCount, 1, 'allowlist permits exact path + issue only');
  assert(split.active.some((finding) => finding.path === 'proof.json' && finding.issue !== 'proof_or_witness_json') === false);
});

withTempRepo((tmp) => {
  writeFile(tmp, 'secret.txt', 'PRIVATE_KEY=0x' + 'c'.repeat(64));
  const findings = scanner.scanFiles(['secret.txt'], tmp);
  const split = scanner.splitBaseline(findings, new Set());
  assert(split.active.length > 0, 'scanner exits nonzero on forbidden artifact');

  const originalError = console.error;
  const lines = [];
  try {
    console.error = (line) => lines.push(String(line));
    scanner.printFindings(split.active);
  } finally {
    console.error = originalError;
  }
  const output = lines.join('\n');
  assert(output.includes('path=secret.txt'), 'scanner reports file path');
  assert(output.includes('issue=private_key_value'), 'scanner reports issue type');
  assert(!output.includes('c'.repeat(64)), 'scanner redacts matched values');
});

console.log(JSON.stringify({ ok: true, tests: 10 }));
