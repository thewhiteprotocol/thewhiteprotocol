# PR-013K - Solana to Base Note-State Recovery and Backup Gate

## Summary

PR-013K performs a final safe recovery audit for the PR-013I Solana Devnet -> Base Sepolia destination note-state and adds a hard durable note-state backup gate before future Solana -> Base live submits.

No withdraw was run. No Base transaction was submitted.

## PR-013J Blocker

PR-013J and Render agreed on the blocker:

- Base submit tx confirmed: `true`
- Base submit block: `41791387`
- Message consumed: `true`
- Commitment inserted: `true`
- Destination commitment: `0x12888fed12c64e6d6eebd6eb6c1859feb2ca45bc64319301ba9cdc6d562feef2`
- Destination BridgeMint hash: `0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865`
- Source hash: `0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e`
- Destination note-state found: `false`
- Withdraw proof readiness: `blocked_note_state_missing`
- Withdraw simulation: `not_attempted`
- Withdraw tx submitted: `false`

## Recovery Search Result

The final search was metadata-only. It scanned candidate note-state and bridge-state JSON paths for:

- `*solana*base*state*.json`
- `*bridge-note-state*.json`
- `*destination-note*.json`
- `*base*note*.json`
- `*bridge-state*.json`

Printed output was limited to path and booleans:

- source hash match
- destination hash match
- destination commitment match
- secret presence
- nullifier presence
- witness presence

No exact PR-013I destination note-state was found. Old/test candidates either failed source hash, destination hash, destination commitment, amount, asset, or durable-path checks.

## Recovery Classification

The PR-013I destination commitment is currently unrecoverable for withdrawal unless the exact destination note-state is later restored.

Classification:

- Exact destination note-state found: `false`
- Matching source hash: `false`
- Matching destination hash: `false`
- Matching destination commitment: `false`
- hasDestSecret: `false`
- hasDestNullifier: `false`
- Recovery classification: `currently_unrecoverable_note_state_missing`

Do not generate a replacement note for the already-inserted commitment.

## Durable Base Note-State Backup Policy

Future Solana -> Base live submit now requires a durable Base destination note-state backup before sending `acceptBridgeMint`.

Required backup env:

```text
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state
```

Rules:

- backup path must not be `/tmp`
- backup path must be outside git
- file must be readable after export
- source hash must match
- destination BridgeMint hash must match
- destination commitment must match
- amount and asset must match
- `hasDestSecret=true`
- `hasDestNullifier=true`
- output must redact actual values

## Commands

Export exact note-state:

```bash
cd chains/evm

BRIDGE_BASE_NOTE_STATE_INPUT=<candidate-note-state-path> \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=<paper-state-path> \
npm run bridge:export-base-note-state
```

Validate exact note-state:

```bash
cd chains/evm

BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=<paper-state-path> \
npm run bridge:validate-base-note-state
```

Readback check:

```bash
cd chains/evm

BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=<paper-state-path> \
npm run bridge:base-note-state:readback-check
```

## Submit-Approved Hard Gate

`cd relayer && npm run bridge:solana-to-base:submit-approved` now refuses to send unless the Base destination note-state gate passes immediately after final simulation and before `writeContract`.

The gate blocks on:

- missing `BRIDGE_BASE_NOTE_STATE_BACKUP_DIR` or `BRIDGE_BASE_NOTE_STATE_INPUT`
- missing note-state file
- source hash mismatch
- destination hash mismatch
- destination commitment mismatch
- amount mismatch
- asset mismatch
- missing destination secret
- missing destination nullifier
- path under `/tmp`
- path inside git

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep`
- `cd relayer && npm run test -- --runInBand src/bridge/__tests__/solana-to-base-approval.test.ts`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

Results:

- EVM targeted withdraw-prep helper test: passed
- Relayer targeted Solana -> Base approval/submit tests: `25` passed
- Relayer full tests: `28` suites / `395` tests passed
- Relayer typecheck: passed
- Relayer build: passed
- Watcher smoke: passed
- Watcher report: passed
- Solana Rust tests: `115` passed

## Remaining Limitations

- PR-013I remains blocked for destination withdraw because exact note-state was not recovered.
- Base leaf index for the PR-013I commitment is still not indexed by the preflight helper.
- Nullifier spent status remains unknown without the destination nullifier.

## Next Recommended PR

PR-013L should use the new backup gate on the next fresh Solana -> Base live-submit attempt: export/readback-check the exact Base destination note-state before submit, then verify the submit command blocks if the backup is removed.
