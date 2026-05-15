import {
  BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV,
  PR011N_DESTINATION_BRIDGE_MINT_HASH,
  PR011N_SOURCE_BRIDGE_OUT_HASH,
  checkSolanaSimulationEnv,
  targetDestinationHashFromEnv,
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

  test('accepts a fresh approved destination hash from env', () => {
    const freshDestinationHash = '0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf';
    const result = checkSolanaSimulationEnv({
      SOLANA_DEVNET_RPC_URL: 'present',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      BRIDGE_APPROVED_MESSAGE_HASHES: `base-sepolia->solana-devnet|${freshDestinationHash}`,
    });
    expect(result.ok).toBe(true);
    expect(result.approvedDestinationHashPresent).toBe(true);
    expect(targetDestinationHashFromEnv({
      BRIDGE_APPROVED_MESSAGE_HASHES: `base-sepolia->solana-devnet|${freshDestinationHash}`,
    })).toBe(freshDestinationHash);
  });

  test('explicit simulation destination hash can select the fresh message', () => {
    const freshDestinationHash = '0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf';
    const result = checkSolanaSimulationEnv({
      SOLANA_DEVNET_RPC_URL: 'present',
      BRIDGE_DAEMON_STATE_PATH: '/tmp/state',
      BRIDGE_DAEMON_MODE: 'paper',
      BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: 'false',
      [BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV]: freshDestinationHash,
      BRIDGE_APPROVED_MESSAGE_HASHES: `base-sepolia->solana-devnet|${freshDestinationHash}`,
    });
    expect(result.ok).toBe(true);
    expect(result.present).toContain(BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV);
    expect(targetDestinationHashFromEnv({
      [BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH_ENV]: freshDestinationHash,
      BRIDGE_APPROVED_MESSAGE_HASHES: `base-sepolia->solana-devnet|${PR011N_DESTINATION_BRIDGE_MINT_HASH}`,
    })).toBe(freshDestinationHash);
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
