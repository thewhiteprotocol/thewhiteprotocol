# PR-013M - Fresh Solana to Base Check-Ready Preparation

## Summary

PR-013M prepares the fresh Solana Devnet -> Base Sepolia no-submit flow required after PR-013L.

The source-only Solana -> Base runner now exports the exact Base destination note-state directly into the durable backup directory when `BRIDGE_BASE_NOTE_STATE_BACKUP_DIR` is set. The export includes the destination secret/nullifier metadata required by the PR-013K/PR-013L backup gate, writes with `0600` permissions where possible, refuses `/tmp` and repo-local paths, and prints only the file path.

No Base destination transaction was submitted in this PR.

## PR-013L Gate Status

PR-013L added `BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true` for `bridge:solana-to-base:submit-approved`.

Check-only mode:

- Runs approval, Base read-only checks, simulation, and the durable Base destination note-state gate.
- Requires `BRIDGE_DAEMON_MODE=paper`.
- Requires `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.
- Does not load a submitter account.
- Does not call `writeContract`.
- Returns `check_ready` only after the backup gate passes.

## Local Fresh Event Attempt

The Codespace environment did not have the live operator prerequisites needed to generate the fresh devnet source event:

- `SOLANA_DEVNET_RPC_URL`: not present
- `BASE_SEPOLIA_RPC_URL`: not present
- deployed signer env: not present
- Solana source wallet env: not present
- `/data/bridge-results`: not present
- `/data/base-destination-note-state`: not present

Because these prerequisites are absent, the fresh source event was not generated locally. This avoids unsafe partial live execution and avoids printing or handling missing private env contents.

## Source Runner Change

When running the source-only command with:

```bash
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state
BRIDGE_REQUIRE_BASE_NOTE_STATE_BACKUP=true
```

the runner exports:

```text
/data/base-destination-note-state/<destinationBridgeMintHash>.json
```

The backup file contains private note material and must remain outside git. The command output reports only `baseDestinationNoteStatePath`.

The exported note-state includes:

- source hash
- destination BridgeMint hash
- destination commitment
- normalized Base destination amount
- destination asset ID
- canonical asset ID
- destination secret presence
- destination nullifier presence

Secret values are not printed.

## Render Operator Sequence

Run this on the approved Render shell or another approved live shell.

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

PR012Z_SOURCE_ONLY=true \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SOLANA_SOURCE_FIXTURE_DIR=/data/bridge-results \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_REQUIRE_BASE_NOTE_STATE_BACKUP=true \
npm run bridge:solana-to-base:source-fixture
```

Then validate and read back:

```bash
cd "$repo_root/chains/evm"

BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<durable-source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=/data/bridge-results/solana-to-base-paper-state/bridge-messages.json \
npm run bridge:validate-base-note-state

BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<durable-source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=/data/bridge-results/solana-to-base-paper-state/bridge-messages.json \
npm run bridge:base-note-state:readback-check
```

Replay into durable paper state:

```bash
cd "$repo_root/relayer"

BRIDGE_DAEMON_REPLAY_ROUTE=solana-devnet:base-sepolia \
BRIDGE_SOLANA_SOURCE_EVENTS_PATH=<durable-source-fixture-path> \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_DAEMON_STATE_PATH=/data/bridge-results/solana-to-base-paper-state \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=<sourceSlot> \
BRIDGE_DAEMON_SCAN_TO_BLOCK=<sourceSlot> \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=<sourceHash> \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=<destinationBridgeMintHash> \
npm run bridge:daemon:paper:replay
```

Run approval:

```bash
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH=/data/bridge-results/solana-to-base-paper-state \
BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH=<sourceHash> \
BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH=<destinationBridgeMintHash> \
npm run bridge:solana-to-base:approval
```

Run check-only submit readiness:

```bash
BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_DAEMON_ROUTES=solana-devnet:base-sepolia:1 \
BRIDGE_DAEMON_STATE_PATH=/data/bridge-results/solana-to-base-paper-state \
BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH=/data/bridge-results/solana-to-base-paper-state \
BRIDGE_APPROVED_MESSAGE_HASHES=solana-devnet->base-sepolia|<destinationBridgeMintHash> \
BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH=<sourceHash> \
BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH=<destinationBridgeMintHash> \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
npm run bridge:solana-to-base:submit-approved
```

Expected:

- status: `check_ready`
- submit attempted: `false`
- destination tx submitted: `false`

## No-Submit Proof

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true`
- no `writeContract`
- no Base `acceptBridgeMint`
- no Base destination tx

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- Fresh source event was not generated in this Codespace because live RPC, signer, wallet, and `/data` prerequisites are absent.
- Render's 2 GB web service previously exceeded memory during source proof generation; use an approved shell with enough memory, or run proof generation outside the live web process.
- The next PR should run the Render/operator sequence above and record the actual source tx, fixture path, note-state backup path, approval result, and check-only readiness.

## Next Recommended PR

PR-013N should run the PR-013M command sequence on an approved live shell and stop at `check_ready` with no Base destination submission. A later PR can perform the separately approved guarded live submit.
