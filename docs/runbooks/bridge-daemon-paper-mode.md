# Bridge Daemon Paper Mode Runbook

**Status:** Testnet-only operational runbook. Not production-ready.

## Summary

PR-011G adds `relayer/src/bridge/daemon.ts`, a daemonized bridge relayer mode that wires source observations, production policy, watcher findings, signer adapters, state persistence, and destination submit previews.

The default mode is `disabled`. The recommended hosted path is `paper` mode first. Paper mode can validate policy, wait finality, build destination messages, run signer policy, optionally sign with a configured testnet signer adapter, and generate submit previews. It does not submit destination transactions.

## Modes

| Mode | Behavior |
| --- | --- |
| `disabled` | No daemon ticks. Default. |
| `paper` | Observes and evaluates messages, signs only if policy allows, creates submit previews, never submits. |
| `live-testnet` | Testnet-only submit path, gated by explicit env flags and watcher/signer policy. |

## Safety Defaults

Required defaults:

- `BRIDGE_DAEMON_MODE=disabled`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_ALLOW_LOCAL_DEV_SIGNER_IN_LIVE_TESTNET=false`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_WATCHER_DRY_RUN=true`

Mainnet is blocked. Unknown or non-testnet routes are not eligible for live-testnet submission.

## Paper Mode Setup

Set only non-secret daemon config in checked-in examples:

```bash
BRIDGE_DAEMON_MODE=paper
BRIDGE_DAEMON_INTERVAL_MS=30000
BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet,solana-devnet:base-sepolia
BRIDGE_DAEMON_STATE_PATH=/app/data
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false
BRIDGE_SIGNER_MODE=env-file
BRIDGE_SIGNER_KEY_FILE=/app/secrets/bridge-signers.env
BRIDGE_OPERATOR_API_TOKEN=<hosted secret>
```

Do not commit signer files, RPC secrets, operator tokens, webhook URLs, or wallet files.

## Hosted Observation Checklist

1. Store RPC URLs, signer key file/private-key env, operator token, and optional webhook URL as hosted secrets.
2. Set `BRIDGE_DAEMON_MODE=paper`.
3. Set `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.
4. Set `BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet`.
5. Set `BRIDGE_DAEMON_STATE_PATH=/app/data` or another persistent hosted path.
6. Set `BASE_SEPOLIA_RPC_URL` or `BASE_RPC_URL`.
7. Set `SOLANA_DEVNET_RPC_URL` or `RPC_ENDPOINT`.
8. Set `BRIDGE_SIGNER_MODE=env-file` plus `BRIDGE_SIGNER_KEY_FILE`, or set `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`.
9. Set `BRIDGE_OPERATOR_API_TOKEN`.
10. Confirm hosted logs never print secret values.

Before starting hosted observation:

```bash
cd relayer
npm run bridge:daemon:env:check
```

The env check prints names only. It must show `ok=true` before hosted live-log scanning.

PR-011J re-ran this path in the local shell. The check remained environment-blocked because hosted RPC, signer, operator token, daemon mode, route, and state-path env names were missing. The command reported missing names only and no fresh RPC scan was attempted.

PR-011K repeated the hosted-real-secrets gate. The same required hosted env names were still absent in the local shell, so operators must configure them in the host before running the fresh scan. Do not run `bridge:daemon:paper:scan` after a failed env check.

## Fresh Live Log Scan

PR-011I adds a live-log paper scanner:

```bash
cd relayer
npm run bridge:daemon:paper:scan
```

The scanner:

- requires hosted env/secrets to be configured
- scans Base Sepolia `BridgeOutInitiated` logs from the configured BridgeOutbox
- uses `BRIDGE_DAEMON_SCAN_LOOKBACK_BLOCKS=1000` by default to stay below public RPC log-range limits
- optionally accepts `BRIDGE_DAEMON_SCAN_FROM_BLOCK` and `BRIDGE_DAEMON_SCAN_TO_BLOCK`
- computes live confirmations from Base RPC
- keeps `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- writes daemon state and submit previews only

If no fresh source event exists in the scan window, the command exits cleanly with zero observed messages. Operators can widen the lookback or set an explicit block range for a known source transaction.

If the env check fails, do not override the scanner locally with ad hoc secrets. Configure the missing names as hosted secrets, rerun `npm run bridge:daemon:env:check`, and only then run `npm run bridge:daemon:paper:scan`.

Known historical events can be scanned with explicit range env:

```bash
BRIDGE_DAEMON_SCAN_FROM_BLOCK=<source block - 20>
BRIDGE_DAEMON_SCAN_TO_BLOCK=<source block + 20>
npm run bridge:daemon:paper:scan
```

Old events may parse correctly but still be rejected by current-time policy if their bridge message deadline has expired. Treat that as a valid policy result, not a signer failure.

Fresh source-event paper scans should end in `paper_ready_to_submit` only when all of the following are true:

- source event was produced by the production source-bound path
- source event has reached the configured finality threshold
- bridge policy accepted the message
- watcher did not block the message
- signer policy accepted the message
- paper mode generated signatures and a sanitized submit preview
- `submitTxHash` remains `null`

Hosted observation loop:

1. Start the service.
2. Check `GET /bridge/daemon/status`.
3. Trigger `POST /bridge/daemon/tick` with the operator token, or wait for the daemon interval.
4. Check `GET /bridge/daemon/messages`.
5. Check `GET /bridge/daemon/messages/:hash`.
6. Generate the watcher report with `npm run watcher:report`.
7. Confirm every message has `submitTxHash=null`.
8. Confirm any not-final message remains `finality_wait` until enough confirmations are observed.
9. Confirm any signed message reaches `paper_ready_to_submit`.
10. Keep all live-submit flags disabled.

## One-Shot Historical Replay

PR-011H adds an offline paper-mode replay command:

```bash
cd relayer
npm run bridge:daemon:paper:once
```

By default it replays the documented PR-010W Base Sepolia -> Solana Devnet historical `BridgeOut` artifact from `chains/evm/test/base-to-solana-bridge-state.json`. The replay runs with `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`, uses paper mode, and does not call destination submit. Because the historical message deadline is now expired, the command evaluates policy at the historical observation timestamp and reports that timestamp in `historicalReplayAsOf`.

To inspect persisted state:

```bash
BRIDGE_DAEMON_STATE_PATH=/tmp/pr011h-paper-state npm run bridge:daemon:paper:status
```

The command reports missing live RPC env var names when a fresh live scan cannot be run. It does not print env values.

## Status And Messages

Read endpoints:

- `GET /bridge/daemon/status`
- `GET /bridge/daemon/messages`
- `GET /bridge/daemon/messages/:hash`

Mutation endpoints require `BRIDGE_OPERATOR_API_TOKEN`:

- `POST /bridge/daemon/tick`
- `POST /bridge/daemon/messages/:hash/retry`

Use either `Authorization: Bearer <token>` or `x-bridge-operator-token: <token>`.

## Signing Policy

The daemon calls the PR-011F signer policy before signing. Signing is blocked unless:

- bridge source policy accepted the message
- finality is satisfied
- route and asset are supported
- amount is within cap
- there is no open critical watcher finding for the message
- purpose is `bridge-attestation`
- message format is `BridgeMessageV1`
- signer adapter mode is allowed for the environment

## Watcher Blocks

Open critical watcher findings block signing and live submission. In live-testnet mode, any open critical watcher finding blocks submission globally until triaged.

## Submit Preview

Paper mode records a sanitized `submissionPreview` in bridge state:

- EVM: `acceptBridgeMint` target, message hash, signer set version, signature count, route, and calldata preview text.
- Solana: `accept_bridge_v1_mint` program, PDA account preview, compute-budget placeholder, and `liveSubmissionImplemented=false`.

Previews contain no private keys or raw env values.

## Live-Testnet Requirements

Live-testnet submission requires all of:

- `BRIDGE_DAEMON_MODE=live-testnet`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`
- all configured routes are testnet routes
- no open critical watcher findings
- signer adapter is not `local-dev`, unless `BRIDGE_ALLOW_LOCAL_DEV_SIGNER_IN_LIVE_TESTNET=true` for controlled tests
- destination adapter is configured
- signer policy accepts the message

Mainnet remains unsupported.

## Approval Checklist Before Live-Testnet Submission

Do not enable live-testnet submission until all items are true:

- hosted paper mode has run through the intended observation window
- no unexpected open critical watcher findings exist
- paper messages show correct route, asset, amount, finality, signatures, and preview
- operator API outputs contain no secrets
- signer mode is not `local-dev`
- route-specific caps are reviewed
- Solana preview account derivations are reviewed against live testnet accounts
- explicit operator approval is recorded outside git
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true` is approved only for a narrow testnet route/window

Use `docs/runbooks/bridge-operator-approval-checklist.md` for message-specific approval review. PR-011O applied that checklist to the fresh PR-011N Base Sepolia -> Solana Devnet message and kept the approval decision on hold for live submission because the current Solana submit preview is still preview-only and must be reconciled against the destination BridgeMint hash, deployed signer set version, and real Solana account inputs.

## Stop Criteria

Stop rollout and return to `BRIDGE_DAEMON_MODE=disabled` if:

- any live-testnet tx appears while `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- watcher reports open critical findings
- daemon status exposes any secret value
- messages repeatedly fail finality or route policy unexpectedly
- Solana submit preview account derivations do not match deployed testnet config

## Remaining Limitations

- Testnet only.
- No live Solana submit implementation in PR-011G; Solana paper preview is implemented.
- Live EVM submit remains gated and is not enabled by default.
- No mainnet support.
- KMS/HSM/MPC signer adapters remain placeholders.
- `public_data_hash` remains weak/dummy-constrained in the current circuit.
