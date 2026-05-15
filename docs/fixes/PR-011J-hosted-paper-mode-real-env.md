# PR-011J — Hosted Paper Mode With Real Env

## Summary

PR-011J attempted the hosted bridge daemon paper-mode run using the real-env command path added in PR-011I. The local shell still does not have hosted RPC/signer/operator secrets configured, so the run completed through the safe environment-blocked path.

No destination transaction was submitted. No contracts, Solana programs, circuits, deployment artifacts, or mainnet configs were changed.

## Hosted Env Readiness Result

Command:

```bash
cd relayer
npm run bridge:daemon:env:check
```

Result:

- `ok=false`
- `BRIDGE_DAEMON_MODE` resolved to default `disabled`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT` was unset and therefore treated as false
- no secret values were printed

Missing env names:

- `BASE_SEPOLIA_RPC_URL or BASE_RPC_URL`
- `SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT`
- `BRIDGE_DAEMON_MODE`
- `BRIDGE_DAEMON_ROUTES`
- `BRIDGE_DAEMON_STATE_PATH`
- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_SIGNER_MODE`
- `BRIDGE_SIGNER_KEY_FILE or BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`

## Exact Env Names Checked

Required hosted paper env:

- `BASE_SEPOLIA_RPC_URL` or `BASE_RPC_URL`
- `SOLANA_DEVNET_RPC_URL` or `RPC_ENDPOINT`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_SIGNER_MODE`
- `BRIDGE_SIGNER_KEY_FILE` or `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`
- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet`
- `BRIDGE_DAEMON_STATE_PATH`

The command reports names only.

## Route Tested

Intended hosted route:

- Base Sepolia -> Solana Devnet

Fallback historical replay route:

- Base Sepolia -> Solana Devnet

## Scan Mode

Fresh live scan command:

```bash
cd relayer
npm run bridge:daemon:paper:scan
```

Result:

- skipped with `missing_or_unsafe_env`
- `destinationTxSubmitted=false`
- no Base Sepolia RPC scan was attempted after env check failed
- no source event was fabricated

Historical fallback command:

```bash
BRIDGE_DAEMON_STATE_PATH=/tmp/pr011j-paper-state \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
npm run bridge:daemon:paper:once
```

Fallback result:

- `ok=true`
- route: `base-sepolia->solana-devnet`
- event source: PR-010W historical BridgeOut artifact
- status: `paper_ready_to_submit`
- signatures: `2`
- previews: `1`
- submissions: `0`

## Event Source

Fresh hosted scan:

- none, blocked before RPC scan because env was missing

Historical fallback:

- source tx: `0xc931d4989abc6fa8c6c85726575780d12370c2a26d38db063c837bd0491ac6d2`
- source block: `41275766`
- source BridgeOut hash: `0xa17dd855e9927eb508e5cea8abec4002c05d79f148a3f84237ae14781eb6edad`
- destination BridgeMint hash: `0x706f7b492e5ea1efc568f6bcf5929631650f00635fc4102596fefb231f7f944a`

## Policy Result

Fresh hosted scan:

- not evaluated, env blocked

Historical fallback:

- policy accepted
- route enabled
- asset supported
- cross-decimal normalization applied
- destination amount: `1000000`

## Finality Result

Fresh hosted scan:

- not evaluated against live Base RPC, env blocked

Historical fallback:

- evaluated in historical replay context as in PR-011H

## Watcher Result

No fresh watcher findings were produced by the hosted scan because the scan did not run. Watcher smoke and report validation still passed:

- smoke findings persisted: `6`
- freeze submissions: `0`
- watcher report `liveFreezeTxCount=0`

## Signing Result

Fresh hosted scan:

- not attempted, env blocked

Historical fallback:

- 2 signatures produced in paper mode
- signer private keys were not printed

## Submit Preview Result

Fresh hosted scan:

- no preview, env blocked before scan

Historical fallback:

- Solana `accept_bridge_v1_mint` preview created
- `dryRun=true`
- `submitTxHash=null`
- `destinationTxSubmitted=false`

## Proof No Destination Tx Submitted

Evidence:

- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT` was unset/false
- `bridge:daemon:paper:scan` reported `destinationTxSubmitted=false`
- historical fallback reported `tick.submitted=0`
- historical fallback persisted `submitTxHash=null`
- watcher report showed `liveFreezeTxCount=0`

## Operator API Verification

Hosted operator API could not be verified because `BRIDGE_OPERATOR_API_TOKEN` and hosted service env are absent in this shell.

Existing PR-011I tests still verify:

- `/bridge/daemon/status` exposes paper mode safely
- `/bridge/daemon/messages` exposes message state safely
- `/bridge/daemon/tick` requires operator auth
- output does not contain private keys or operator token values

## Commands Run

- `cd relayer && npm run bridge:daemon:env:check`
- `cd relayer && npm run bridge:daemon:paper:scan`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && STATE_DIR=/tmp/white-bridge-watcher-smoke-PFhuE2 npm run watcher:report`
- `cd relayer && BRIDGE_DAEMON_STATE_PATH=/tmp/pr011j-paper-state BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false npm run bridge:daemon:paper:once`
- `cd relayer && BRIDGE_DAEMON_STATE_PATH=/tmp/pr011j-paper-state npm run bridge:daemon:paper:status`

## Passing / Failing Results

Passing:

- relayer tests: 22 suites / 320 tests
- typecheck: passed
- build: passed
- watcher smoke: passed
- watcher report: passed with `liveFreezeTxCount=0`
- historical paper fallback: passed with 2 signatures, Solana preview, 0 submissions

Blocked:

- hosted fresh live scan: blocked by missing env names listed above
- hosted operator API: blocked by missing operator token/service env

## Remaining Limitations

- Fresh live Base Sepolia logs were not scanned in this shell.
- Real hosted operator API was not called.
- No new live source event was generated.
- Solana destination submission remains preview-only.
- Live-testnet submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011K — execute hosted paper scan on Render or equivalent with secrets configured:

- configure required env as hosted secrets
- run `npm run bridge:daemon:env:check`
- run `npm run bridge:daemon:paper:scan`
- record fresh scan range and any source events found
- verify hosted `/bridge/daemon/*` APIs with operator token
- keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
