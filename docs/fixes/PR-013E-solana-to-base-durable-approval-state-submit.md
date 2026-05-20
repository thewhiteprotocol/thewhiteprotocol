# PR-013E - Solana to Base Durable Approval State Submit

## Summary

PR-013E attempted to restore the PR-013A Solana Devnet -> Base Sepolia paper-ready state into durable storage before rerunning approval and the guarded one-shot Base submit.

The flow remains **blocked before submit** in this workspace because the hosted durable `/data` mount is not present and neither the durable source fixture nor the old `/tmp` source fixture exists locally.

No Base destination transaction was submitted.

## PR-013D Blocker

PR-013D added the guarded one-shot submit command:

```bash
cd relayer
npm run bridge:solana-to-base:submit-approved
```

It blocked safely because `/tmp/pr013a-solana-to-base-paper-state` was unavailable.

PR-013E does not reuse `/tmp` as durable state.

## Durable Fixture Check

Expected durable fixture:

```text
/data/bridge-results/solana-to-base-source-fixture-0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2.json
```

Result:

- `/data` mount present locally: `false`
- durable fixture found: `false`
- old `/tmp/pr013a-solana-to-base-source-fixture.json` found: `false`
- durable paper state restored: `false`

## Source Event Evidence

The public Solana Devnet transaction was read-only checked:

- Solana bridge out tx: `1JFuyazkGGMeTAo2Qg65XxfMCtvSwUHxad3p6kbKnsN5niecpKe3mhBfFUh9x5v89V26oJHAvrcMbra2cx4AbA2`
- Source slot: `463688066`
- Instruction: `BridgeOutV1WithProof`
- Transaction status: finalized
- Source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`

The transaction check is not a replacement for the durable non-secret fixture and paper state artifact.

## Paper Replay Result

Paper replay was not run because the required fixture path was unavailable:

```bash
BRIDGE_SOLANA_SOURCE_EVENTS_PATH=/data/bridge-results/solana-to-base-source-fixture-0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2.json
BRIDGE_DAEMON_STATE_PATH=/data/bridge-results/solana-to-base-paper-state
```

Expected replay remains:

- source event parsed: pending
- policy passed: pending
- finality satisfied: pending
- signatures produced: pending
- Base submit preview: pending
- destination tx submitted: `false`

## Approval Rerun

PR-013C approval was not rerun because durable paper state was unavailable.

Required before submit:

- deployed Base signer set version `1`
- threshold `2`
- recovered signers match deployed set
- destination hash signed
- source hash preserved
- message not consumed
- message not frozen
- route enabled
- asset supported
- amount cap passes
- simulation/callStatic passes

## Guarded Submit Result

Guarded submit was not attempted because approval did not rerun from durable state.

- submit attempted: `false`
- submit tx: `null`
- confirmation: `null`
- message consumed: not checked
- duplicate submit blocked: not reached
- destination tx submitted: `false`

## No-Submit Proof

- durable fixture missing
- durable paper state missing
- approval rerun not attempted
- guarded live submit not attempted
- `destinationTxSubmitted=false`

## Tests Run

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- The PR-013A fixture and approval-ready paper state must be restored on the hosted environment with `/data` mounted.
- If the fixture is unavailable on Render, reconstruct it from the finalized Solana source transaction into `/data/bridge-results` without including secrets, then replay into `/data/bridge-results/solana-to-base-paper-state`.
- After durable replay, rerun PR-013C approval from the durable state before any submit.

## Next Recommended PR

PR-013F should run the durable-state restore on Render, rerun the paper replay and PR-013C approval from `/data/bridge-results/solana-to-base-paper-state`, then run the guarded one-shot submit only if simulation still passes.
