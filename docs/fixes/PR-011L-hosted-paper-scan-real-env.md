# PR-011L — Hosted Paper Scan With Real Env

## Summary

PR-011L verified the hosted Render relayer after the operator configured bridge daemon paper-mode env values and after the daemon code was deployed to `main`.

The hosted daemon is now live in `paper` mode for Base Sepolia -> Solana Devnet. Live destination submission is disabled. The daemon scanned Base Sepolia through the hosted background tick path and produced a clean no-event result for the current scan window.

No destination transaction was submitted. No private env values, signer keys, RPC URLs with keys, operator token, or `.env` contents were printed.

## Hosted Env Readiness Result

Hosted readiness is confirmed through the running service status:

- daemon mode: `paper`
- daemon enabled: `true`
- daemon running: `true`
- `allowLiveTestnetSubmit=false`
- signer adapter: `env-file`
- signer threshold: `2`
- route: `base-sepolia -> solana-devnet`
- route enabled: `true`
- `testnetOnly=true`

The local shell is not the hosted Render shell. Running `npm run bridge:daemon:env:check` locally still reports missing local env names only and is not used as hosted readiness evidence.

## Exact Env Names Checked

Required hosted paper env names:

- `BASE_SEPOLIA_RPC_URL` or `BASE_RPC_URL`
- `SOLANA_DEVNET_RPC_URL` or `RPC_ENDPOINT`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_SIGNER_MODE`
- `BRIDGE_SIGNER_KEY_FILE` or `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`
- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet`
- `BRIDGE_DAEMON_STATE_PATH`
- `BRIDGE_DAEMON_SCAN_LOOKBACK_BLOCKS=1000`

No env values were printed.

## Route Tested

- Base Sepolia -> Solana Devnet

## Fresh Live Scan

The hosted background daemon ran real Base Sepolia scan ticks.

Hosted daemon status after the final deploy:

- `mode=paper`
- `running=true`
- `tickCount=3`
- `lastTickDurationMs=179`
- `messagesByStatus={}`
- `allowLiveTestnetSubmit=false`

Hosted message list:

- `messages=[]`

This is a clean no-event scan for the current lookback window.

## Scan Range

Configured scan range:

- `BRIDGE_DAEMON_SCAN_LOOKBACK_BLOCKS=1000`
- explicit from block: not set
- explicit to block: not set

The first hosted attempt with a 5000-block lookback reached Base Sepolia RPC and was rejected by the provider because the query exceeded its 2000-block log range. PR-011L then reduced the daemon and one-shot scanner default to 1000 blocks. After redeploy, hosted daemon ticks completed successfully.

## Event Source

Fresh hosted scan:

- no source event found in the current 1000-block window
- no source transaction hash
- no source BridgeOut hash
- no destination BridgeMint hash

No event was fabricated.

## Policy Result

No fresh event reached bridge policy because the hosted scan returned no events.

## Finality Result

Base Sepolia RPC was reached by the hosted daemon scan path. No event was found, so no per-message confirmation/finality result was produced.

## Watcher Result

Local watcher report command:

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

Hosted watcher status is present but requires operator auth, returning `401` for unauthenticated reads.

## Signing Result

No fresh hosted event reached signing. Hosted signer status reports:

- adapter: `env-file`
- threshold: `2`

No signer private keys were printed.

## Submit Preview Result

No submit preview was generated because no fresh source event was found in the current scan window.

## Proof No Destination Tx Submitted

Evidence:

- daemon mode is `paper`
- `allowLiveTestnetSubmit=false`
- daemon messages list is empty
- `/bridge/status` counters show `submitted=0`
- no `submitTxHash` exists
- watcher report showed `liveFreezeTxCount=0`

## Operator API Verification

Read-only public checks:

- `/health`: reachable
- `/bridge/status`: reachable
- `/bridge/daemon/status`: reachable
- `/bridge/daemon/messages`: reachable
- `/bridge/watcher/status`: `401` without operator token

Mutation endpoints were not called because the operator token must not be printed or passed through this transcript.

## Commands Run

- `curl -fsS https://relayer.thewhiteprotocol.com/health`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/status`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/watcher/status`
- `cd relayer && npm run bridge:daemon:env:check`
- `cd relayer && npm run bridge:daemon:paper:scan`
- `cd relayer && npm run watcher:report`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `npm run build:core && npm run build:relayer`

## Passing / Failing Results

Passing:

- hosted `/health`: passed
- hosted `/bridge/status`: passed
- hosted `/bridge/daemon/status`: passed
- hosted `/bridge/daemon/messages`: passed
- hosted Base Sepolia scan tick: passed with clean no-event result
- watcher report: passed with `liveFreezeTxCount=0`
- relayer tests: 22 suites / 320 tests
- typecheck: passed
- root build: passed

Not performed:

- authenticated hosted mutation tick, because the operator token was not used in this transcript
- signer/preview path for a fresh event, because no event was found in the current scan window

## Remaining Limitations

- No fresh Base Sepolia BridgeOut event was found in the current hosted scan window.
- No live message reached policy, finality, signing, or submit-preview generation.
- Hosted watcher read endpoint is auth-gated.
- Solana destination submission remains preview-only.
- Live-testnet submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011M — hosted paper scan with a known recent BridgeOut event or explicit block range:

- keep `BRIDGE_DAEMON_MODE=paper`
- keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- set `BRIDGE_DAEMON_SCAN_FROM_BLOCK` / `BRIDGE_DAEMON_SCAN_TO_BLOCK` around a known recent source transaction, or generate a low-value source event with explicit operator approval
- verify policy, live finality, signatures, Solana preview, and no-submit proof
