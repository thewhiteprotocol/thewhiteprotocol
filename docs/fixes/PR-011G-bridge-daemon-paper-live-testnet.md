# PR-011G — Bridge Daemon Paper/Live-Testnet Mode

## Summary

PR-011G adds a daemonized bridge relayer orchestrator for disabled, paper, and explicitly gated live-testnet modes. It wires bridge source policy, watcher findings, signer adapters, signing policy, state transitions, and destination submit previews without enabling live submission by default.

## What PR-011F Completed

PR-011F introduced the signer custody adapter interface, local-dev and env/file testnet signers, KMS/HSM/MPC placeholders, signing policy checks, production unsafe-mode blocks, no-secret logging guidance, and signer custody docs.

## Daemon Mode

New module:

- `relayer/src/bridge/daemon.ts`

Modes:

- `disabled`: default, no ticks.
- `paper`: observe, policy-check, wait finality, sign if policy allows, generate submit preview, no submit.
- `live-testnet`: same flow plus destination submit only when all live-testnet gates pass.

## State Machine

PR-011G extends persisted bridge message state with daemon metadata and transitions:

- `observed`
- `policy_checked`
- `finality_wait`
- `ready_to_sign`
- `signed`
- `paper_ready_to_submit`
- `submitted`
- `confirmed`
- `rejected`
- `failed`
- `ignored`
- `frozen_or_blocked`

Persisted metadata includes sanitized policy decisions, signing decisions, signature metadata, submit previews, and transition history. It does not include private keys or env values.

## Policy, Watcher, And Signer Wiring

The daemon rejects unsafe source events through existing bridge policy:

- unsafe Solana `init_bridge_v1_out` is ignored
- Solana `bridge_out_v1_with_proof` is accepted when the source-bound marker is present
- EVM `bridgeOutV1` / BridgeOutbox source-bound events are accepted

The daemon blocks signing/submission when a matching open critical watcher finding exists. In live-testnet mode, any open critical finding blocks submission.

Signing uses the PR-011F signer adapter and policy gate. Paper mode may sign with a test signer if policy allows. Live-testnet mode blocks `local-dev` unless the explicit test override is set.

## Submit Preview

EVM preview:

- destination chain
- BridgeInbox target
- `acceptBridgeMint`
- message hash
- signer set version
- signature count
- route
- dry-run/would-submit flags

Solana preview:

- destination chain
- white-protocol program ID
- `accept_bridge_v1_mint`
- BridgeV1Config, signer set, consumed message, frozen message, route, asset, pending, and commitment PDA previews
- compute budget placeholder
- `liveSubmissionImplemented=false`

## Operator APIs

Added daemon endpoints through the existing bridge status router:

- `GET /bridge/daemon/status`
- `GET /bridge/daemon/messages`
- `GET /bridge/daemon/messages/:hash`
- `POST /bridge/daemon/tick`
- `POST /bridge/daemon/messages/:hash/retry`

Mutation endpoints require `BRIDGE_OPERATOR_API_TOKEN`.

## Env Defaults

Added safe placeholders:

- `BRIDGE_DAEMON_MODE=disabled`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_ALLOW_LOCAL_DEV_SIGNER_IN_LIVE_TESTNET=false`
- `BRIDGE_DAEMON_INTERVAL_MS=30000`
- `BRIDGE_DAEMON_ROUTES=...`
- `BRIDGE_DAEMON_STATE_PATH=`
- `BRIDGE_DAEMON_SUBMIT_TARGETS=`
- `BRIDGE_SIGNER_THRESHOLD=2`
- `BRIDGE_SIGNER_SET_VERSION=1`

## Tests Added

Added `relayer/src/bridge/__tests__/daemon.test.ts` covering:

- disabled default
- paper mode reaches `paper_ready_to_submit`
- paper mode does not submit
- live-testnet flag gating
- explicit live-testnet submit with mocked destination adapter
- mainnet/unknown route block
- unsafe Solana init ignored
- Solana source-bound event accepted
- EVM source-bound event accepted
- finality wait
- watcher critical finding block
- unsupported route block
- signer signs only after policy pass
- EVM submit preview
- Solana submit preview
- persisted transitions
- operator tick auth
- daemon status secret redaction

## Commands Run

- `cd relayer && npx jest src/bridge/__tests__/daemon.test.ts`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && STATE_DIR=/tmp/white-bridge-watcher-smoke-MYIyLR npm run watcher:report`

Validation results:

- Focused daemon tests: 1 suite / 18 tests passed
- Relayer tests: 21 suites / 311 tests passed
- Typecheck: passed
- Build: passed
- Watcher smoke: passed with 6 findings and 0 freeze submissions
- Watcher report: passed with `liveFreezeTxCount=0`

## Remaining Limitations

- Testnet only.
- Live submission remains disabled by default.
- Solana live destination submission is not implemented in PR-011G; only preview is included.
- No deployments.
- No circuit changes.
- No mainnet support.
- KMS/HSM/MPC adapters are still placeholders.
- `public_data_hash` remains weak/dummy-constrained in-circuit.

## Next Recommended PR

PR-011H — hosted paper-mode bridge daemon observation:

- run hosted paper mode on current testnet routes
- collect daemon state reports
- compare daemon previews with known E2E transactions
- add operator review checklist for enabling narrowly scoped live-testnet submit
- keep mainnet disabled
