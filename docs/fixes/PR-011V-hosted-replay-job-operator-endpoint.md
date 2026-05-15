# PR-011V - Hosted Replay Job / Operator Endpoint

## Summary

PR-011V adds a hosted-safe bounded replay job for bridge daemon paper mode. The command can replay a known source block range into daemon state when it is run inside the hosted environment with the same persistent state path used by the running daemon.

No destination transaction submission is enabled. No Solana state mutation is performed.

## PR-011U Blocker

PR-011U confirmed the hosted relayer was reachable and running in paper mode, but hosted daemon state was empty:

- `/health`: reachable
- `/bridge/daemon/status`: paper mode, live submit disabled
- `/bridge/daemon/messages`: empty list
- `/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`: 404

Because the approved PR-011N message was absent from hosted state, Solana simulation could not be attempted.

## Replay Mechanism Chosen

PR-011V implements a CLI/job command:

```bash
cd relayer
npm run bridge:daemon:paper:replay
```

The command is designed for a Render shell/job or equivalent hosted execution context. It writes to `BRIDGE_DAEMON_STATE_PATH`, so it can restore the approved message into the same state store used by hosted daemon APIs.

No operator endpoint was added in this PR. A CLI/job path is narrower and avoids exposing replay as a public HTTP mutation.

## Safety Rules

The replay job enforces:

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` or unset
- configured testnet route only
- explicit `BRIDGE_DAEMON_SCAN_FROM_BLOCK`
- explicit `BRIDGE_DAEMON_SCAN_TO_BLOCK`
- maximum replay range of 500 blocks
- optional expected source and destination message-hash checks
- no destination adapter configuration
- no destination transaction submission
- sanitized CLI output without raw signer keys, env values, RPC URLs, operator tokens, or raw signature arrays

If live submit is enabled, replay refuses to run.

## Replay Command

For the approved PR-011N message, run on the hosted environment:

```bash
cd relayer
BRIDGE_DAEMON_REPLAY_ROUTE=base-sepolia:solana-devnet \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=41539651 \
BRIDGE_DAEMON_SCAN_TO_BLOCK=41539691 \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56 \
npm run bridge:daemon:paper:replay
```

## Approved Range And Message Hashes

- Route: `base-sepolia -> solana-devnet`
- Source block: `41539671`
- Replay range: `41539651` to `41539691`
- Source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- Destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`

## Hosted Replay Result

Hosted replay was not run from this local Codex shell because there is no Render shell/job access or hosted operator token in this environment.

The hosted public API was checked before this PR and still showed the approved message missing from daemon state. The replay job is now available for hosted execution.

## Hosted Message State Result

Current hosted read endpoints after local implementation:

- `/bridge/daemon/status`: paper mode, `allowLiveTestnetSubmit=false`, route `base-sepolia -> solana-devnet`, signer adapter `env-file`, threshold `2`, signer set version `2`
- `/bridge/daemon/messages`: `[]`

Expected after hosted replay succeeds:

- message is visible in `/bridge/daemon/messages`
- source hash is preserved
- destination hash is present if policy reaches destination transform
- `submitTxHash=null`
- `destinationTxSubmitted=false`

If the PR-011N message has expired under current-time policy, replay should persist or report the policy rejection and no signatures/preview should be produced. Do not bypass `expired_deadline`.

## Simulation Result

Simulation was not attempted in this PR because hosted message state is still empty until the replay job is run on Render.

## Proof No Destination Transaction Was Submitted

- Replay command requires paper mode.
- Replay command blocks live submit.
- Replay command does not configure destination submit adapters.
- `destinationTxSubmitted=false` is emitted on all blocked/replay result paths.
- No Solana send path was called.

## Commands Run

- `curl -fsS https://relayer.thewhiteprotocol.com/health`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- `cd relayer && npm run bridge:daemon:paper:replay`
- `cd relayer && npm run test -- --runTestsByPath src/bridge/__tests__/daemon-paper-replay.test.ts`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

## Tests Run

Replay tests cover:

- env check requires paper mode, bounded range, and live submit disabled
- replay persists a valid approved message
- replay is idempotent
- replay refuses when live submit is enabled
- replay refuses an unbounded block range
- expected source hash mismatch blocks replay result
- expired deadline is persisted/reported safely without signatures or submit preview

Validation results:

- Relayer tests: 24 suites / 341 tests passed
- Typecheck: passed
- Build: passed
- Watcher smoke: passed, 6 deterministic findings and 0 freeze submissions
- Watcher report: passed, `liveFreezeTxCount=0`

## Remaining Limitations

- Hosted replay still must be run from Render or another environment with access to hosted secrets and the persistent daemon state path.
- No authenticated HTTP replay endpoint was added.
- The approved PR-011N message may now be rejected by current-time deadline policy.
- If the PR-011N message is expired, a fresh low-value source event is needed for simulation/live-submit readiness.
- Live submit remains disabled.
- Solana destination transaction submission remains unexecuted.
- Not production-ready.

## Next Recommended PR

PR-011W - Run hosted bounded replay job on Render and, if the approved PR-011N message is expired, generate a fresh approved low-value source event for replay and simulation.
