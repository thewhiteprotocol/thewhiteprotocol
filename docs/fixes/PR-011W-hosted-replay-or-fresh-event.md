# PR-011W - Hosted Replay Or Fresh Event

## Summary

PR-011W attempted to advance from the PR-011V replay-job implementation to a hosted replay execution for the approved PR-011N Base Sepolia -> Solana Devnet message.

The hosted relayer is reachable and remains in paper mode with live submit disabled, but the approved message is still absent from hosted daemon state. This local Codex workspace does not have Render shell/job access, so it cannot execute `npm run bridge:daemon:paper:replay` inside the hosted environment where the real hosted state path and secrets exist.

No destination transaction was submitted.

## PR-011V Status

PR-011V added:

- `npm run bridge:daemon:paper:replay`
- bounded replay range checks
- paper-mode enforcement
- live-submit blocking
- expected source/destination hash checks
- sanitized replay output
- tests for replay safety and idempotency

## Hosted Env Status

Hosted public read endpoints were checked:

- `/health`: reachable
- `/bridge/daemon/status`: paper mode, running, `allowLiveTestnetSubmit=false`
- route visible: `base-sepolia -> solana-devnet`
- signer adapter visible: `env-file`
- threshold visible: `2`
- signer set version visible: `2`
- `/bridge/daemon/messages`: `[]`
- `/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`: `404`

Local env-name-only checks remain blocked, as expected, because hosted secrets are not present in this workspace. Missing names were reported only by name, with no values printed.

Continuation check after Render env update:

- current shell repo root: `/workspaces/thewhiteprotocol`
- expected Render repo root: `/opt/render/project/src`
- this shell is not the Render shell
- local env-name-only check still reports the live-source env names missing
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT` is not enabled in this shell
- `BRIDGE_DAEMON_MODE` is not set to paper in this shell

The hosted public daemon status still reports paper mode with `allowLiveTestnetSubmit=false`, but public HTTP endpoints cannot execute the replay job or source-event generation command.

## Historical Replay Result

Historical hosted replay was not executed because the replay command must run on Render or an equivalent hosted job with access to:

- hosted Base/Solana RPC env
- hosted signer env
- hosted daemon state path
- hosted paper-mode daemon config

The intended historical replay command remains:

```bash
cd relayer
BRIDGE_DAEMON_REPLAY_ROUTE=base-sepolia:solana-devnet \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=41539651 \
BRIDGE_DAEMON_SCAN_TO_BLOCK=41539691 \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56 \
npm run bridge:daemon:paper:replay
```

## Expired Deadline Result

The historical PR-011N event may now be rejected by current-time policy with `expired_deadline`. That result was not evaluated on hosted because replay could not be run from this environment.

If hosted replay returns `expired_deadline`, do not bypass policy. Generate one new approved low-value Base Sepolia -> Solana Devnet source event with a future deadline, then replay the fresh event block range.

## Fresh Event Generation Result

No fresh event was generated in PR-011W.

Reason: generating a fresh Base Sepolia source event spends testnet funds and requires private signer/prover environment. The local Codespace shell does not have `BASE_SEPOLIA_RPC_URL`/`BASE_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, or bridge signer key env names present. The operator should explicitly approve that action and fund the source wallet if needed. I will ask for funds before attempting any fresh live testnet event.

The source-event command must be run from an environment with the required secrets:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/evm"
npx tsx test/e2e-bridge-base-to-solana.ts
```

Do not run this if `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`. The command creates only the Base source event; do not submit the Solana destination transaction.

## Replay Scan Range

Approved historical range:

- source block: `41539671`
- from block: `41539651`
- to block: `41539691`

Approved historical hashes:

- source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`

## Message State Result

Hosted message state is still empty through public read APIs. The approved source hash returns 404.

Because the message is not present in hosted daemon state:

- no hosted policy result exists for PR-011W
- no hosted signatures were produced
- no hosted Solana submit preview was created
- no hosted simulation was attempted

After a fresh source event is generated, replay it with repo-root detection:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/relayer"
BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=<sourceBlock-20> \
BRIDGE_DAEMON_SCAN_TO_BLOCK=<sourceBlock+20> \
npm run bridge:daemon:paper:replay
```

Replay must report `sourceEventParsed=true`, `policyPassed=true`, `expiredDeadline=false`, `signaturesProduced=2`, `submitPreviewCreated=true`, `messagePersisted=true`, and `destinationTxSubmitted=false` before simulation is attempted.

## Simulation Result

Simulation was not attempted. The simulation command requires the approved message to exist in hosted daemon state first.

After replay succeeds and the destination BridgeMint hash is known, run:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/relayer"
BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon \
BRIDGE_APPROVED_MESSAGE_HASHES=base-sepolia->solana-devnet|<destinationBridgeMintHash> \
npm run bridge:daemon:solana:simulate
```

Simulation must not call any send API and must keep `destinationTxSubmitted=false`.

## Proof No Destination Transaction Was Submitted

- hosted daemon status reports `mode=paper`
- hosted daemon status reports `allowLiveTestnetSubmit=false`
- hosted message list is empty
- no Solana simulation was attempted
- no live submit path was called
- local replay command stopped at env checks and emitted `destinationTxSubmitted=false`

## Operator API Result

Read-only public endpoints were checked. No authenticated mutation was called because the operator token is not available in this workspace and must not be printed or committed.

## Commands Run

- `git rev-parse --show-toplevel`
- `git log --oneline -3`
- env-name-only check for required live-source and replay variables
- `curl -fsS https://relayer.thewhiteprotocol.com/health`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- inspection of `chains/evm/test/e2e-bridge-base-to-solana.ts` without printing env values
- `cd relayer && npm run bridge:daemon:env:check`
- `cd relayer && npm run bridge:daemon:paper:replay`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

## Tests Run

- Relayer tests: 24 suites / 341 tests passed
- Typecheck: passed
- Build: passed
- Watcher smoke: passed
- Watcher report: passed, `liveFreezeTxCount=0`

## Remaining Limitations

- Render shell/job replay has not been executed from this environment.
- Hosted daemon message state remains empty.
- The PR-011N historical message may now be expired.
- A fresh low-value source event may be required.
- Fresh event generation is blocked here by missing local live-source env names and lack of Render shell access.
- No Solana destination transaction was submitted.
- Live submit remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011X - Execute the bounded replay job directly on Render with the PR-011N range, or explicitly approve and fund a fresh low-value Base Sepolia -> Solana Devnet source event if the historical message is expired.
