/**
 * BNB Chain Testnet E2E wrapper
 *
 * Delegates to the network-agnostic E2E runner.
 *
 * Usage:
 *   tsx test/e2e-bsc-testnet.ts
 *
 * Requires:
 *   - DEPLOYER_PRIVATE_KEY env var
 *   - BSC_TESTNET_RPC_URL env var (or uses public fallback)
 *   - deployments/bsc-testnet.json artifact
 */

import { spawnSync } from 'child_process';
import * as path from 'path';

const scriptPath = path.join(__dirname, 'e2e-base-full.ts');

const result = spawnSync('tsx', [scriptPath], {
  stdio: 'inherit',
  env: { ...process.env, NETWORK: 'bsc-testnet' },
  cwd: path.join(__dirname, '..'),
});

process.exit(result.status ?? 1);
