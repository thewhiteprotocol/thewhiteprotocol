# PR-012P - Hosted Zkey Bootstrap + Operator Prerequisites

## Summary

PR-012P adds hosted startup/bootstrap tooling for the Base -> Solana settle/withdraw operator flow.

It adds:

- `npm run bridge:bootstrap:zkeys`
- `npm run bridge:operator:prereq`
- `npm run bridge:test-operator:prereq`

No transactions are submitted. No proofs are generated. No note secrets, nullifier secrets, witness values, private keys, signer keys, RPC secrets, operator tokens, or wallet files are printed.

## Why PR-012P Follows PR-012O

PR-012O proved that already-settled targets can recover the settled leaf index from trusted non-secret evidence and then derive/check the expected spent-nullifier PDA.

The remaining hosted limitation was operational: Render deploys recreate the repo filesystem, so the repo-local zkey symlinks disappear even though the durable zkeys remain on `/data`.

PR-012P makes that repair explicit and testable.

## Zkey Bootstrap Command

Run:

```bash
cd chains/solana
npm run bridge:bootstrap:zkeys
```

The command verifies persistent artifacts and recreates repo symlinks:

```text
/data/circuit-artifacts/merkle_batch_update/merkle_batch_update.zkey
/data/circuit-artifacts/withdraw/withdraw.zkey
```

to:

```text
circuits/merkle_batch_update/build/merkle_batch_update.zkey
circuits/withdraw/build/withdraw.zkey
```

The artifact root is configurable with:

```text
BRIDGE_CIRCUIT_ARTIFACT_DIR=/data/circuit-artifacts
```

`/tmp` zkeys are blocked for hosted readiness unless the explicit test override is set.

## Expected Hashes

```text
merkle_batch_update.zkey:
107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9

withdraw.zkey:
cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0
```

If either file is missing or mismatched, bootstrap fails with a non-secret error and does not report readiness.

## Symlink Behavior

The bootstrap command creates missing build directories and replaces repo-local zkey symlinks with links to the durable `/data/circuit-artifacts` files.

The command then verifies:

- persistent file exists
- SHA256 matches expected
- repo path exists
- repo path is a symlink
- symlink resolves to the persistent copy

## Operator Prerequisite Command

Run:

```bash
cd chains/solana
npm run bridge:operator:prereq
```

The command checks:

- safe mode: `BRIDGE_DAEMON_MODE=paper`
- live submit disabled: `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- zkey bootstrap/check status
- durable note-state directory
- bridge results directory
- leaf-index evidence for the destination hash, when provided
- fresh preflight report, when destination hash is provided
- fresh recovery snapshot, when destination hash is provided
- wallet public key vs pool authority, when wallet env is present
- no hosted readiness path uses `/tmp`

It prints only non-secret metadata.

## Readiness Statuses

The prerequisite command emits one readiness value:

```text
ready
blocked_zkeys
blocked_note_state
blocked_preflight
blocked_recovery_snapshot
blocked_leaf_index
blocked_wallet
blocked_safe_mode
```

It also emits one recommended action:

```text
run_bootstrap_zkeys
restore_note_state
run_preflight
run_recovery_snapshot
run_dry_run_job
operator_review_required
```

## Render Run Sequence

Use this sequence after every Render deploy and before any operator job:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

npm run bridge:bootstrap:zkeys
npm run bridge:operator:prereq
npm run bridge:preflight:settle-withdraw
npm run bridge:recovery:snapshot
npm run bridge:job:settle-withdraw
```

Only after a fresh preflight, fresh recovery snapshot, and dry-run job wrapper are reviewed should an operator consider an explicit execute flag.

Persistent hosted paths:

```text
/data/circuit-artifacts
/data/white-bridge-note-state
/data/bridge-results
```

`/tmp` is not acceptable for hosted zkeys, note-state, preflight reports, recovery snapshots, leaf-index evidence, or job-index state.

## Tests Run

Codespace validation:

```text
cd chains/solana && npm run bridge:test-operator:prereq
cd chains/solana && npm run bridge:test-job:settle-withdraw
cd chains/solana && npm run test:rust
cd chains/solana && npm run build:sbf
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
cd relayer && npm run watcher:report
```

Render-specific `bridge:bootstrap:zkeys` and `bridge:operator:prereq` should be run on the disk-backed service after deploy.

## Remaining Limitations

- Bootstrap is an explicit operator command. The relayer start command does not automatically repair zkey symlinks yet.
- The command checks the known hosted zkey layout only; if future circuits are added, the bootstrap list must be extended.
- Rust/SBF validation still belongs in Codespace or CI, not Render's Node runtime.

## Next Recommended PR

PR-012Q should add a non-secret hosted operator status endpoint or CLI bundle that reports the latest bootstrap, preflight, recovery snapshot, leaf-index evidence, and job-index readiness in one place.
