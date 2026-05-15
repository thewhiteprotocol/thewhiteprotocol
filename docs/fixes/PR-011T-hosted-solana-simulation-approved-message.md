# PR-011T — Hosted Solana Simulation For Approved Message

## Summary

PR-011T attempted the hosted approved-message Solana simulation path for the PR-011N Base Sepolia -> Solana Devnet destination BridgeMint message.

The hosted relayer is reachable and running in paper mode with live submission disabled. However, the hosted daemon message store currently returns no daemon messages, so the approved PR-011N message cannot be loaded from hosted state and simulation cannot proceed.

No transaction was submitted.

## Approved Destination Hash

- Route: `base-sepolia->solana-devnet`
- Source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- Destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`

## Hosted Env Status

Public hosted checks:

- `GET https://relayer.thewhiteprotocol.com/health` returned `status=ok`
- `GET https://relayer.thewhiteprotocol.com/bridge/daemon/status` returned:
  - mode: `paper`
  - running: `true`
  - `allowLiveTestnetSubmit=false`
  - route: `base-sepolia -> solana-devnet`
  - signer adapter: `env-file`
  - threshold: `2`
  - signer set version: `2`

Local simulation command:

```bash
cd relayer && npm run bridge:daemon:solana:simulate
```

Local result:

- blocked before RPC access
- missing env names:
  - `SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT`
  - `BRIDGE_DAEMON_STATE_PATH or STATE_DIR`
  - `BRIDGE_APPROVED_MESSAGE_HASHES`
  - `BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)`
- destination transaction submitted: no

The local shell does not have Render secrets or the hosted daemon state path.

## Message Loaded Status

Public hosted daemon messages endpoint:

- `GET https://relayer.thewhiteprotocol.com/bridge/daemon/messages`
- result: `{"messages":[]}`

Because the hosted message list is empty, the PR-011N destination message could not be loaded by hash from hosted state.

## Pre-Submit Idempotency Checks

Not run.

Reason: the approved daemon message was not present in hosted state, so the command could not reconstruct the exact transaction preview and accounts for simulation.

Expected checks once the message is restored:

- program executable
- BridgeV1Config exists
- signer set v2 exists
- route config exists
- asset config exists
- pending buffer exists
- pool config exists
- Merkle tree exists
- asset vault exists
- consumed message PDA absent
- frozen message PDA absent
- commitment index PDA absent

## Simulation Request

Not attempted.

Reason: message load blocked before RPC simulation.

Expected simulation request once hosted state is restored:

- assemble `accept_bridge_v1_mint`
- include compute budget instructions
- use destination BridgeMint message
- use signer set version `2`
- use 2 persisted threshold signatures
- use real deployed Solana Devnet accounts
- call `simulateTransaction` with `sigVerify=false`
- do not call send APIs

## Simulation Result

- simulation attempted: no
- simulation result: blocked by missing hosted message state
- compute units: none
- logs captured: none

## Proof No Transaction Was Sent

- hosted daemon mode is `paper`
- hosted daemon reports `allowLiveTestnetSubmit=false`
- local simulation command stopped before RPC access
- public hosted message list is empty, so no target message was submitted
- no submit tx hash exists in hosted daemon messages

## Operator Status/API Result

Read-only public API checks:

- `/health`: ok
- `/bridge/daemon/status`: ok, paper mode, live submit disabled
- `/bridge/daemon/messages`: ok, empty list

No authenticated mutation endpoint was called.

## Commands Run

- `cd relayer && npm run bridge:daemon:env:check` — local environment blocked; names only
- `cd relayer && npm run bridge:daemon:solana:simulate` — local environment blocked before RPC; names only
- `curl -fsS https://relayer.thewhiteprotocol.com/health` — passed
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status` — passed
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages` — passed, empty
- `cd relayer && npm run test` — passed
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed
- `cd relayer && npm run watcher:smoke` — passed
- `cd relayer && npm run watcher:report` — passed

## Passing And Failing Results

Passing:

- hosted relayer reachable
- hosted daemon running in paper mode
- live submit disabled
- route and signer metadata visible
- relayer tests/typecheck/build pass
- watcher smoke/report pass

Blocked:

- hosted daemon state does not currently contain the approved PR-011N message
- hosted simulation was not attempted
- compute units/logs are not available yet

## Remaining Limitations

- The approved PR-011N message must be restored or replayed into hosted daemon state.
- `BRIDGE_APPROVED_MESSAGE_HASHES` cannot be verified through public read endpoints.
- Hosted shell/job execution is not available from this local environment.
- No Solana simulation logs or compute units were captured.
- Live submit remains disabled.
- `liveSubmissionImplemented=false`.
- Not production-ready.

## Next Recommended PR

PR-011U — restore/replay approved daemon message into hosted state and rerun Solana simulation:

- confirm `BRIDGE_APPROVED_MESSAGE_HASHES` on Render
- replay the PR-011N message or re-run the known block scan so `/bridge/daemon/messages` contains it
- run `npm run bridge:daemon:solana:simulate` in the hosted environment
- capture pre-submit checks, simulation logs, and compute units
- keep live submit disabled
