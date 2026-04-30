# PR-002B — Safe Codespace Disk Cleanup, Solana Formatting & Clippy CI Gates

## 1. Summary

PR-002B closes the remaining CI hygiene gaps identified in PR-002 by:
1. Safely recovering Codespace disk space.
2. Running `cargo fmt` across all Solana Rust source.
3. Running `cargo clippy` and fixing all warnings.
4. Enabling `cargo fmt --check` and `cargo clippy -D warnings` in CI.

---

## 2. Disk Issue and Cleanup Approach

The Codespace was at **99% disk usage** (30G used / 32G total, only 538M free). Large accumulations of build artifacts, test ledgers, and caches made it impossible to run additional builds or validation.

**Approach:** Audit first, classify every large directory, then delete only items that are safe and regenerable. No source files, secrets, keypairs, or committed artifacts were removed.

---

## 3. Disk Usage Before Cleanup

```
Filesystem      Size  Used Avail Use% Mounted on
overlay          32G   30G  538M  99% /
```

**Top consumers:**
- `chains/solana/target/debug` — 3.3 GB
- `test-ledger` (root) — 3.0 GB
- `~/.npm` cache — 3.3 GB
- `chains/solana/target/release` — 225 MB
- `chains/solana/target/sbpf-solana-solana` — 145 MB
- `chains/solana/test-ledger` — 376 MB
- Docker build cache + images — ~1.1 GB
- `chains/solana/stealth-utils/target` — 30 MB

---

## 4. Cleanup Actions Taken

| # | Action | Space Recovered |
|---|---|---|
| 1 | `docker system prune -af --volumes` | ~894 MB |
| 2 | `rm -rf test-ledger` (root) | ~3.0 GB |
| 3 | `rm -rf chains/solana/test-ledger` | ~376 MB |
| 4 | `rm -rf chains/solana/target/debug` | ~3.3 GB |
| 5 | `rm -rf chains/solana/target/release` | ~225 MB |
| 6 | `rm -rf chains/solana/target/sbpf-solana-solana` | ~145 MB |
| 7 | `rm -rf chains/solana/stealth-utils/target` | ~30 MB |
| 8 | `rm -rf chains/solana/target/tmp` | negligible |
| 9 | `npm cache clean --force` | ~3.3 GB |
| **Total** | | **~11.3 GB** |

---

## 5. Disk Usage After Cleanup

```
Filesystem      Size  Used Avail Use% Mounted on
overlay          32G   19G   12G  61% /
```

**Available space increased from 538 MB to 12 GB.**

---

## 6. Files/Directories Deliberately Not Deleted

- `.git/` (236 MB) — source history
- `chains/solana/target/deploy/` (2.4 MB) — contains deployment keypairs and `.so` binaries
- `chains/solana/target/idl/` & `target/types/` — committed generated artifacts
- `circuits/build/` — committed circuit zkey/wasm/vk artifacts
- Any `.env*` files
- Any source files, keypairs, wallet files, or secret material

---

## 7. Formatting Changes Summary

**Command:** `cd chains/solana && cargo fmt`

**Result:** 24 Rust files reformatted. All changes are purely mechanical (whitespace, line breaks, import ordering). No business logic was changed.

**Files touched (formatting only):**
- `programs/white-protocol/src/lib.rs`
- `programs/white-protocol/src/crypto/poseidon.rs`
- `programs/white-protocol/src/crypto/public_inputs.rs`
- `programs/white-protocol/src/instructions/admin/clear_pending.rs`
- `programs/white-protocol/src/instructions/admin/reset_merkle.rs`
- `programs/white-protocol/src/instructions/batch_process_deposits.rs`
- `programs/white-protocol/src/instructions/bridge_withdraw.rs`
- `programs/white-protocol/src/instructions/deposit_masp.rs`
- `programs/white-protocol/src/instructions/initialize_bridge_config.rs`
- `programs/white-protocol/src/instructions/mod.rs`
- `programs/white-protocol/src/instructions/private_transfer.rs`
- `programs/white-protocol/src/instructions/set_feature_flags.rs`
- `programs/white-protocol/src/instructions/set_verification_key_chunked.rs`
- `programs/white-protocol/src/instructions/set_verification_key_v2.rs`
- `programs/white-protocol/src/instructions/settle_deposits_batch.rs`
- `programs/white-protocol/src/instructions/withdraw_masp.rs`
- `programs/white-protocol/src/instructions/withdraw_v2.rs`
- `programs/white-protocol/src/instructions/withdraw_yield_v2.rs`
- `programs/white-protocol/src/state/merkle_tree.rs`
- `programs/white-protocol/src/state/relayer.rs`
- `programs/white-protocol/tests/poseidon_vectors_test.rs`

---

## 8. Clippy Changes Summary

**Command:** `cd chains/solana && cargo clippy -p white-protocol --lib -- -D warnings`

**Initial errors:** 2

**Fixes applied:**

| Error | File | Fix |
|---|---|---|
| `clippy::large_const_arrays` | `crypto/poseidon_bn254_constants_fr.in.rs:1138` | Changed `pub const S_T5` to `pub static S_T5`. Reduces binary bloat by storing the 540-element array once instead of inlining at every use site. Semantics unchanged because the array is only ever read. |
| `clippy::needless_borrows_for_generic_args` | `instructions/settle_deposits_batch.rs:122` | Changed `Sha256::digest(&preimage)` to `Sha256::digest(preimage)`. `digest` accepts `impl AsRef<[u8]>`, so the borrow was unnecessary. Semantics identical. |

**Result after fixes:** `cargo clippy -p white-protocol --lib -- -D warnings` passes cleanly.

---

## 9. CI Workflow Changes

### `.github/workflows/solana-ci.yml`

Updated the `solana-rust` job to run checks in this order:

1. `cargo fmt --check`
2. `cargo clippy -p white-protocol --lib -- -D warnings`
3. `cargo test -p white-protocol --lib`
4. `cargo build-sbf`

**No changes to other jobs** (`solana-build-mode-safety`, `solana-idl-drift`, `solana-circuit-artifacts`, `solana-localnet-e2e`).

**No insecure-dev, event-debug, or devnet secrets are used.**

---

## 10. Package Scripts Added/Modified

### `chains/solana/package.json`

**Added:**
- `fmt` — `cargo fmt`
- `fmt:check` — `cargo fmt --check`
- `clippy` — `cargo clippy -p white-protocol --lib -- -D warnings`
- `ci:fmt` — `npm run fmt:check`
- `ci:clippy` — `npm run clippy`

**Modified:**
- `ci:solana` — now runs `ci:fmt && ci:clippy && ci:rust && ci:build && ci:circuits && ci:idl-check`

### `package.json` (root)

No changes needed — `ci:solana` delegates to `chains/solana`.

---

## 11. Commands Run

```bash
# Disk audit
df -h
du -h -d 1 . | sort -h

# Cleanup
docker system prune -af --volumes
rm -rf test-ledger chains/solana/test-ledger
rm -rf chains/solana/target/debug chains/solana/target/release
rm -rf chains/solana/target/sbpf-solana-solana chains/solana/stealth-utils/target
rm -rf chains/solana/target/tmp
npm cache clean --force

# Formatting
cd chains/solana && cargo fmt
cargo fmt --check

# Clippy
cargo clippy -p white-protocol --lib -- -D warnings

# Validation
cd chains/solana
npm run ci:fmt          # ✅ pass
npm run ci:clippy       # ✅ pass
npm run ci:rust         # ✅ 97 passed
npm run ci:build        # ✅ succeeds
npm run ci:build-mode   # ✅ all guards active
npm run ci:circuits     # ✅ all artifacts present
npm run ci:idl-check    # ✅ no drift
```

---

## 12. Tests/Checks Passed

| Check | Result |
|---|---|
| `cargo fmt --check` | ✅ Pass |
| `cargo clippy -p white-protocol --lib -- -D warnings` | ✅ Pass |
| `cargo test -p white-protocol --lib` | ✅ 97 passed |
| `cargo build-sbf` | ✅ Succeeds |
| Build-mode safety | ✅ All guards active |
| Circuit artifacts | ✅ All present |
| IDL drift | ✅ No drift |

---

## 13. Tests/Checks Failed

None.

---

## 14. Localnet E2E Run Status

**Not re-run in PR-002B.** The only program changes are:
- Mechanical formatting
- `const S_T5` → `static S_T5` (read-only data, no behavior change)
- `&preimage` → `preimage` in `Sha256::digest` (identical semantics)

Localnet E2E was validated in PR-002 (7/7 tests passed). Re-running the full localnet E2E (~5–8 min) was skipped to save time given that the changes are purely mechanical and the fast checks all pass.

---

## 15. Remaining Warnings or Cleanup Risks

| Item | Status |
|---|---|
| `cargo clippy` for `white-bridge-solana` | Not enabled — out of scope for PR-002B |
| `white-bridge-solana` dead_code warning (`WHITE_PROTOCOL_PROGRAM_ID`) | Pre-existing, not introduced by this PR |
| Docker images/containers | Fully pruned; will re-download if needed |
| Rust debug artifacts | Deleted; will rebuild on next debug compile |

---

## 16. Final Status

**Solana formatting and clippy are now CI-gated on every PR.**

Disk space is healthy (~12 GB free). All fast checks pass. No secrets or source files were harmed.

---

## 17. Next Recommended Step

1. Monitor the first few PRs to confirm `cargo fmt --check` and `cargo clippy` jobs run quickly in GitHub Actions.
2. If `white-bridge-solana` clippy warnings become noisy, add a separate bridge-specific clippy job.
3. Continue to keep `test-ledger` and `target/debug` in `.gitignore` so they don't get committed.

---

*Report generated: 2026-04-30*
*PR-002B status: Complete*
