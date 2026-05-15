# PR-012E - Durable Note-State Backup Gate

## Summary

PR-012E adds a hard durable-note-state backup gate before any future guarded Solana live-testnet submit. The submit command now requires the exact destination note-state file to be readable from `BRIDGE_NOTE_STATE_BACKUP_DIR` immediately before send, unless durability is explicitly disabled for tests.

No source event was generated and no Solana destination transaction was submitted in this PR.

## PR-012D Blocker

PR-012D exported and validated destination note state before submit, but the export path was `/tmp/white-bridge-note-state`. Render later moved instances, so both the `/tmp` export and the local bridge-state JSON disappeared. The destination commitment was submitted, but settlement and withdraw could not proceed because the exact `destSecret` and `destNullifier` witness was unavailable.

## Durable Backup Policy

Guarded live submit requires:

- `BRIDGE_REQUIRE_DURABLE_NOTE_STATE=true` by default.
- `BRIDGE_NOTE_STATE_BACKUP_DIR` set.
- backup directory outside git.
- backup directory not under `/tmp` unless `BRIDGE_ALLOW_TMP_NOTE_STATE=true` is explicitly set for local tests.
- backup directory exists and is readable/writable.
- note-state file named by destination BridgeMint hash.
- source BridgeOut hash, destination BridgeMint hash, destination commitment, amount, and asset all match the daemon message.
- `hasDestSecret=true`.
- `hasDestNullifier=true`.

Recommended Render persistent disk path:

```bash
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state
BRIDGE_REQUIRE_DURABLE_NOTE_STATE=true
BRIDGE_ALLOW_TMP_NOTE_STATE=false
```

## Export Command

The EVM helper supports durable export:

```bash
cd chains/evm
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
BRIDGE_NOTE_EXPECTED_SOURCE_HASH=<source BridgeOut hash> \
BRIDGE_NOTE_EXPECTED_DESTINATION_HASH=<destination BridgeMint hash> \
BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT=<destination commitment> \
BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT=<destination amount> \
npm run bridge:export-note-state
```

The command refuses repo paths and refuses `/tmp` by default when durable note-state is required. Output is a redacted summary with path, hashes, commitment, and `hasDestSecret` / `hasDestNullifier` booleans only.

## Validation Command

Validate the exported state:

```bash
cd chains/evm
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
BRIDGE_NOTE_EXPECTED_SOURCE_HASH=<source BridgeOut hash> \
BRIDGE_NOTE_EXPECTED_DESTINATION_HASH=<destination BridgeMint hash> \
BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT=<destination commitment> \
BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT=<destination amount> \
npm run bridge:validate-note-state
```

Validation returns nonzero if the file is missing, mismatched, or missing destination secret/nullifier fields. It does not print secret values.

## Restart / Readback Check

Before any live submit, run a fresh shell readback check:

```bash
cd chains/evm
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
BRIDGE_NOTE_EXPECTED_SOURCE_HASH=<source BridgeOut hash> \
BRIDGE_NOTE_EXPECTED_DESTINATION_HASH=<destination BridgeMint hash> \
BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT=<destination commitment> \
BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT=<destination amount> \
npm run bridge:note-state:readback-check
```

This reopens the backup file by destination hash and validates the same redacted fields.

## Submit-Approved Gate

`npm run bridge:daemon:solana:submit-approved` now validates durable note-state after simulation/pre-submit readiness succeeds and immediately before signing/sending the transaction.

If validation fails, the command returns `status=blocked_note_state` and does not call `sendRawTransaction`.

## Render Persistent Disk Instructions

1. Attach a Render persistent disk mounted at `/data` or another durable mount.
2. Set `BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state`.
3. Keep `BRIDGE_REQUIRE_DURABLE_NOTE_STATE=true`.
4. Keep `BRIDGE_ALLOW_TMP_NOTE_STATE=false`.
5. Export note-state to the durable path before replay/simulation/submit.
6. Open a fresh Render shell and run `npm run bridge:note-state:readback-check`.
7. Proceed to guarded live submit only if readback validates.

Do not use Vercel, `/tmp`, git, logs, or public artifacts for note-state backup.

## Tests Run

- `cd chains/evm && npm run bridge:test-note-state`
- `cd relayer && npx jest src/bridge/__tests__/daemon-solana-submit-approved.test.ts --runInBand`

Full relayer validation is tracked in the terminal summary for this PR.

## Remaining Limitations

- PR-012D and PR-012A submitted commitments remain unwithdrawable unless their exact note-state files are recovered.
- The current backup is operator-managed. A future version should integrate an encrypted secret store or KMS-backed backup workflow.
- The readback check proves current shell readability, not long-term backup retention policy.

## Next Recommended PR

PR-012F should configure a Render persistent disk, generate a fresh low-value Base Sepolia -> Solana Devnet event, export/readback durable note-state, perform one guarded submit, then settle and withdraw using the durable note-state file.
