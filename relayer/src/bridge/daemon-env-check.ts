/**
 * Bridge daemon hosted paper-mode env checker.
 *
 * Prints env var names only. Never prints values.
 */

export interface BridgeDaemonEnvCheckResult {
  ok: boolean;
  mode: string;
  liveSubmitEnabled: boolean;
  present: string[];
  missing: string[];
  warnings: string[];
}

function hasAny(env: Record<string, string | undefined>, names: string[]): boolean {
  return names.some((name) => Boolean(env[name]));
}

function addMissingAny(
  env: Record<string, string | undefined>,
  names: string[],
  missing: string[]
): void {
  if (!hasAny(env, names)) {
    missing.push(names.join(' or '));
  }
}

export function checkBridgeDaemonPaperEnv(
  env: Record<string, string | undefined> = process.env
): BridgeDaemonEnvCheckResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const present: string[] = [];
  const exactRequired = [
    'BRIDGE_DAEMON_MODE',
    'BRIDGE_DAEMON_ROUTES',
    'BRIDGE_DAEMON_STATE_PATH',
    'BRIDGE_SIGNER_MODE',
    'BRIDGE_OPERATOR_API_TOKEN',
  ];

  for (const name of exactRequired) {
    if (env[name]) present.push(name);
    else missing.push(name);
  }

  addMissingAny(env, ['BASE_SEPOLIA_RPC_URL', 'BASE_RPC_URL'], missing);
  addMissingAny(env, ['SOLANA_DEVNET_RPC_URL', 'RPC_ENDPOINT'], missing);
  addMissingAny(env, ['BRIDGE_SIGNER_KEY_FILE', 'BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET'], missing);

  for (const name of [
    'BASE_SEPOLIA_RPC_URL',
    'BASE_RPC_URL',
    'SOLANA_DEVNET_RPC_URL',
    'RPC_ENDPOINT',
    'BRIDGE_SIGNER_KEY_FILE',
    'BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET',
  ]) {
    if (env[name]) present.push(name);
  }

  const mode = env.BRIDGE_DAEMON_MODE || 'disabled';
  const liveSubmitEnabled = env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === 'true' ||
    env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === '1';

  if (mode !== 'paper') {
    warnings.push('BRIDGE_DAEMON_MODE should be paper for hosted observation');
  }
  if (liveSubmitEnabled) {
    warnings.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must remain false for paper observation');
  }
  if (!env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT) {
    present.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT(unset=false)');
  } else {
    present.push('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT');
  }

  return {
    ok: missing.length === 0 && warnings.length === 0,
    mode,
    liveSubmitEnabled,
    present: [...new Set(present)].sort(),
    missing: [...new Set(missing)].sort(),
    warnings,
  };
}

if (require.main === module) {
  const result = checkBridgeDaemonPaperEnv(process.env);
  console.log(JSON.stringify(result, null, 2));
}
