# PR-013F - Solana to Base Durable Paper State Approval

## Summary

PR-013F adds a read-only fixture reconstruction command for the PR-013A Solana Devnet -> Base Sepolia source transaction and validates the restored fixture path flow locally. The command reconstructs the non-secret source fixture from the finalized public Solana transaction without generating a new source event and without submitting any Base transaction.

The original PR-013A message is now expired, so paper replay correctly stops at `expired_deadline`. Approval and guarded submit were not attempted.

## PR-013E Blocker

PR-013E could not restore state because `/data` was not mounted in the local workspace and both the durable fixture and the old `/tmp` fixture were unavailable.

PR-013F addresses the missing fixture reconstruction command:

```bash
cd relayer
npm run bridge:solana-to-base:fixture-from-tx
```

## Durable Fixture Reconstruction Result

Validated command with local output path:

```bash
BRIDGE_SOLANA_SOURCE_FIXTURE_PATH=/tmp/pr013f-solana-to-base-source-fixture.json \
npm run bridge:solana-to-base:fixture-from-tx
```

Result:

- ok: `true`
- source tx: `1JFuyazkGGMeTAo2Qg65XxfMCtvSwUHxad3p6kbKnsN5niecpKe3mhBfFUh9x5v89V26oJHAvrcMbra2cx4AbA2`
- source slot: `463688066`
- source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- source amount: `1000000`
- normalized destination amount: `1000000000000000`
- deadline: `1779289023`
- source event parsed: `true`
- finality satisfied: `true`
- destination tx submitted: `false`
- secrets printed: `false`

Render should use the durable output path:

```text
/data/bridge-results/solana-to-base-source-fixture-0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2.json
```

## Durable Paper Replay Result

Local paper replay was run from the reconstructed fixture into a local paper state path. It parsed and persisted the source message, then stopped on policy:

- status: `rejected`
- source event parsed: `true`
- policy passed: `false`
- expired deadline: `true`
- finality satisfied: `false`
- signatures produced: `0`
- Base submit preview: `false`
- message persisted: `true`
- destination tx submitted: `false`
- blocker: `expired_deadline`

This is the correct fail-closed result. The message cannot proceed to approval or submit after expiration.

## Approval Rerun Result

Approval was not rerun because replay did not produce a `paper_ready_to_submit` message.

Required approval state remains:

- deployed Base signer set version `1`
- threshold `2`
- destination hash signed
- source hash preserved
- route enabled
- asset supported
- message not consumed
- message not frozen
- simulation/callStatic passes

## Simulation Result

- simulation attempted: `false`
- simulation result: not run due `expired_deadline`
- gas estimate: not captured

## No-Submit Proof

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- guarded submit was not invoked
- `submitTxHash=null`
- `destinationTxSubmitted=false`

## Tests Run

- `cd relayer && npm run test -- solana-source-adapter`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- The PR-013A message is expired and cannot be submitted.
- Render still needs to run the fixture command against `/data/bridge-results` if durable archival evidence is desired.
- A new approved low-value Solana -> Base source event is required for a future guarded submit.

## Next Recommended PR

PR-013G should generate a new approved low-value Solana Devnet -> Base Sepolia source event directly into durable `/data` fixture and paper-state paths, rerun deployed-signer approval, and only then consider a guarded one-shot Base submit.
