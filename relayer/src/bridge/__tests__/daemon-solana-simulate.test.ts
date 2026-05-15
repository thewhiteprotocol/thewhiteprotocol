import {
  PR011N_DESTINATION_BRIDGE_MINT_HASH,
  PR011N_SOURCE_BRIDGE_OUT_HASH,
  checkSolanaSimulationEnv,
} from '../daemon-solana-simulate';

describe('daemon Solana simulation env check', () => {
  test('reports missing names only when hosted simulation env is absent', () => {
    const result = checkSolanaSimulationEnv({});
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      'SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT',
      'BRIDGE_DAEMON_STATE_PATH or STATE_DIR',
      'BRIDGE_APPROVED_MESSAGE_HASHES',
      'BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)',
    ]));
  });

  test('rejects source BridgeOut hash as approval', () => {
    const result = checkSolanaSimulationEnv({
      SOLANA_DEVNET_RPC_URL: 'present',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      BRIDGE_APPROVED_MESSAGE_HASHES: PR011N_SOURCE_BRIDGE_OUT_HASH,
    });
    expect(result.ok).toBe(false);
    expect(result.approvedDestinationHashPresent).toBe(false);
    expect(result.missing).toContain('BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)');
  });

  test('accepts destination BridgeMint hash approval in paper mode', () => {
    const result = checkSolanaSimulationEnv({
      SOLANA_DEVNET_RPC_URL: 'present',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      BRIDGE_APPROVED_MESSAGE_HASHES: `base-sepolia->solana-devnet|${PR011N_DESTINATION_BRIDGE_MINT_HASH}`,
    });
    expect(result.ok).toBe(true);
    expect(result.approvedDestinationHashPresent).toBe(true);
    expect(result.liveSubmitEnabled).toBe(false);
  });

  test('blocks live submit flag for simulation command', () => {
    const result = checkSolanaSimulationEnv({
      SOLANA_DEVNET_RPC_URL: 'present',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'true',
      BRIDGE_APPROVED_MESSAGE_HASHES: PR011N_DESTINATION_BRIDGE_MINT_HASH,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings).toContain('BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT must remain false');
  });
});
