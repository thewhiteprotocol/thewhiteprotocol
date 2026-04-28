# PR-001B: Solana Settlement Production Hardening

## 1. Summary

PR-001B removes the temporary corruption bypass from `settle_deposits_batch`, introduces a canonical `MerkleTree::settle_batch` method, and ensures that all Merkle tree state mutations occur only after successful proof verification. The changes make the settlement path safe for production deployments on clean state.

## 2. What PR-001 Fixed

PR-001 (the previous debugging pass) identified and worked around a critical bug:

- **Root cause**: The original `settle_deposits_batch` updated `current_root` and `next_leaf_index` but **did NOT update `filled_subtrees`**.
- **Impact**: After settlement, `filled_subtrees` remained at its initial zero-tree values. Future settlements and `batch_process_deposits` would compute incorrect roots because left siblings were read from corrupted `filled_subtrees`.
- **Temporary fix**: A corruption-detection guard was added:
  ```rust
  let filled_subtrees_corrupted = merkle_tree.next_leaf_index > 0
      && merkle_tree.filled_subtrees.iter().all(|h| crate::crypto::is_zero_hash(h));
  if !filled_subtrees_corrupted { /* replay insertions */ }
  ```
  This allowed the devnet deployment to continue operating by skipping the consistency check when corrupted state was detected.

## 3. Why PR-001 Was Not Enough for Production

The PR-001 bypass has several production-unsafe properties:

1. **Silent skip on corrupted state**: If a tree ever enters a corrupted state, settlements silently skip the `filled_subtrees` update, making the corruption permanent and undiagnosable.
2. **No atomic state update**: Proof verification, replay, and state updates were separate steps scattered across the handler.
3. **No canonical function**: There was no single function responsible for maintaining the Merkle tree invariant during settlement.
4. **event-debug enabled**: The `event-debug` feature compile guard was commented out, allowing privacy-leaking debug events in release builds.
5. **Partial state mutation risk**: `replay_insertions` mutated `filled_subtrees` before the root consistency check. In the (theoretical) case of a hash error mid-replay, the tree could be left partially updated. While Solana transactions abort atomically on error, the code structure was not defensive.

## 4. Final Production Invariant

After PR-001B, the settlement path maintains the following invariant:

> **For every successful `settle_deposits_batch` transaction on a clean tree:**
> - `filled_subtrees` is updated to reflect all inserted commitments.
> - `current_root` equals the root computed by replaying insertions.
> - `next_leaf_index` is incremented by the batch size.
> - `total_leaves` is incremented by the batch size.
> - `root_history` contains the new root.
> - No state is mutated if proof verification or root consistency checks fail.

## 5. Corruption Bypass Status

**Removed entirely from normal settlement.**

The `filled_subtrees_corrupted` bypass has been deleted from `settle_deposits_batch.rs`.

For devnet instances that were deployed with the pre-PR-001B code and have corrupted `filled_subtrees`, the recovery path is:

1. **`reset_merkle_tree` admin instruction**: Resets the tree to empty state (`next_leaf_index = 0`, `filled_subtrees = zeros`, `current_root = zeros[depth]`). This loses all historical roots but is safe for a testnet.
2. **Reinitialize the pool**: Close and recreate the pool accounts.
3. **Do NOT attempt to settle on corrupted state**: The program now correctly rejects such settlements with `InvalidProof` because the on-chain replay computes a different root than the proof claims.

## 6. Exact Merkle Fields Updated During Settlement

The canonical `MerkleTree::settle_batch` updates these fields **in this order**:

1. `filled_subtrees` — updated to reflect the new rightmost hashes at each level.
2. `current_root` — set to the computed root.
3. `next_leaf_index` — incremented by `batch_size`.
4. `total_leaves` — incremented by `batch_size`.
5. `last_insertion_at` — set to current timestamp.
6. `root_history[root_history_index]` — set to new root.
7. `root_history_index` — incremented (wraps around `root_history_size`).

## 7. State Mutation Ordering

`settle_deposits_batch::handler` now follows this strict ordering:

1. **Read-only validation** (batch size, tree capacity, pending deposits).
2. **Compute commitments hash** (read-only).
3. **Build public inputs** (read-only).
4. **Verify Groth16 proof** (read-only — no state touched).
5. **Call `merkle_tree.settle_batch`** — this is the FIRST state mutation. It:
   - Computes new `filled_subtrees` in a **temporary buffer**.
   - Compares computed root to `expected_new_root`.
   - Only after the check succeeds, writes all state atomically.
6. **Emit per-commitment events** (read-only emit, but after state mutation).
7. **Clear processed deposits from pending buffer**.
8. **Update pool statistics**.
9. **Emit batch settled event**.

If step 4 (proof verification) fails, **zero** state is mutated.
If step 5 (root consistency check) fails, **zero** state is mutated.

## 8. Test Matrix

| Test | Description | Location | Status |
|------|-------------|----------|--------|
| Test 1 | Fresh single batch: deposit → settle → withdraw → double-spend rejection | `test-settlement-production.ts` | Written (needs deployed program) |
| Test 2 | Fresh multi-leaf batch (2 leaves): withdraw both | `test-settlement-production.ts` | Written (needs deployed program) |
| Test 3 | Odd leaf count (3 leaves): withdraw all 3 | `test-settlement-production.ts` | Written (needs deployed program) |
| Test 4 | Multi-batch non-zero start index | `test-settlement-production.ts` | Written (needs deployed program) |
| Test 5 | Invalid proof: mutate proof → tx fails → state unchanged | `test-settlement-production.ts` | Written (needs deployed program) |
| Test 6 | Corrupted state fails clearly (no bypass) | `merkle_tree.rs` unit test | **PASS** |
| Test 7 | Build mode: no insecure-dev, no event-debug in release | `merkle_tree.rs` unit test + `lib.rs` | **PASS** |
| Rust UT | `test_settle_batch_single_leaf` | `merkle_tree.rs` | **PASS** |
| Rust UT | `test_settle_batch_multi_leaf` | `merkle_tree.rs` | **PASS** |
| Rust UT | `test_settle_batch_odd_count` | `merkle_tree.rs` | **PASS** |
| Rust UT | `test_settle_batch_non_zero_start_index` | `merkle_tree.rs` | **PASS** |
| Rust UT | `test_settle_batch_invalid_root_reverts` | `merkle_tree.rs` | **PASS** |
| Rust UT | `test_settle_batch_corrupted_state_fails` | `merkle_tree.rs` | **PASS** |
| Full suite | All Rust unit tests | `cargo test -p white-protocol --lib` | **97 passed** |

## 9. Commands Run

```bash
# Rust unit tests
cd chains/solana
cargo test -p white-protocol --lib
# result: 97 passed; 0 failed

# Poseidon vector tests (cryptographic sanity)
cargo test -p white-protocol --test poseidon_vectors_test -- --nocapture
# result: 6 passed; 0 failed

# Release build (verifies no event-debug in release)
cd chains/solana/programs/white-protocol
cargo build-sbf
# result: Finished release profile (optimized)

# TypeScript integration test (requires funded wallet + deployed program)
# cd chains/solana
# npx tsx tests/test-settlement-production.ts
```

## 10. Passing / Failing Results

| Check | Result |
|-------|--------|
| Rust unit tests | **97/97 PASS** |
| Poseidon vector tests | **6/6 PASS** |
| Release SBF build | **PASS** (no compile errors) |
| `test-settlement-production.ts` | Written, not run against live program (requires deployment) |

## 11. Is Solana Deposit-Settle-Withdraw Production-Safe on a Clean Deployment?

**Yes, on a clean deployment.**

The settlement path now:
- Uses a single canonical `settle_batch` function that updates all Merkle fields.
- Verifies the Groth16 proof before any state mutation.
- Replays insertions to update `filled_subtrees` and defends with a root consistency check.
- Does not contain any corruption bypass.
- Does not require `insecure-dev` or `event-debug` for normal operation.

**Caveat**: This conclusion applies to the **program code**. A full production readiness assessment would also require:
- Formal circuit audit
- Dedicated trusted setup ceremony
- On-chain soak testing with the upgraded program
- Relayer compatibility verification

## 12. Remaining Solana Blockers

| Blocker | Severity | Notes |
|---------|----------|-------|
| Circuit audit | High | Circuits have not been formally audited. |
| Trusted setup | High | Current setup uses Hermez PTAU + single contribution. |
| `MAX_BATCH_SIZE = 1` | Medium | Circuit and relayer support larger batches but program is capped at 1. |
| On-chain soak test | Medium | Needs deployment to devnet + extended traffic. |
| Relayer adapter update | Low | Relayer should be verified to work with the hardened settlement. |
| `get_merkle_path` accuracy | Low | Comment notes it may return incorrect siblings for ZK-settled trees; withdrawals verify roots, not paths, on-chain. |

## 13. Recommended Next Step

1. **Deploy the upgraded program to devnet** (with authority held by a multisig or ledger).
2. **Run `test-settlement-production.ts`** against the upgraded devnet deployment to verify the full deposit-settle-withdraw flow with real proofs.
3. **Run the existing e2e test suite** (`test-02-withdraw.ts`, `test-03-partial-withdraw.ts`, `test-04-rejections.ts`, etc.) to confirm no regressions.
4. **Schedule circuit audit and dedicated trusted setup ceremony** before mainnet.

---

*Report generated: 2026-04-28*
*Program version: 2.0.0*
*Commit range: PR-001B production hardening*
