# PR-011K — Hosted Paper Scan With Real Secrets

## Summary

PR-011K attempted the hosted bridge daemon paper scan path that should run after real hosted RPC, signer, operator, route, mode, and state-path secrets are configured.

The local shell still does not have the required hosted env configured. The run therefore completed through the safe environment-blocked acceptance path. The env checker reported missing names only, no live Base Sepolia RPC scan was run, and no destination transaction was submitted.

No contracts, Solana programs, circuits, deployment artifacts, private env files, or mainnet configs were changed.

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
- fresh live scan was not run

Missing env names:

- `BASE_SEPOLIA_RPC_URL or BASE_RPC_URL`
- `SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT`
- `BRIDGE_DAEMON_MODE`
- `BRIDGE_DAEMON_ROUTES`
- `BRIDGE_DAEMON_STATE_PATH`
- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_SIGNER_MODE`
- `BRIDGE_SIGNER_KEY_FILE or BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`

Warning:

- `BRIDGE_DAEMON_MODE should be paper for hosted observation`

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

The env checker reports names only and does not print env values.

## Route Tested

Intended hosted route:

- Base Sepolia -> Solana Devnet

No fresh hosted route was scanned because env readiness failed before RPC access.

## Scan Mode

Mode:

- environment-blocked

Fresh live scan command:

```bash
cd relayer
npm run bridge:daemon:paper:scan
```

The command was not run after the failed env check, because PR-011K requires stopping before live scan when hosted env is incomplete.

Historical fallback:

- not rerun for PR-011K
- PR-011J already verified the historical fallback path with 2 paper-mode signatures, a Solana submit preview, `destinationTxSubmitted=false`, and `submitTxHash=null`

## Scan Range And Block Numbers

Fresh hosted scan:

- latest block: not queried
- fromBlock: not queried
- toBlock: not queried
- source block: none
- confirmations: not evaluated
- finality threshold: not evaluated

The scan range is unavailable because the run stopped before RPC access.

## Event Source

Fresh hosted scan:

- no source event parsed
- no source transaction hash
- no source BridgeOut hash
- no destination BridgeMint hash

No event was fabricated.

## Policy Result

Fresh hosted scan:

- not evaluated because env readiness failed

## Finality Result

Fresh hosted scan:

- not evaluated against live Base RPC because no RPC scan was run

## Watcher Result

Default watcher report command:

```bash
cd relayer
npm run watcher:report
```

Result:

- `ok=true`
- `dryRun=true`
- `autoFreeze=false`
- `totalFindings=0`
- `openFindings=0`
- `liveFreezeTxCount=0`
- `unexpectedLiveFreezeInDryRun=false`

Watcher smoke-state report:

- `totalFindings=6`
- `openFindings=6`
- `liveFreezeTxCount=0`
- `unexpectedLiveFreezeInDryRun=false`

## Signing Result

Fresh hosted scan:

- not attempted because env readiness failed
- signer private keys were not printed

## Submit Preview Result

Fresh hosted scan:

- no submit preview because no source event was scanned

Paper-mode safety:

- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` by default
- destination submission was not attempted

## Proof No Destination Tx Submitted

Evidence:

- env check reported `liveSubmitEnabled=false`
- paper scan was not run after env failure
- no source event was parsed
- no submit adapter was called
- no destination tx hash was produced
- watcher report showed `liveFreezeTxCount=0`

## Operator API Verification

Hosted operator API was not verified because `BRIDGE_OPERATOR_API_TOKEN` and hosted service env are absent in this shell.

Existing relayer tests continue to cover:

- daemon status output safety
- daemon message output safety
- unauthenticated mutation rejection
- authenticated tick behavior
- secret redaction in API responses

## Commands Run

- `cd relayer && npm run bridge:daemon:env:check`
- `cd relayer && npm run watcher:report`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && STATE_DIR=/tmp/white-bridge-watcher-smoke-3BKN77 npm run watcher:report`

## Passing / Failing Results

Passing:

- relayer tests: 22 suites / 320 tests
- typecheck: passed
- build: passed
- watcher smoke: passed
- watcher report: passed with `liveFreezeTxCount=0`

Blocked:

- hosted env readiness: missing env names listed above
- fresh live Base Sepolia scan: not run after env readiness failed
- hosted operator API: blocked by missing hosted token/service env

## Remaining Limitations

- Real hosted RPC/signer/operator secrets are still not present in this shell.
- Fresh Base Sepolia logs were not scanned.
- No source event was parsed from live RPC.
- Real finality was not evaluated.
- Hosted `/bridge/daemon/*` APIs were not called.
- No new live source event was generated.
- Solana destination submission remains preview-only.
- Live-testnet submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011L — run the same hosted paper scan on Render or equivalent after configuring the required secrets:

- set all required env as hosted secrets
- confirm `npm run bridge:daemon:env:check` returns `ok=true`
- run `npm run bridge:daemon:paper:scan`
- record scan range, source event or clean no-event result, finality evidence, operator API evidence, and no-submit proof
- keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
