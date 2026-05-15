# PR-012C - Destination Note-State Recovery

## Summary

PR-012C adds an operator-only destination note-state validation/export flow and documents the PR-012B blocker.

The PR-012A Solana destination submit succeeded exactly once, but PR-012B cannot settle and withdraw the submitted commitment because the Render instance no longer has the source-side destination note-state file:

```text
chains/evm/test/base-to-solana-bridge-state-v2.json
```

That file contains sensitive destination note material required to prove the Solana withdraw.

## PR-012B Blocker

- PR-012A submit tx: `5mbCcCp1q2qwtEcQLLrkZ9JJPWg61EKUHBzPzr5edNn61XrwnXktUy8tuEwCvaE8JafqnLagcBGWxE4EA51bJkat`
- Submitted destination BridgeMint hash: `0xf307818bb8ebd878469f8faf7c3c074ba43f0e16909842dbcc0a4a7333c318c1`
- Render note-state check: missing file
- Impact: cannot generate the withdraw proof for the PR-012A commitment

No additional bridge accept submit was performed.

## Search Locations

Searched metadata-only candidates:

- `chains/evm/test/base-to-solana-bridge-state-v2.json`
- `chains/evm/test/base-to-solana-bridge-state.json`
- `chains/evm/test/base-to-solana-bridge-state-checkpoint.json`
- `chains/solana/scripts/devnet-bridge-state.json`
- `/tmp` and `/home/codespace` bridge/note-state filename patterns

The search printed only paths, hashes, commitments, and booleans. It did not print note secrets, nullifiers, witnesses, keys, or env contents.

## Candidate State Files

Local Codespace candidates exist, but they match an older message:

- Source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- Destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`
- `hasDestSecret=true`
- `hasDestNullifier=true`

They do not match the PR-012A submitted destination hash `0xf307818bb8ebd878469f8faf7c3c074ba43f0e16909842dbcc0a4a7333c318c1`.

## Recovery Result

Exact PR-012A note state recovered: no.

The PR-012A commitment may be unrecoverable for withdrawal unless an operator still has an out-of-band copy of the matching source-side state file.

## Export/Restore Process

New command:

```bash
cd chains/evm
npm run bridge:export-note-state
```

Required env:

- `BRIDGE_NOTE_STATE_INPUT`
- `BRIDGE_NOTE_EXPECTED_SOURCE_HASH`
- `BRIDGE_NOTE_EXPECTED_DESTINATION_HASH`
- optional `BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT`
- optional `BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT`
- optional `BRIDGE_NOTE_EXPECTED_ASSET_ID`
- optional `BRIDGE_NOTE_STATE_OUTPUT_DIR`

Default output directory:

```text
/tmp/white-bridge-note-state
```

The export command refuses to write inside the git repository.

## Validation Command

```bash
cd chains/evm
BRIDGE_NOTE_STATE_INPUT=/secure/path/base-to-solana-bridge-state-v2.json \
BRIDGE_NOTE_EXPECTED_SOURCE_HASH=0x... \
BRIDGE_NOTE_EXPECTED_DESTINATION_HASH=0x... \
BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT=0x... \
npm run bridge:validate-note-state
```

Validation output includes only:

- `valid`
- source/destination hashes
- destination commitment
- amount/asset match booleans
- `hasDestSecret`
- `hasDestNullifier`
- `hasWitness`
- `hasPrivateFields`

It does not print the secret or nullifier values.

## Security Handling

Added ignore coverage:

- `chains/evm/test/*bridge-state*.json`
- `**/*bridge-state*.json`
- `**/*note-state*.json`
- `**/.bridge-notes/**`
- `.bridge-signers.env`

The nested `chains/evm/.gitignore` also ignores bridge/note state files.

## Future Prevention

Future live destination submits must not proceed unless:

- destination note state is exported before source event generation or before destination submit
- the export path is outside git
- `npm run bridge:validate-note-state` passes against the exact source and destination hashes
- the operator confirms a backup outside Render ephemeral storage
- the submit approval checklist records the backup path or secret-store reference outside git

## Tests Run

- `cd chains/evm && npm run bridge:test-note-state` - passed
- `cd chains/evm && npm run bridge:validate-note-state` against local candidate - failed as expected with source/destination hash mismatch

## Remaining Limitations

- The exact PR-012A destination note state is not recovered.
- PR-012B cannot settle/withdraw the PR-012A commitment without the matching note witness.
- Current export format is operator-local testnet JSON, not encrypted packaging.

## Next Recommended PR

PR-012D should generate a new low-value Base Sepolia -> Solana Devnet message only after note-state export/validation is proven, then run guarded submit followed by PR-012B settlement and withdraw.
