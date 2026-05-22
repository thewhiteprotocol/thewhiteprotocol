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

## Submit Gate Check-Only Exercise

Before any future live submit, run the submit-approved command in check-only mode after the exact Base destination note-state has been exported and read back:

```bash
cd relayer

BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_DAEMON_ROUTES=solana-devnet:base-sepolia:1 \
BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH=<paper-state-dir> \
BRIDGE_APPROVED_MESSAGE_HASHES=solana-devnet->base-sepolia|<destinationBridgeMintHash> \
BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH=<sourceHash> \
BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH=<destinationBridgeMintHash> \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
npm run bridge:solana-to-base:submit-approved
```

Expected successful dry check:

- `status=check_ready`
- `submitAttempted=false`
- `destinationTxSubmitted=false`

If the backup is missing or invalid, the command must block with `blocked_pre_submit_checks` before `writeContract`.

## Fresh Source Fixture With Durable Base Note-State

For the next fresh Solana -> Base source event, require the source-only runner to export the Base destination note-state before any submit-readiness check:

```bash
cd chains/solana

PR012Z_SOURCE_ONLY=true \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SOLANA_SOURCE_FIXTURE_DIR=/data/bridge-results \
BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state \
BRIDGE_REQUIRE_BASE_NOTE_STATE_BACKUP=true \
npm run bridge:solana-to-base:source-fixture
```

The runner must report `baseDestinationNoteStatePath`. The file contains private destination note material and must never be printed, committed, or copied into the repo.

PR-013M check-ready target:

- Source hash: `0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3`
- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`
- Base note-state validation/readback: passed
- Submit-approved check-only: `check_ready`
- Destination tx submitted: `false`

PR-013N live-submit target:

- Base submit tx: `0x18b0d4a25ea9087630b0eed09d2399a33d16c8788290cad2d379619aedc96556`
- Confirmation: success, block `41794491`
- Gas used: `957439`
- Message consumed: `true`
- Commitment inserted: `true`
- Duplicate submit: blocked as `already_submitted`
- Destination note-state backup: preserved outside git under the operator data directory.
- Next withdraw preparation must validate this exact destination commitment and note-state before generating any proof or simulation.

PR-013O withdraw-prep status:

- Durable Base note-state validation/readback: passed
- Base submit tx confirmed: `true`
- Message consumed: `true`
- Commitment inserted: `true`
- Leaf index: `42`
- Leaf-index evidence: `nextLeafIndex` moved from `42` before the submit block to `43` at submit block `41794491`, with matching `BridgeMintAccepted` and `BridgeMint` events.
- Nullifier spent: `false`
- Vault balance check: passed
- Withdraw proof readiness: `blocked_merkle_path_unavailable`
- Withdraw simulation: `not_attempted_missing_merkle_path`
- Do not generate or submit a withdraw until a Base Merkle path/indexer snapshot for leaf `42` is available.

PR-013P withdraw-simulation status:

- Merkle path recovered: `true`
- Durable path evidence: `/workspaces/thewhiteprotocol-operator-data/base-merkle-paths/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`
- Path evidence hash: `779cf72cee09d21bc0912ebf8500478230718e95df535ddcf39d03aeed43921f`
- Path validation: passed
- Merkle root: `50015434963031949891316260787900094634376168319519755731383442155917094636`
- Withdraw proof generated: `true`, in memory only
- Withdraw simulation: passed
- Gas estimate: `329772`
- Withdraw tx submitted: `false`
- Before any future withdraw execution, rerun path recovery/validation if Base `nextLeafIndex` has advanced beyond `43`.

PR-013Q guarded-withdraw attempt:

- Guarded command: `cd chains/evm && npm run bridge:base:submit-withdraw`
- Required live gates: `BRIDGE_WITHDRAW_LIVE=true`, `BRIDGE_ALLOW_LIVE_TESTNET_WITHDRAW=true`, `BRIDGE_WITHDRAW_APPROVED_DESTINATION_HASH=<destinationBridgeMintHash>`.
- Required recipient gate: set `BRIDGE_WITHDRAW_RECIPIENT` or `BASE_WITHDRAW_RECIPIENT` before any live withdraw.
- Final note-state validation/readback: passed.
- Final Merkle path validation: passed.
- Base preflight: submit tx confirmed, message consumed, commitment inserted, leaf index `42`, nullifier spent `false`, vault balance sufficient.
- PR-013Q blocker: `blocked_withdraw_recipient_missing`.
- Withdraw tx submitted: `false`.
- Extra `acceptBridgeMint` submitted: `false`.

Do not rerun the live withdraw command until an explicit Base Sepolia recipient address is configured and reviewed. After configuring it, rerun note-state validation, Merkle path validation, Base preflight, proof generation, and final simulation before enabling the guarded withdraw gates.

PR-013R explicit-recipient rerun:

- `BRIDGE_WITHDRAW_RECIPIENT`: not configured
- `BASE_WITHDRAW_RECIPIENT`: not configured
- Recipient gate: `blocked_withdraw_recipient_missing`
- Proof generation: not attempted
- Withdraw simulation: not attempted
- Withdraw tx submitted: `false`
- Extra `acceptBridgeMint` submitted: `false`

The guarded command also rejects invalid EVM addresses and the zero address. It must never default to deployer, submitter, operator, or pool authority as recipient.

PR-013S guarded withdraw execution:

- Reviewed recipient: `0xC520f5545dc9Af65FF91470721Ee986e94a717d0`
- Recipient gate: passed.
- Final note-state validation: passed.
- Final Merkle path validation: passed.
- Nullifier spent before: `false`
- Vault balance before: `30099999999000000`
- Recipient balance before: `0`
- Withdraw proof generated: `true`
- Withdraw simulation: passed.
- Withdraw tx: `0x62e8047f599dacc5d4e8945336d5f134e3e3e438cd2a5f5119b545995ffe0095`
- Confirmation: success, block `41835063`
- Gas used: `352310`
- Nullifier spent after: `true`
- Vault balance after: `29099999999000000`
- Recipient balance after: `1000000000000000`
- Duplicate withdraw: blocked before a second send with `nullifierSpentBefore=true`

Do not rerun withdraw for this destination note. Future operator status checks should classify this target as already withdrawn.
