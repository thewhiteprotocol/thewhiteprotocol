# PR-013L - Solana to Base Durable Note-State Gate Exercise

## Summary

PR-013L exercises the PR-013K durable Base destination note-state backup gate without submitting a Base transaction.

The guarded Solana Devnet -> Base Sepolia submit path now supports `BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true`. In check-only mode the command reruns the same paper-state load, approval checks, Base read-only checks, simulation, and durable Base note-state backup gate, then exits before loading a submitter account or calling `writeContract`.

## PR-013K Gate Summary

PR-013K added the hard pre-send gate for future Solana -> Base `acceptBridgeMint` submissions:

- `BRIDGE_BASE_NOTE_STATE_BACKUP_DIR` is required.
- Recommended hosted path: `/data/base-destination-note-state`.
- The backup path must be outside git and not under `/tmp`.
- The exact source hash must match.
- The exact destination BridgeMint hash must match.
- The destination commitment must match the BridgeMint message.
- Amount and asset must match.
- Destination secret metadata must be present.
- Destination nullifier metadata must be present.
- Output redacts secret-like fields.

## Missing-Backup Gate Result

The check-only submit path was tested with an approval-ready fixture and an empty durable backup directory.

Result:

- Missing-backup gate tested: `true`
- Submit blocked before `writeContract`: `true`
- Block reason: `base_destination_note_state_missing`
- Submit attempted: `false`
- Destination tx submitted: `false`
- Secret values printed: `false`

This proves the PR-013K gate blocks before the EVM write path.

## Durable Note-State Export and Readback

The EVM helper commands remain the operator path for a real fresh message:

```bash
cd chains/evm

BRIDGE_BASE_NOTE_STATE_INPUT=<candidate-note-state-path> \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=<paper-state-path> \
npm run bridge:export-base-note-state

BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=<paper-state-path> \
npm run bridge:validate-base-note-state

BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=<source-fixture-path> \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=<paper-state-path> \
npm run bridge:base-note-state:readback-check
```

PR-013L did not recover the PR-013I destination note-state and did not generate a fresh live source event. The export, validation, and readback behavior is covered by fixture tests only in this PR.

## Check-Only Submit Command

Use this only after paper replay and approval are ready:

```bash
cd relayer

BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_DAEMON_ROUTES=solana-devnet:base-sepolia:1 \
BRIDGE_DAEMON_STATE_PATH=<paper-state-dir> \
BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH=<paper-state-dir> \
BRIDGE_APPROVED_MESSAGE_HASHES=solana-devnet->base-sepolia|<destinationBridgeMintHash> \
BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH=<sourceHash> \
BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH=<destinationBridgeMintHash> \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
npm run bridge:solana-to-base:submit-approved
```

Expected check-only success status after a valid backup exists:

- `status=check_ready`
- `submitAttempted=false`
- `destinationTxSubmitted=false`

Expected missing-backup status:

- `status=blocked_pre_submit_checks`
- `errors` contains `base_destination_note_state_missing`
- `submitAttempted=false`
- `destinationTxSubmitted=false`

## No-Submit Proof

PR-013L is no-submit by design:

- Live submit mode required for write path: not used.
- Check-only mode requires `BRIDGE_DAEMON_MODE=paper`.
- Check-only mode requires `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.
- Submitter account loading is skipped in check-only mode.
- `writeContract` is not called in check-only tests.
- No Base destination transaction was submitted.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep`
- `cd relayer && npm run test -- --runInBand src/bridge/__tests__/solana-to-base-approval.test.ts`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- PR-013I destination note-state remains unrecovered.
- A new Solana -> Base live submit must first generate a fresh source event and preserve the exact Base destination note-state before `acceptBridgeMint`.
- This PR does not submit Base `acceptBridgeMint`.

## Next Recommended PR

PR-013M should generate a fresh Solana -> Base source event, export the exact Base destination note-state to `/data/base-destination-note-state`, run validation/readback, run check-only submit until `check_ready`, then perform a separately approved guarded one-shot Base submit.
