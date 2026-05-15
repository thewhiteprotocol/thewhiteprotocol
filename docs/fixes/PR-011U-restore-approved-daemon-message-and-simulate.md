# PR-011U — Restore Approved Daemon Message And Simulate

## Summary

PR-011U attempted to restore or replay the approved PR-011N Base Sepolia -> Solana Devnet daemon message into hosted state, then rerun Solana simulation.

The hosted relayer is reachable, running in paper mode, and has live submit disabled. The approved message is still not present in hosted daemon state. Public hosted APIs do not expose a safe replay endpoint, and this local shell does not have the hosted operator token, Render shell access, hosted state path, hosted RPC env, or approval env.

No transaction was submitted and no Solana state was mutated.

## PR-011T Blocker

PR-011T found:

- hosted daemon `/bridge/daemon/status` works
- hosted daemon mode is `paper`
- `allowLiveTestnetSubmit=false`
- route `base-sepolia -> solana-devnet` is visible
- signer adapter is `env-file`
- threshold is `2`
- signer set version is `2`
- `/bridge/daemon/messages` returns `[]`

That blocker remains in PR-011U.

## Hosted State And Path Audit

Public hosted endpoint result:

- `/bridge/daemon/status` does not expose `BRIDGE_DAEMON_STATE_PATH`
- `/bridge/daemon/messages` returns an empty list
- `/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc` returns 404

State path result:

- hosted state path cannot be confirmed through public read endpoints
- state persistence cannot be verified from this local environment
- the empty message list suggests either the approved message was not replayed after deploy or the hosted state path is empty/ephemeral

Recommended hosted setting:

- mount a persistent Render disk
- set `BRIDGE_DAEMON_STATE_PATH` to the mounted disk path
- run replay/scans with the same path used by the long-running daemon

## Approval Env Status

Local command result:

```bash
cd relayer && npm run bridge:daemon:solana:simulate
```

Blocked before RPC access with missing names:

- `BRIDGE_APPROVED_MESSAGE_HASHES`
- `BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)`
- `BRIDGE_DAEMON_STATE_PATH or STATE_DIR`
- `SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT`

The hosted approval env cannot be verified through public read endpoints.

Required approval:

```text
base-sepolia->solana-devnet|0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56
```

## Replay Method

Intended hosted replay scan:

- source tx: `0xf0f3f4f12ddbd2ade17334f72a4a348dce614b706ad6427077840dbf9cfef866`
- source block: `41539671`
- scan range: `41539651` to `41539691`
- route: `base-sepolia -> solana-devnet`

Required hosted command:

```bash
cd relayer && BRIDGE_DAEMON_SCAN_FROM_BLOCK=41539651 BRIDGE_DAEMON_SCAN_TO_BLOCK=41539691 npm run bridge:daemon:paper:scan
```

This was not run from the local shell because the local shell does not have hosted RPC/state/signer/operator env.

## Event Replay Result

Replay was not performed.

Blocker:

- no hosted shell/job runner available in this environment
- no operator token available locally for an authenticated hosted mutation
- no public replay endpoint exists
- hosted message list remains empty

No deadline-policy bypass was attempted.

## Daemon Message State Result

Hosted read endpoints:

- `/bridge/daemon/status`: ok
- `/bridge/daemon/messages`: `[]`
- `/bridge/daemon/messages/<source BridgeOut hash>`: 404

Expected state after successful replay:

- status `paper_ready_to_submit`
- source hash `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- destination hash `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`
- signatures count `2`
- Solana submit preview present
- `submitTxHash=null`

## Pre-Submit Checks

Not run.

Reason: the approved message could not be loaded from hosted daemon state.

Expected checks after replay:

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

## Simulation Result

Simulation was not attempted.

Reason: message restoration/replay is blocked, so the simulator cannot load the approved destination message and signatures.

## Compute Units And Logs

- compute units: none
- logs captured: none

## Proof No Transaction Was Sent

- hosted daemon reports `allowLiveTestnetSubmit=false`
- hosted daemon mode is `paper`
- `/bridge/daemon/messages` is empty
- local simulation command stopped before RPC access
- no send command was run
- no destination submit tx hash exists

## Commands Run

- `curl -fsS https://relayer.thewhiteprotocol.com/health` — passed
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status` — passed
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages` — passed, empty
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc` — returned 404
- `cd relayer && npm run bridge:daemon:env:check` — local env blocked; names only
- `cd relayer && npm run bridge:daemon:solana:simulate` — local env blocked before RPC; names only
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
- route metadata visible
- signer adapter and threshold visible
- relayer tests/typecheck/build pass
- watcher smoke/report pass

Blocked:

- approved message not present in hosted daemon state
- hosted state path cannot be audited through public endpoints
- no safe hosted replay shell/API path is available locally
- simulation not attempted

## Remaining Limitations

- Restore/replay still requires Render shell/job access or an authenticated operator endpoint.
- If the PR-011N deadline has expired, the replay will correctly reject and a fresh approved low-value source event will be needed.
- No simulation logs or compute units were captured.
- Live submit remains disabled.
- `liveSubmissionImplemented=false`.
- Not production-ready.

## Next Recommended PR

PR-011V — hosted replay job/operator endpoint:

- add or run a hosted-only authenticated replay job for a bounded block range
- keep live submit disabled
- restore the approved message into persistent daemon state
- rerun `npm run bridge:daemon:solana:simulate`
- if the PR-011N event is expired, request approval for one fresh low-value source event
