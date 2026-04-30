# PR-002 — Solana CI, Deterministic Localnet E2E Gates, and Proof/Vector Regression Checks

## 1. Summary

PR-002 adds automated continuous integration (CI) for the Solana core path to prevent regressions after the successful devnet upgrade in PR-001D.

**Goal:** Every pull request that touches `chains/solana/` or `circuits/` must prove that the core deposit → settle → withdraw → double-spend rejection → invalid proof/root rejection path still works on localnet with real proof verification.

---

## 2. Why PR-002 is Needed After PR-001D

PR-001D verified the Solana program on both localnet and devnet, but verification was manual. Without automated gates, future PRs could:
- Break the Rust unit tests
- Introduce IDL drift between source and committed artifacts
- Accidentally enable `insecure-dev` or `event-debug` in release builds
- Corrupt or omit circuit verification key files
- Break the localnet integration test path

PR-002 turns the manual PR-001D verification checklist into automated CI jobs.

---

## 3. CI Workflows Added/Modified

### `.github/workflows/solana-ci.yml` (NEW)
Triggered on:
- `pull_request` touching `chains/solana/**`, `circuits/**`, or the workflow itself
- `push` to `main`/`master`
- `workflow_dispatch`

**Jobs:**

| Job | What It Proves |
|---|---|
| `solana-rust` | `cargo test -p white-protocol --lib` passes (97 tests) and `cargo build-sbf` succeeds |
| `solana-build-mode-safety` | `insecure-dev` and `event-debug` are not in default features; `compile_error` guards reject them in release builds |
| `solana-idl-drift` | `anchor build` produces an IDL identical to the committed `target/idl/white_protocol.json` (modulo volatile metadata) |
| `solana-circuit-artifacts` | Required zkey/wasm/vk files exist for deposit, withdraw, and merkle_batch_update circuits; VK upload script references match disk |
| `solana-localnet-e2e` | Full localnet flow: validator → deploy → setup pool → upload VKs → run `test-settlement-production.ts` → 7/7 pass |

### `.github/workflows/solana-devnet-verify.yml` (NEW)
- **Trigger:** `workflow_dispatch` only
- **Purpose:** Manual devnet smoke test after releases or critical changes
- **Behavior:** Runs `test-settlement-production.ts` against devnet RPC
- **Secrets:** Uses `SOLANA_DEVNET_RPC` (optional) and `SOLANA_DEVNET_WALLET_PATH` (optional). Skips gracefully if wallet secret is absent.
- **Does NOT run on PRs** — no devnet secrets required for normal CI.

### `.github/workflows/circuit-ci.yml` (NEW)
- **Trigger:** `workflow_dispatch`
- **Purpose:** Manual circuit recompilation gate (slow)
- **Jobs:**
  - `circuit-artifact-check` — fast presence/compatibility check (same as `solana-circuit-artifacts`)
  - `circuit-compile` — slow recompilation of all circuits with `circom` + `snarkjs` (only when `compile=true` input is set)

### `.github/workflows/ci.yml` (EXISTING — NOT MODIFIED)
- Still builds frontend, relayer, and Docker image.
- No Solana jobs added here to keep concerns separate.

---

## 4. Package Scripts Added/Modified

### `chains/solana/package.json`

| Script | Command | Purpose |
|---|---|---|
| `build:sbf` | `cargo build-sbf` | Build Solana BPF binary |
| `test:rust` | `cargo test -p white-protocol --lib` | Run Rust unit tests |
| `test:settlement:localnet` | `bash scripts/ci-localnet-e2e.sh` | Full deterministic localnet E2E |
| `test:settlement:devnet` | `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npx tsx tests/test-settlement-production.ts` | Devnet integration test (manual) |
| `ci:solana` | `npm run ci:rust && npm run ci:build && npm run ci:circuits && npm run ci:idl-check` | Run all fast CI checks locally |
| `ci:rust` | `npm run test:rust` | Rust test gate |
| `ci:build` | `npm run build:sbf` | SBF build gate |
| `ci:build-mode` | `npx tsx scripts/check-build-mode-safety.ts` | Build-mode safety gate |
| `ci:circuits` | `npx tsx scripts/check-circuit-artifacts.ts` | Circuit artifact gate |
| `ci:idl-check` | `npx tsx scripts/check-idl-drift.ts` | IDL drift gate |
| `ci:localnet` | `bash scripts/ci-localnet-e2e.sh` | Localnet E2E gate |

---

## 5. Localnet E2E Behavior

**Orchestration:** `chains/solana/scripts/ci-localnet-e2e.sh`

1. **Generate temp wallet** — `solana-keygen new --no-passphrase`
2. **Start `solana-test-validator`** — fresh ledger, waits for RPC health
3. **Airdrop 100 SOL** — to temp wallet
4. **Deploy `white_protocol.so`** — using `target/deploy/white_protocol-keypair.json` (localnet ID: `DAoezX29...`)
5. **Initialize pool** — `setup-localnet.ts` with `PROGRAM_ID` override
6. **Upload VKs** — `upload-vks-localnet.ts` with `PROGRAM_ID` override
7. **Run integration test** — `test-settlement-production.ts` with `PROGRAM_ID` override and `TEST_SLEEP_MS=2000`
8. **Cleanup** — kill validator, delete temp wallet

**Key determinism measures:**
- No committed private keys used
- Fresh validator with `--reset`
- Fresh wallet per run
- Program ID override via env var
- Setup scripts read `ANCHOR_WALLET` and `ANCHOR_PROVIDER_URL` from env
- `declare_id!` is temporarily patched to the localnet keypair ID before `anchor build`, then restored to the canonical devnet ID after deployment

---

## 6. Devnet Manual Verification Behavior

- Triggered manually via GitHub Actions UI
- Requires `SOLANA_DEVNET_WALLET_PATH` repository secret (optional)
- Uses `TEST_SLEEP_MS=5000` by default to accommodate devnet RPC lag
- Records test output in Actions logs
- Does not expose secrets in logs

---

## 7. Build-Mode Safety Checks

**Script:** `chains/solana/scripts/check-build-mode-safety.ts`

Checks:
1. `Cargo.toml` `default` features do not contain `insecure-dev`
2. `Cargo.toml` `default` features do not contain `event-debug`
3. `lib.rs` contains `compile_error!("insecure-dev cannot be enabled in release builds")`
4. `lib.rs` contains `compile_error!("event-debug cannot be enabled in release builds")`
5. `cargo build-sbf` succeeds without unsafe features
6. `cargo build-sbf -- --features insecure-dev` fails with the expected compile error
7. `cargo build-sbf -- --features event-debug` fails with the expected compile error

**Result:** All 7 checks pass.

---

## 8. IDL Drift Checks

**Script:** `chains/solana/scripts/check-idl-drift.ts`

Process:
1. Backup committed IDL
2. Run `anchor build`
3. Compare generated IDL with committed IDL
4. Strip volatile metadata (`generatedAt`, `solanaVersion`, `anchorVersion`) before comparison
5. Restore committed IDL so working tree stays clean

**Failure mode:** If IDL drift is detected, CI fails with a message instructing the developer to run `anchor build` locally and commit the updated IDL.

---

## 9. Circuit/Proof Artifact Checks

**Script:** `chains/solana/scripts/check-circuit-artifacts.ts`

Checks:
1. `deposit.zkey`, `deposit.wasm`, `deposit_vk.json` exist and are above minimum size
2. `withdraw.zkey`, `withdraw.wasm`, `withdraw_vk.json` exist and are above minimum size
3. `merkle_batch_update.zkey`, `merkle_batch_update.wasm`, `verification_key.json` exist and are above minimum size
4. `upload-vks-localnet.ts` references the same VK file paths that exist on disk
5. `merkle_batch_update.circom` declares `depth=20, maxBatch=1`

**Result:** All checks pass.

---

## 10. Secrets Policy

| Secret / Key | Location | Committed? | CI Usage |
|---|---|---|---|
| Devnet wallet keypair | `~/.config/solana/id.json` | ❌ NO | Manual workflow only |
| Localnet temp wallet | Generated at runtime | ❌ NO | Localnet E2E job only |
| Devnet RPC URL | `https://api.devnet.solana.com` (public) | N/A | Manual workflow only |
| Program deploy keypairs | `target/deploy/*-keypair.json` | ✅ YES (pubkey only, no private key in source) | Localnet deploy |

**Policy:**
- No private keys are committed.
- No `.env` files with secrets are committed.
- CI does not require devnet secrets for normal PR gates.
- Devnet verification is opt-in manual only.

---

## 11. Commands Run Locally

```bash
# Fast CI checks (no validator needed)
cd chains/solana
npm run ci:solana

# Individual checks
npm run test:rust        # ✅ 97 passed
npm run build:sbf        # ✅ succeeds
npm run ci:build-mode    # ✅ all guards active
npm run ci:circuits      # ✅ all artifacts present
npm run ci:idl-check     # ✅ no drift

# Full localnet E2E (requires solana-test-validator)
npm run ci:localnet      # ✅ 7/7 passed

# Devnet integration test (requires funded devnet wallet)
TEST_SLEEP_MS=5000 \
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npm run test:settlement:devnet
```

---

## 12. Tests Passing

| Check | Local Result | CI Job |
|---|---|---|
| Rust unit tests (`cargo test --lib`) | ✅ 97 passed | `solana-rust` |
| SBF build (`cargo build-sbf`) | ✅ succeeds | `solana-rust` |
| Build-mode safety | ✅ all guards active | `solana-build-mode-safety` |
| IDL drift | ✅ no drift | `solana-idl-drift` |
| Circuit artifacts | ✅ all present | `solana-circuit-artifacts` |
| Localnet E2E (`test-settlement-production.ts`) | ✅ 7/7 passed (validated live) | `solana-localnet-e2e` |

---

## 13. Tests Failing / Known Limitations

| Limitation | Details |
|---|---|
| `cargo fmt --check` | Not enabled in CI because ~62 files have formatting drift. Enabling would require a dedicated formatting PR. Documented as a known gap. |
| Circuit recompilation | Not run automatically in PR CI because `circom` + `snarkjs` compilation is slow (~10–30 min). Available as manual `workflow_dispatch` in `circuit-ci.yml`. |
| Devnet verification | Requires wallet secret; manual only. |
| Localnet E2E runtime | ~5–8 minutes per run due to validator startup, program deploy, VK upload, and `snarkjs` proof generation. |

---

## 14. Remaining CI Gaps

| Gap | Priority | Next Step |
|---|---|---|
| `cargo fmt --check` | 🟡 Medium | Run `cargo fmt` across `chains/solana/programs` and enable in CI |
| `cargo clippy` | 🟡 Medium | Fix clippy warnings and add to CI |
| Bridge program tests | 🔴 Low (out of scope) | Bridge CI is not part of PR-002 |
| Frontend/App UI tests | 🔴 Low (out of scope) | Separate workflow already exists in `.github/workflows/ci.yml` |
| Relayer integration tests | 🔴 Low (out of scope) | Relayer has its own build job in root CI |

---

## 15. Final Status

**Solana core path is now CI-gated on every PR.**

---

## 16. Next Recommended Step

1. Run `cargo fmt` across `chains/solana/programs/` and enable `cargo fmt --check` in `solana-rust` job.
2. Run `cargo clippy` and fix warnings; add clippy to CI.
3. Monitor the first few PRs for `solana-localnet-e2e` stability; adjust `TEST_SLEEP_MS` or validator startup wait if needed.
4. If devnet wallet secret is configured, run `.github/workflows/solana-devnet-verify.yml` manually after the next release.

---

*Report generated: 2026-04-30*
*PR-002 status: Complete*
