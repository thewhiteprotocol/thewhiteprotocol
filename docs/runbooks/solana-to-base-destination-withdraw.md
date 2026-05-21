# Solana -> Base Destination Withdraw Runbook

This runbook covers Base Sepolia destination withdraw preparation for a Solana Devnet -> Base Sepolia bridge-minted commitment.

It is read-only until a later PR explicitly approves withdraw execution.

## Current PR-013I Target

- Source tx: `5VcEKPVobXRJrNTV6SP9PVQMYPHSCSKH4aaybqvbenyFdbLG62tHzwbTXvsgDgj7x6S3gZDpYamoBrJrMCKsKHyj`
- Source hash: `0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e`
- Destination BridgeMint hash: `0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865`
- Destination commitment: `0x12888fed12c64e6d6eebd6eb6c1859feb2ca45bc64319301ba9cdc6d562feef2`
- Base accept tx: `0x72b972a211e4950d110798523f6522b402dea83306f6e12805259bdd8adec983`
- Base BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`

## Safety Rules

- Do not submit another Base `acceptBridgeMint`.
- Do not withdraw unless the exact destination note-state is found and validated.
- Do not generate a replacement destination note for an already-minted commitment.
- Do not print note secrets, nullifier secrets, witnesses, private keys, signer keys, wallet files, RPC URLs with keys, or operator tokens.
- Keep note-state backups outside git and outside `/tmp`.

## Validate Destination Note-State

Use a candidate note-state path only if it was produced for the exact destination commitment.

```bash
cd chains/evm

BRIDGE_BASE_NOTE_STATE_INPUT=/data/white-bridge-note-state/base-destination/0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865.json \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=/data/bridge-results/solana-to-base-source-fixture-0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e.json \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=/data/bridge-results/solana-to-base-paper-state/bridge-messages.json \
npm run bridge:validate-base-note-state
```

The command prints only paths, hashes, and boolean checks.

Required result before continuing:

- `destinationNoteStateFound=true`
- `sourceHashMatches=true`
- `destinationHashMatches=true`
- `destinationCommitmentMatches=true`
- `amountMatches=true`
- `assetMatches=true`
- `hasSecret=true`
- `hasNullifier=true`
- `durablePath=true`

## Durable Backup

If the exact note-state is found outside durable storage, copy it to:

```text
/data/base-destination-note-state/0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865.json
```

Set file permissions to `0600` where possible. Do not print the file contents.

Use the export/readback helpers:

```bash
cd chains/evm

BRIDGE_BASE_NOTE_STATE_INPUT=<candidate-note-state-path> \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=/data/bridge-results/solana-to-base-source-fixture-0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e.json \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=/data/bridge-results/solana-to-base-paper-state/bridge-messages.json \
npm run bridge:export-base-note-state

BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=/data/bridge-results/solana-to-base-source-fixture-0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e.json \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=/data/bridge-results/solana-to-base-paper-state/bridge-messages.json \
npm run bridge:base-note-state:readback-check
```

## Base Recovery Preflight

Run:

```bash
cd chains/evm

BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH=/data/bridge-results/solana-to-base-source-fixture-0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e.json \
BRIDGE_SOLANA_TO_BASE_STATE_PATH=/data/bridge-results/solana-to-base-paper-state/bridge-messages.json \
npm run bridge:preflight-base-withdraw
```

Required read-only checks:

- Base submit tx confirmed.
- Destination BridgeMint hash consumed.
- Destination message not frozen.
- Destination commitment inserted.
- Bridge commitment stored in WhiteProtocol.
- Vault balance is sufficient.
- Note-state validation passes.
- Withdraw proof readiness is not blocked.

## Stop Conditions

Stop immediately if any of these occur:

- Destination note-state missing.
- Destination note-state exists only under `/tmp`.
- Source hash, destination hash, commitment, amount, or asset mismatch.
- Destination secret or destination nullifier missing.
- Base submit tx is not confirmed.
- Message consumed is false after PR-013I submit.
- Commitment inserted is false.
- Vault balance is insufficient.
- Nullifier is already spent.
- Any command prints secret values.

## PR-013J Status

PR-013J is blocked at destination note-state recovery:

- Base submit tx confirmed: true
- Message consumed: true
- Commitment inserted: true
- Vault balance sufficient: true
- Exact destination note-state found: false
- Withdraw proof readiness: `blocked_note_state_missing`
- Withdraw simulation: `not_attempted`
- Withdraw tx submitted: false

PR-013K classification:

- Exact destination note-state found: false
- Recovery classification: currently unrecoverable unless exact note-state is restored
- Future Solana -> Base live submits must pass the durable Base destination note-state backup gate before `acceptBridgeMint` can be sent.
