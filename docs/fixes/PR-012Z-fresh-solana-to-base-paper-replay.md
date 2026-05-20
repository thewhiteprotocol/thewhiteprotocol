# PR-012Z - Fresh Solana -> Base Paper Replay

## Summary

PR-012Z prepared the source-only Solana Devnet -> Base Sepolia fresh-event path for hosted paper replay.

The repository now has a bounded source fixture command:

```bash
cd chains/solana
npm run bridge:solana-to-base:source-fixture
```

The command runs only the Solana source side when `PR012Z_SOURCE_ONLY=true`:

1. Creates a low-value Solana source deposit.
2. Settles that deposit into the Solana source tree.
3. Builds a Solana Devnet -> Base Sepolia `BridgeMessageV1`.
4. Uses `bridge_out_v1_with_proof`.
5. Waits for Solana source finality.
6. Exports a non-secret source event fixture.
7. Exits before duplicate checks, signer signing, or any Base destination submit.

The live fresh event was not generated in this local run because executing the devnet source transaction required an escalated `tsx` run and that approval was rejected by the execution environment. No unsafe fallback was used.

## Why PR-012Z Follows PR-012Y

PR-012Y proved the Solana source adapter and historical paper replay path with a reconstructed PR-010Z fixture. The only blocker was policy rejecting the historical message for `expired_deadline`.

PR-012Z therefore needs a fresh source event with a future deadline to reach `paper_ready_to_submit`.

## Fresh Solana Source Event Evidence

Status: not generated in this run.

Reason: local execution of the fresh source-event command requires running `tsx` outside the sandbox because the sandbox blocks `tsx` IPC pipe creation. The escalation request for the live devnet source-only run was rejected, so no Solana source transaction was submitted.

No Base destination transaction was submitted.

## Source `bridge_out_v1_with_proof` Evidence

The source-only command is explicitly bounded to the production source instruction:

- accepted source event: `bridge_out_v1_with_proof`
- unsafe source event: `init_bridge_v1_out` is not used
- duplicate source attempts are skipped in source-only mode
- Base `acceptBridgeMint` is not called in source-only mode

## Source Nullifier / Value-Lock Evidence

When the source-only command completes, it writes booleans only:

- `sourceNullifierSpent: true`
- `sourceValueLocked: true`

The command checks:

- spent nullifier PDA exists
- outbound message PDA exists
- bridge custody balance increased by the source amount
- source vault balance decreased by the source amount

It does not print note secrets, nullifier secrets, witnesses, private keys, wallet contents, RPC URLs with keys, or operator tokens.

## Non-Secret Fixture Details

Default fixture path:

```text
/tmp/pr012z-solana-to-base-source-fixture.json
```

Recommended hosted path:

```text
/data/bridge-results/solana-to-base-source-fixture-<sourceMessageHash>.json
```

Fixture fields are non-secret:

- source chain and destination chain
- Solana source tx/signature
- slot and confirmations
- event kind `bridge_out_v1_with_proof`
- `sourceBoundProofMarker=bridge_out_v1_with_proof`
- encoded `BridgeMessageV1`
- source message hash
- destination BridgeMint hash
- source amount
- normalized destination amount
- asset IDs
- source leaf index
- deadline

## Amount Normalization

Solana source amount is 9-decimal wSOL-style units. Base destination amount is 18-decimal native/EVM units.

For the low-value source amount:

```text
1000000 -> 1000000000000000
```

The source-only command computes the Base destination commitment using the normalized destination amount, so a later Base destination withdraw can be consistent with the destination message amount.

## Paper Replay Command

After a fixture exists, replay it in paper mode:

```bash
cd relayer
BRIDGE_DAEMON_REPLAY_ROUTE=solana-devnet:base-sepolia \
BRIDGE_SOLANA_SOURCE_EVENTS_PATH=/data/bridge-results/solana-to-base-source-fixture-<hash>.json \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_DAEMON_STATE_PATH=/data/bridge-results/solana-to-base-paper-state \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=<source-slot> \
BRIDGE_DAEMON_SCAN_TO_BLOCK=<source-slot> \
BRIDGE_SIGNER_MODE=local-dev \
BRIDGE_SIGNER_THRESHOLD=2 \
BRIDGE_DAEMON_SUBMIT_TARGETS=base-sepolia=0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=<source-message-hash> \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=<destination-bridge-mint-hash> \
NODE_ENV=test \
npx tsx src/bridge/daemon-paper-replay.ts
```

Expected successful paper result:

- source event parsed
- policy passed
- finality satisfied
- signatures produced: `2`
- Base submit preview created
- destination tx submitted: `false`
- state persisted
- message status: `paper_ready_to_submit`

## No-Submit Proof

This PR did not call Base `acceptBridgeMint`.

The source-only command exits before the old PR-010Z Base submit section. The paper replay command is forced to:

```text
BRIDGE_DAEMON_MODE=paper
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false
```

## Tests Run

- `cd relayer && npm run test` - passed, 27 suites / 369 tests.
- `cd relayer && npm run typecheck` - passed.
- `cd relayer && npm run build` - passed.
- `cd relayer && npm run watcher:smoke` - passed.
- `cd relayer && npm run watcher:report` - passed.
- `cd chains/solana && npm run test:rust` - passed, 115 tests.
- Standalone TypeScript check for the source-only runner passed with `tsc --noEmit --types node`.

`build:sbf` was not run because no Solana program code changed.

## Remaining Limitations

- Fresh Solana source event was not generated in this local run because the required escalated devnet source-only execution was rejected.
- Hosted/live paper replay still needs to be run after a fresh non-secret fixture is produced.
- No Base destination transaction has been submitted.

## Next Recommended PR

PR-013A: Run `bridge:solana-to-base:source-fixture` on Render or an approved Codespace shell, then run hosted paper replay and capture the `paper_ready_to_submit` evidence without submitting Base destination tx.
