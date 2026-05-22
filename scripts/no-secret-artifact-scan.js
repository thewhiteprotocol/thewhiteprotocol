#!/usr/bin/env node
/*
 * CI guard for accidentally committed secrets and operator artifacts.
 *
 * Output intentionally reports only file path + issue type. It never prints
 * matched content.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const ROOT = path.resolve(process.env.NO_SECRET_SCAN_ROOT || DEFAULT_ROOT);
const MAX_TEXT_BYTES = 1024 * 1024;
const DEFAULT_BASELINE_PATH = 'docs/security/no-secret-scan-baseline.json';

const KNOWN_PUBLIC_ARTIFACT_ALLOWLIST = [
  /^app\/public\/circuits\/[^/]+\/[^/]+\.zkey$/,
  /^app\/public\/circuits\/[^/]+\/[^/]+_vk\.json$/,
  /^relayer\/circuits\/build\/[^/]+\.zkey$/,
  /^relayer\/circuits\/build\/merkle_batch_update\/[^/]+\.zkey$/,
  /^chains\/solana\/test-proofs\/[^/]+\.json$/,
  /^circuits\/[^/]+\/build\/[^/]+_(input|public|proof)\.json$/,
  /^circuits\/test_proof(_bytes)?\.json$/,
  /^tools\/_scratch\/data\/past_commitments\.json$/,
];

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function isAllowlistedPublicArtifact(relPath) {
  return KNOWN_PUBLIC_ARTIFACT_ALLOWLIST.some((pattern) => pattern.test(relPath));
}

function isEnvExample(relPath) {
  return relPath.endsWith('.env.example') || relPath.endsWith('/.env.example');
}

function pathIssues(relPath) {
  const issues = [];
  const base = path.posix.basename(relPath).toLowerCase();
  const lower = relPath.toLowerCase();

  if ((base === '.env' || base.startsWith('.env.')) && !isEnvExample(relPath)) {
    issues.push('env_file');
  }
  if (base === '.bridge-signers.env' || base === 'thewhiteprotocol.env') {
    issues.push('private_env_file');
  }
  if (lower.endsWith('.zkey') && !isAllowlistedPublicArtifact(relPath)) {
    issues.push('zkey_artifact');
  }
  if (lower.endsWith('.wtns') || /(^|\/).*witness.*\.json$/i.test(relPath)) {
    issues.push('witness_artifact');
  }
  if (/(^|\/)(data|operator-data|bridge-results)(\/|$)/i.test(relPath) && !isAllowlistedPublicArtifact(relPath)) {
    issues.push('operator_result_path');
  }
  if (/(bridge-note-state|destination-note-state|base-destination-note-state|note-state)\S*\.json$/i.test(relPath)) {
    issues.push('note_state_artifact');
  }
  if (/(^|\/).*(wallet|keypair|private-key|signer-key|operator-token|mnemonic|seed-phrase).*\.json$/i.test(relPath)) {
    issues.push('secret_json_artifact');
  }
  if (/(^|\/).*(proof|public|input).*\.json$/i.test(relPath) && !relPath.startsWith('docs/') && !isAllowlistedPublicArtifact(relPath)) {
    issues.push('proof_or_witness_json');
  }
  if (/(^|\/).*generated.*tx.*\.json$/i.test(relPath)) {
    issues.push('generated_tx_artifact');
  }

  return issues;
}

function contentIssues(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    return ['unreadable_file'];
  }
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return [];

  const buffer = fs.readFileSync(absPath);
  if (buffer.includes(0)) return [];
  const text = buffer.toString('utf8');
  const issues = [];

  const patterns = [
    ['private_key_value', /\b(?:PRIVATE_KEY|privateKey|signerKey|DEPLOYER_PRIVATE_KEY)\b\s*[:=]\s*["']?(?:0x)?[a-fA-F0-9]{64}\b/],
    ['operator_token_value', /\b(?:BRIDGE_OPERATOR_API_TOKEN|SEQUENCER_AUTH_TOKEN|OPERATOR_TOKEN|API_KEY)\b\s*[:=]\s*["']?[A-Za-z0-9_\-.]{32,}\b/],
    ['database_url_value', /\bDATABASE_URL\b\s*[:=]\s*["']?(?:postgres|mysql|mongodb):\/\/[^\s"']+/i],
    ['note_secret_value', /["'](?:destSecret|destinationSecret|noteSecret|nullifierSecret|destNullifier|destinationNullifier)["']\s*:\s*["'](?!<|redacted|\[redacted\])[A-Za-z0-9_:+/=-]{16,}["']/],
    ['mnemonic_or_seed_phrase', /\b(?:mnemonic|seed phrase|seedPhrase)\b\s*[:=]\s*["'][^"']{24,}["']/i],
  ];

  for (const [issue, pattern] of patterns) {
    if (pattern.test(text)) issues.push(issue);
  }

  const keyedUrlPattern = /https?:\/\/[^\s"'<>]*(?:api[_-]?key|apikey|token|secret|projectId|project_id)=([^\s"'<>]+)/ig;
  for (const match of text.matchAll(keyedUrlPattern)) {
    const value = String(match[1] || '');
    if (!/^(<|\$\{|YOUR_|REPLACE_|EXAMPLE_|API_KEY|TOKEN|KEY|SECRET|project-id|example)/i.test(value)) {
      issues.push('rpc_url_with_key');
      break;
    }
  }

  return issues;
}

function gitTrackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT });
  const output = result.stdout || Buffer.alloc(0);
  if (output.length === 0 && result.status !== 0) {
    throw result.error || new Error(`git ls-files failed with status ${result.status}`);
  }
  return output.toString('utf8').split('\0').filter(Boolean);
}

function scanFiles(files, root = ROOT) {
  const findings = [];
  for (const file of files) {
    const relPath = normalize(file);
    const absPath = path.resolve(root, relPath);
    for (const issue of pathIssues(relPath)) {
      findings.push({ path: relPath, issue });
    }
    for (const issue of contentIssues(absPath)) {
      findings.push({ path: relPath, issue });
    }
  }
  return findings;
}

function loadBaseline() {
  const baselinePath = process.env.NO_SECRET_SCAN_BASELINE || DEFAULT_BASELINE_PATH;
  const absPath = path.resolve(ROOT, baselinePath);
  if (!fs.existsSync(absPath)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  const entries = Array.isArray(parsed.findings) ? parsed.findings : [];
  return new Set(entries.filter((finding) => finding && finding.status !== 'removed').map((finding) => `${finding.path}\0${finding.issue}`));
}

function splitBaseline(findings, baseline) {
  const active = [];
  let baselineCount = 0;
  for (const finding of findings) {
    if (baseline.has(`${finding.path}\0${finding.issue}`)) baselineCount += 1;
    else active.push(finding);
  }
  return { active, baselineCount };
}

function printFindings(findings) {
  for (const finding of findings) {
    console.error(`forbidden_artifact path=${finding.path} issue=${finding.issue}`);
  }
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-no-secret-scan-'));
  const files = [
    '.env',
    'safe.env.example',
    'notes/bridge-note-state.json',
    'proof.json',
    'good.txt',
    'bad-token.txt',
  ];
  fs.mkdirSync(path.join(tmp, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.env'), 'PRIVATE_KEY=0x' + 'a'.repeat(64));
  fs.writeFileSync(path.join(tmp, 'safe.env.example'), 'PRIVATE_KEY=<placeholder>');
  fs.writeFileSync(path.join(tmp, 'notes/bridge-note-state.json'), '{"destSecret":"redacted"}');
  fs.writeFileSync(path.join(tmp, 'proof.json'), '{}');
  fs.writeFileSync(path.join(tmp, 'good.txt'), 'destSecret: [redacted]');
  fs.writeFileSync(path.join(tmp, 'bad-token.txt'), 'BRIDGE_OPERATOR_API_TOKEN=' + 'b'.repeat(40));

  const findings = scanFiles(files, tmp);
  const issueSet = new Set(findings.map((finding) => finding.issue));
  const required = ['env_file', 'private_key_value', 'note_state_artifact', 'proof_or_witness_json', 'operator_token_value'];
  const ok = required.every((issue) => issueSet.has(issue));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!ok) {
    printFindings(findings);
    throw new Error('self_test_failed');
  }
  console.log(JSON.stringify({ ok: true, selfTest: true, findings: findings.length }));
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const findings = scanFiles(gitTrackedFiles());
  const { active, baselineCount } = splitBaseline(findings, loadBaseline());
  if (active.length > 0) {
    printFindings(active);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, scanned: true, findings: 0, baselineFindings: baselineCount }));
}

module.exports = {
  contentIssues,
  loadBaseline,
  pathIssues,
  printFindings,
  scanFiles,
  splitBaseline,
};

if (require.main === module) {
  main();
}
