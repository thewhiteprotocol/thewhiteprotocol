# PR-012O: Settlement Leaf-Index Evidence

## Summary

PR-012O adds a non-secret leaf-index evidence file and command for hosted Base -> Solana settlement/withdraw recovery. The evidence lets the live recovery snapshot derive the expected spent-nullifier PDA for already-settled targets without guessing the settlement leaf index.

No bridge accept, settlement, withdraw, or proof-generation transaction is submitted by this PR.

## Why PR-012O Follows PR-012N

PR-012N proved the hosted preflight, recovery snapshot, and dry-run job wrapper run safely on Render. The preflight was ready, but the recovery snapshot blocked:

```text
readiness=blocked_spent_nullifier_unknown
spentNullifier.error=leaf_index_missing
```

The target commitment was already settled, so it was no longer in the pending buffer. The snapshot could not infer the leaf index from current pending state and correctly refused to derive a spent-nullifier PDA.

## Leaf-Index Evidence Problem

The Solana spent-nullifier PDA is derived from the public pool config and the nullifier hash. The nullifier hash is computed from private destination note fields and the settlement leaf index:

```text
Poseidon(Poseidon(destNullifier, destSecret), leafIndex)
```

The note-state provides the private fields. For already-settled targets, the missing input is the exact leaf index used when the commitment entered the Merkle tree.

## Evidence Sources

The new command can create evidence from these non-secret sources:

- `settlement_result`: a successful settle/withdraw result report containing `nextLeafIndexBefore`.
- `pre_settlement_snapshot`: a pre-settlement preflight where the target is still pending; leaf index is `merkleNextLeafIndexBefore + pendingIndexBeforeSettlement`.
- `manual_operator_review`: explicit operator-provided leaf index and matching destination commitment/hash fields.

`settlement_tx_logs` is reserved in the evidence schema. Current hosted recovery does not rely on transaction log parsing because the existing verifier result and preflight snapshots provide stronger structured evidence. If future Solana logs expose enough structured leaf data, that source can be added without changing the evidence file shape.

## Evidence File Format

Default path:

```text
/data/bridge-results/leaf-index-<destinationHash>.json
```

Fields:

```json
{
  "destinationMessageHash": "0x...",
  "sourceMessageHash": "0x...",
  "destinationCommitment": "0x...",
  "settlementTx": "optional tx signature",
  "leafIndex": 9,
  "pendingIndexBeforeSettlement": 0,
  "merkleNextLeafIndexBefore": 9,
  "merkleNextLeafIndexAfter": 10,
  "rootBefore": "optional root",
  "rootAfter": "optional root",
  "evidenceSource": "settlement_result",
  "createdAt": "ISO-8601 timestamp",
  "evidenceSha256": "optional canonical evidence hash"
}
```

The file contains no note secrets, nullifier secrets, witness data, private keys, signer keys, RPC secrets, operator tokens, or wallet files.

## Recovery Snapshot Integration

`npm run bridge:recovery:snapshot` now checks leaf-index inputs in this order:

1. `leafIndex`, `destinationLeafIndex`, or `destLeafIndex` in note-state, if present.
2. `/data/bridge-results/leaf-index-<destinationHash>.json`.
3. Pending-buffer position for targets still pending.
4. Existing successful job result evidence.

When valid evidence is found, the snapshot reports:

```text
leafIndexEvidence.found=true
leafIndexEvidence.leafIndex=<index>
leafIndexEvidence.path=<path>
leafIndexEvidence.sha256=<sha256>
spentNullifier.derived=true
```

If evidence is missing or mismatched, the snapshot keeps the previous safe blocker:

```text
readiness=blocked_spent_nullifier_unknown
recommendedAction=operator_review_required
```

## Job Wrapper Integration

The settlement/withdraw job index now records leaf-index evidence from the recovery snapshot:

- `leafIndexEvidencePath`
- `leafIndexEvidenceSha256`
- `leafIndexEvidenceSource`
- `leafIndex`

Execute/resume mode still requires a fresh recovery snapshot. If the snapshot cannot derive the spent-nullifier PDA because evidence is missing, the wrapper blocks before any mutation.

## Security And Redaction Rules

The evidence command and reports enforce non-secret output:

- no `destSecret`
- no `destNullifier`
- no witness data
- no raw nullifier hash
- no private keys or wallet files
- no RPC URLs with embedded keys
- no operator tokens

The evidence file is ignored by git via `**/leaf-index-*.json`.

## Commands

Generate or validate leaf-index evidence:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_RESULTS_DIR=/data/bridge-results \
PR012B_SOURCE_MESSAGE_HASH=<source_bridge_out_hash> \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
BRIDGE_LEAF_INDEX_DESTINATION_COMMITMENT=<destination_commitment> \
npm run bridge:leaf-index:evidence
```

Manual operator-reviewed evidence requires explicit opt-in:

```bash
BRIDGE_LEAF_INDEX_MANUAL_REVIEW=true \
BRIDGE_LEAF_INDEX=<leaf_index> \
BRIDGE_LEAF_INDEX_DESTINATION_HASH=<destination_bridge_mint_hash> \
BRIDGE_LEAF_INDEX_DESTINATION_COMMITMENT=<destination_commitment> \
npm run bridge:leaf-index:evidence
```

Then rerun:

```bash
npm run bridge:recovery:snapshot
npm run bridge:job:settle-withdraw
```

Do not set `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` unless the fresh snapshot recommends a permitted action and all operator gates pass.

## Tests Run

Targeted hosted operator tests:

```text
npm run bridge:test-leaf-index:evidence
npm run bridge:test-recovery:snapshot
npm run bridge:test-job:settle-withdraw
```

Full validation also included:

```text
cd chains/solana && npm run test:rust
cd chains/solana && npm run build:sbf
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
cd relayer && npm run watcher:report
```

## Remaining Limitations

- Transaction-log reconstruction is not implemented yet because the current structured result/preflight evidence sources are safer and sufficient.
- Existing already-settled targets still need either a prior verifier result report, a pre-settlement snapshot, or explicit manual operator-reviewed evidence.
- The command does not infer leaf index from Merkle root history alone.

## Next Recommended PR

PR-012P should add startup/bootstrap checks on Render that recreate zkey symlinks from `/data/circuit-artifacts` and verify durable report directories before any operator command is run.
