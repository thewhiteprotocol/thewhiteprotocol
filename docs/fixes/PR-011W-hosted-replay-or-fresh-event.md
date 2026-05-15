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

Fresh event generation succeeded on Render after funding and after committing the source-event script/circuit path fixes.

Evidence:

- Base deployer: `0x0101BBe3a30250e4f544eA7c2Ae956b52921B6E1`
- Base deposit tx: `0x15f2ee7a9ee67ebb191502d1113a836707078f4b84f07e681e880cd2e5da2bcb`
- Base settlement tx: `0xa40c186bfcbbf7af45d273a3f15b6f44dcc79c69d09da359961a08ff821ecda9`
- Base bridgeOutV1 tx: `0xd77bbffeb250c4e68f9717f2c6885b748a10b32618a96ec82b26f35926cb3a8b`
- Source block: `41544840`
- Source BridgeOut hash: `0xf458b7b9008624410123e2484b299f841fff071c2f9525a0b082af4d8b5b74a7`
- Destination BridgeMint hash: `0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf`
- Source nullifier spent: `true`
- Source amount: `1000000000000000` wei
- Destination amount: `1000000` lamports
- Normalization: exact 18 -> 9 decimal normalization

The source-event command must be run from an environment with the required secrets:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/evm"
npx tsx test/e2e-bridge-base-to-solana.ts
```

PR-011W continuation committed the source-event script so Render deployments can run it. The script accepts `BASE_DEPLOYER_PRIVATE_KEY` as a deployer fallback and accepts the comma-separated `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET` value directly.

The first Render source-event attempt reached deposit proof generation and then failed because the Render checkout did not have the old `circuits/deposit/build` layout. The script was updated to resolve both the old root circuit layout and the relayer/Render circuit layout without hardcoding a Codespace or Render root path.

Do not run this if `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`. The command creates only the Base source event; do not submit the Solana destination transaction.

## Replay Scan Range

Approved historical range:

- source block: `41539671`
- from block: `41539651`
- to block: `41539691`

Approved historical hashes:

- source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`

Fresh replay range:

- from block: `41544820`
- to block: `41544860`
- source BridgeOut hash: `0xf458b7b9008624410123e2484b299f841fff071c2f9525a0b082af4d8b5b74a7`
- destination BridgeMint hash: `0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf`

## Message State Result

Hosted fresh replay succeeded:

- status: `replayed`
- source event parsed: `true`
- policy passed: `true`
- expired deadline: `false`
- finality satisfied: `true`
- signatures produced: `2`
- submit preview created: `true`
- message persisted: `true`
- message status: `paper_ready_to_submit`
- destination tx submitted: `false`
- submit tx hash: `null`

The replay output preserved the source BridgeOut hash separately and used the destination BridgeMint hash as the daemon message hash.

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

Simulation was attempted after fresh replay but initially blocked because the simulation command still targeted the old PR-011N destination BridgeMint hash. PR-011W continuation updates `bridge:daemon:solana:simulate` to select the route-scoped approved destination hash from `BRIDGE_APPROVED_MESSAGE_HASHES`, or an explicit `BRIDGE_SIMULATION_DESTINATION_MESSAGE_HASH`, so fresh approved messages can be simulated without editing code.

After redeploying that target-hash fix, simulation found the fresh message but failed with `Invalid arguments` from the Solana web3 simulation call. The simulation path was updated to simulate a `VersionedTransaction` with `sigVerify=false` and to return sanitized failure details instead of throwing. No send API is called.

After redeploying the `VersionedTransaction` simulation fix, hosted simulation reached Solana RPC:

- pre-submit checks: `ready_for_operator_approval`
- simulation attempted: `true`
- `sigVerify=false`
- simulation result: `failed`
- compute units: `0`
- logs: none returned
- destination transaction submitted: `false`
- state mutation observed: `false`

PR-011W continuation adds `simulationResult` and `simulationError` to the hosted simulation command output so the next run exposes the exact sanitized Solana RPC failure.

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
- fresh replay reported `destinationTxSubmitted=false`
- simulation blocker reported `destinationTxSubmitted=false`
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
- `cd chains/evm && npx tsx test/e2e-bridge-base-to-solana.ts`
- fresh replay command over blocks `41544820` to `41544860`
- `cd relayer && npm run bridge:daemon:solana:simulate`
- `cd relayer && npm run test -- --runTestsByPath src/bridge/__tests__/daemon-solana-simulate.test.ts`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
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
- Hosted fresh message is in paper state.
- Hosted Solana simulation needs redeploy of the dynamic approved-hash patch, then rerun with the fresh destination BridgeMint hash.
- No Solana destination transaction was submitted.
- Live submit remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011X - Rerun hosted Solana simulation for the fresh approved destination BridgeMint hash after the dynamic simulation-target patch is deployed.
