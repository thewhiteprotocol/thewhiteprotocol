# PR-011I — Hosted Paper-Mode Live Testnet Log Observation

## Summary

PR-011I prepares hosted bridge daemon paper-mode observation against fresh live testnet logs. It adds an env-name-only hosted readiness check, a Base Sepolia live-log scan command, live confirmation propagation into daemon policy, and mocked live-scan tests.

Fresh live scanning was not run in this shell because required hosted env/secrets are absent. This PR follows the environment-blocked acceptance path while keeping implementation and tests ready for a hosted run.

## What PR-011H Proved

PR-011H replayed the documented PR-010W Base Sepolia -> Solana Devnet source event artifact:

- Source tx: `0xc931d4989abc6fa8c6c85726575780d12370c2a26d38db063c837bd0491ac6d2`
- Source BridgeOut hash: `0xa17dd855e9927eb508e5cea8abec4002c05d79f148a3f84237ae14781eb6edad`
- Destination BridgeMint hash: `0x706f7b492e5ea1efc568f6bcf5929631650f00635fc4102596fefb231f7f944a`
- Policy passed in historical replay context
- 2 signatures produced
- Solana submit preview created
- `submitTxHash=null`
- no destination transaction submitted

## Hosted Env Checklist

Required env names for Base Sepolia -> Solana Devnet hosted paper observation:

- `BASE_SEPOLIA_RPC_URL` or `BASE_RPC_URL`
- `SOLANA_DEVNET_RPC_URL` or `RPC_ENDPOINT`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_SIGNER_MODE`
- `BRIDGE_SIGNER_KEY_FILE` or `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`
- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet`
- `BRIDGE_DAEMON_STATE_PATH`

Check without printing values:

```bash
cd relayer
npm run bridge:daemon:env:check
```

## Fresh Live Scan Result Or Blocker

Command added:

```bash
cd relayer
npm run bridge:daemon:paper:scan
```

Current shell result:

- hosted env ready: no
- fresh live scan: skipped
- missing names:
  - `BASE_SEPOLIA_RPC_URL or BASE_RPC_URL`
  - `SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT`
  - `BRIDGE_DAEMON_MODE`
  - `BRIDGE_DAEMON_ROUTES`
  - `BRIDGE_DAEMON_STATE_PATH`
  - `BRIDGE_OPERATOR_API_TOKEN`
  - `BRIDGE_SIGNER_MODE`
  - `BRIDGE_SIGNER_KEY_FILE or BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`
- destination tx submitted: no

No env values were printed.

## Route Observed

Prepared route:

- Base Sepolia -> Solana Devnet

Mocked live-log tests use the same route and source event shape as PR-011H.

## Event Source

Implementation path:

- `EvmSourceAdapter` scans Base Sepolia `BridgeOutInitiated` logs from configured BridgeOutbox.
- Optional scan controls:
  - `BRIDGE_DAEMON_SCAN_LOOKBACK_BLOCKS`
  - `BRIDGE_DAEMON_SCAN_FROM_BLOCK`
  - `BRIDGE_DAEMON_SCAN_TO_BLOCK`
- `BRIDGE_BASE_SEPOLIA_OUTBOX_ADDRESS` can override the deployment artifact address.

## Finality Result

`EvmSourceAdapter` now adds `confirmations` to each event:

- `confirmations = currentBlock - eventBlock`

Daemon policy uses this value:

- not-final mocked event remains `finality_wait`
- final mocked event reaches `paper_ready_to_submit`

## Signing Result

Mocked final live-log test:

- policy passed
- signer policy passed
- 2 signatures produced
- raw signer private keys are not printed or persisted in status output

## Submit Preview Result

Mocked final live-log test created a Solana `accept_bridge_v1_mint` preview with:

- destination chain: `solana-devnet`
- route: `base-sepolia->solana-devnet`
- dryRun: `true`
- wouldSubmit: `true`
- `liveSubmissionImplemented=false`

## Proof No Destination Tx Submitted

Paper mode evidence:

- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- mocked destination submit function was not called
- daemon tick reported `submitted=0`
- persisted message has `submitTxHash=null`
- live env-blocked scan reported `destinationTxSubmitted=false`

## Operator API Result

Tests verify:

- `/bridge/daemon/status` exposes `mode=paper`
- `/bridge/daemon/messages` exposes message policy/signing/preview state
- `/bridge/daemon/tick` requires operator auth
- output does not contain operator token or private keys

## Commands Run

- `cd relayer && npm run bridge:daemon:env:check`
- `cd relayer && npm run bridge:daemon:paper:scan`
- `cd relayer && npx jest src/bridge/__tests__/daemon-paper-live-events.test.ts`

Full validation commands were run after implementation:

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd relayer && npm run bridge:daemon:paper:once`
- `cd relayer && npm run bridge:daemon:paper:status`

## Passing Results

- Env check command: passed, reported missing names only
- Paper scan command: safely skipped because env missing; no submit
- Mocked live-scan tests: 9 tests passed
- Relayer tests: 22 suites / 320 tests passed
- Typecheck: passed
- Build: passed
- Watcher smoke: passed with 6 findings and 0 freeze submissions
- Watcher report: passed with `liveFreezeTxCount=0`
- Historical paper command: passed with `paper_ready_to_submit`, 2 signatures, 1 preview, 0 submissions
- Paper status command: passed

Final validation results are recorded in the terminal summary.

## Remaining Limitations

- Fresh live RPC scan was not run in this shell because hosted env/secrets are absent.
- No new live source event was generated.
- Solana destination submission remains preview-only.
- Live-testnet destination submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011J — hosted paper-mode run with real secrets configured:

- run `bridge:daemon:env:check` on host
- run `bridge:daemon:paper:scan` against fresh Base Sepolia logs
- record source block/current block/confirmations
- inspect daemon APIs on host
- keep destination submission disabled
