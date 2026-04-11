# The White Protocol - Rebranding Implementation Checklist

Use this checklist to track progress during the rebrand.

## Legend
- [ ] Not started
- [~] In progress
- [x] Complete

---

## Stage 1: Rust Program (Critical)

### Directory & Config
- [ ] Rename `programs/psol-privacy-v2/` → `programs/white-protocol/`
- [ ] Update `Cargo.toml` workspace member
- [ ] Update `programs/white-protocol/Cargo.toml` package name
- [ ] Update `programs/white-protocol/Cargo.toml` lib name

### Core Library
- [ ] Update `src/lib.rs` - program module name
- [ ] Update `src/lib.rs` - declare_id and exports
- [ ] Update `src/error.rs` - error enum name
- [ ] Update `src/error.rs` - error message strings

### State Accounts & PDAs
- [ ] Update `src/state/pool_config.rs` - struct name (PoolConfigV2 → PoolConfig)
- [ ] Update `src/state/pool_config.rs` - seed prefix (pool_v2 → white_pool)
- [ ] Update `src/state/merkle_tree.rs` - struct name (MerkleTreeV2 → MerkleTree)
- [ ] Update `src/state/merkle_tree.rs` - seed prefix (merkle_tree_v2 → merkle_tree)
- [ ] Update `src/state/asset_vault.rs` - seed prefix (vault_v2 → vault)
- [ ] Update `src/state/spent_nullifier.rs` - struct name (SpentNullifierV2 → SpentNullifier)
- [ ] Update `src/state/spent_nullifier.rs` - seed prefix (nullifier_v2 → nullifier)
- [ ] Update `src/state/pending_deposits.rs` - seed prefix (pending_deposits → pending)
- [ ] Update `src/state/verification_key.rs` - struct name (VerificationKeyAccountV2 → VerificationKeyAccount)
- [ ] Update `src/state/mod.rs` - re-exports

### Instructions
- [ ] Update all instruction files - PDA seed references
- [ ] Update `src/instructions/initialize_pool_v2.rs` - account names
- [ ] Update `src/instructions/initialize_pool_registries.rs` - account names
- [ ] Update `src/instructions/deposit_masp.rs` - account names
- [ ] Update `src/instructions/withdraw_*.rs` - account names
- [ ] Update `src/instructions/mod.rs` - re-exports

### Crypto & Utils
- [ ] Update `src/crypto/` files - any pSOL references in comments
- [ ] Update `src/utils/` files - any pSOL references

### Build & Test
- [ ] Run `cargo build` - fix any errors
- [ ] Run `cargo test` - ensure all tests pass
- [ ] Generate new IDL: `anchor build`

---

## Stage 2: Anchor Configuration

- [ ] Update `Anchor.toml` - [programs.*] section names
- [ ] Update `Anchor.toml` - test script references (if any)

---

## Stage 3: SDK

### Package & Config
- [ ] Update `sdk/package.json` - name (@psol/sdk → @whiteprotocol/sdk)
- [ ] Update `sdk/package.json` - description
- [ ] Update `sdk/package.json` - author
- [ ] Update `sdk/package.json` - repository URL
- [ ] Update `sdk/package.json` - keywords

### Core Files
- [ ] Update `sdk/src/index.ts` - exports and constants
- [ ] Update `sdk/src/client.ts` - class name (PsolV2Client → WhiteProtocolClient)
- [ ] Update `sdk/src/client.ts` - factory function name
- [ ] Update `sdk/src/client.ts` - comments and strings
- [ ] Update `sdk/src/pda.ts` - seed constants
- [ ] Update `sdk/src/pda.ts` - function names (if any)
- [ ] Update `sdk/src/pda.ts` - default program ID (optional)
- [ ] Update `sdk/src/types.ts` - interface names

### IDL
- [ ] Copy new IDL from `target/idl/white_protocol.json`
- [ ] Rename `sdk/src/idl/psol_privacy_v2.json` → `white_protocol.json`
- [ ] Update all IDL imports in SDK

### Submodules
- [ ] Update `sdk/src/proof/prover.ts` - comments, strings
- [ ] Update `sdk/src/note/note.ts` - comments, strings
- [ ] Update `sdk/src/merkle/tree.ts` - comments, strings
- [ ] Update `sdk/src/crypto/*.ts` - comments, strings

### Build & Test
- [ ] Run `cd sdk && npm run build`
- [ ] Run `cd sdk && npm test` (if tests exist)

---

## Stage 4: Relayer

### Package
- [ ] Update `relayer/package.json` - name (@psol/relayer → @whiteprotocol/relayer)
- [ ] Update `relayer/package.json` - description

### Source Code
- [ ] Update `relayer/src/index.ts` - service name in comments/logs
- [ ] Update `relayer/src/index.ts` - class name (if applicable)
- [ ] Update `relayer/src/api-extensions.ts` - comments, strings
- [ ] Update `relayer/src/cache/nullifier-cache.ts` - comments

### Environment
- [ ] Update `relayer/.env.example` - variable names
- [ ] Update any environment variable references in code

### Build
- [ ] Run `cd relayer && npm run build`

---

## Stage 5: Root Package

- [ ] Update `package.json` - name (psol-v2-complete → white-protocol)
- [ ] Update `package.json` - description
- [ ] Update `package.json` - repository URL
- [ ] Update `package.json` - scripts (if any pSOL-specific names)

---

## Stage 6: Scripts

### High Priority Scripts
- [ ] Update `scripts/init-pool-production.ts` - imports, class names
- [ ] Update `scripts/init-pool-fixed.ts` - imports, class names
- [ ] Update `scripts/init-fresh-pool.ts` - imports, class names
- [ ] Update `scripts/register-relayer.ts` - imports, class names
- [ ] Update `scripts/register-assets.ts` - imports, class names
- [ ] Update `scripts/upload-all-vks.ts` - imports, class names
- [ ] Update `scripts/sequencer.ts` - imports, class names
- [ ] Update `scripts/sequencer-production.ts` - imports, class names

### Medium Priority Scripts
- [ ] Update `scripts/setup-pool-registries.ts` - imports, class names
- [ ] Update `scripts/init-yield-registry.ts` - imports, class names
- [ ] Update `scripts/setup-yield-enforcement.ts` - imports, class names
- [ ] Update `scripts/check-*.ts` - imports, class names
- [ ] Update `scripts/reset-merkle.ts` - imports, class names
- [ ] Update `scripts/clear-pending.ts` - imports, class names

### Lower Priority Scripts
- [ ] Update remaining scripts in `scripts/` directory
- [ ] Update scripts in `scripts/ts/` subdirectory

---

## Stage 7: Tests

- [ ] Update `tests/test-withdraw-e2e-fixed.ts` - imports, class names
- [ ] Update `tests/deposit-withdraw-integration.ts` - imports, class names
- [ ] Update `tests/withdraw-integration.ts` - imports, class names
- [ ] Update `tests/withdraw-only.ts` - imports, class names
- [ ] Update `tests/create-test-deposit.ts` - imports, class names
- [ ] Update `tests/execute-test-deposit.ts` - imports, class names
- [ ] Update `tests/relayer-node-validation.ts` - imports, class names

---

## Stage 8: Documentation

### Primary
- [ ] Update `README.md` - title and all content
- [ ] Update `README.md` - program name references
- [ ] Update `README.md` - SDK installation instructions
- [ ] Update `README.md` - code examples

### Secondary
- [ ] Update `docs/*.md` files (if any)
- [ ] Update `STATUS-POOL-V8.md` (or rename)
- [ ] Update `WALLETS.md` (if pSOL references)

### Code Documentation
- [ ] Update inline comments in all Rust files
- [ ] Update inline comments in all TypeScript files
- [ ] Update circuit comments

---

## Stage 9: Circuits

- [ ] Update `circuits/deposit/deposit.circom` - header comment
- [ ] Update `circuits/withdraw/withdraw.circom` - header comment
- [ ] Update `circuits/withdraw_v2/withdraw_v2.circom` - header comment
- [ ] Update `circuits/joinsplit/joinsplit.circom` - header comment
- [ ] Update `circuits/merkle_tree.circom` - header comment
- [ ] Update `circuits/batch_append/batch_append.circom` - header comment
- [ ] Update `circuits/membership/membership.circom` - header comment
- [ ] Update `circuits/merkle_batch_update/merkle_batch_update.circom` - header comment

---

## Stage 10: Configuration Files

- [ ] Update `tsconfig.json` - comments (if any pSOL refs)
- [ ] Update `.gitignore` - paths (if changed)
- [ ] Update `sequencer-config.json` - comments/structure
- [ ] Update `pool.devnet.json` - name references
- [ ] Update `test-yield-mint.json` - comments

---

## Stage 11: Build Scripts & Tools

- [ ] Update `scripts/compile-circuits.sh` - comments, output paths
- [ ] Update `scripts/trusted-setup.sh` - comments
- [ ] Update `scripts/generate-poseidon-constants.js` - comments

---

## Stage 12: Git & Repository

- [ ] Create new branch: `git checkout -b rebrand/white-protocol`
- [ ] Commit all changes with clear message
- [ ] Push branch: `git push origin rebrand/white-protocol`
- [ ] Create Pull Request
- [ ] Update README with migration guide
- [ ] Tag old version: `git tag v2.0.0-psol`

---

## Stage 13: Deployment (Post-Merge)

### Devnet Testing
- [ ] Deploy to devnet: `anchor deploy --provider.cluster devnet`
- [ ] Initialize pool with new seeds
- [ ] Upload verification keys
- [ ] Register test assets
- [ ] Register relayer
- [ ] Run integration tests

### Mainnet Deployment (if applicable)
- [ ] Deploy to mainnet
- [ ] Initialize production pool
- [ ] Configure production parameters
- [ ] Set up monitoring

---

## Verification Steps

### Code Verification
- [ ] No remaining "pSOL" strings in source code (except historical comments)
- [ ] No remaining "psol" strings in variable/function names
- [ ] No remaining "Psol" strings in class/type names
- [ ] All tests pass
- [ ] SDK builds without errors
- [ ] Relayer builds without errors
- [ ] Anchor program builds without errors

### Functional Verification
- [ ] Deposit flow works end-to-end
- [ ] Withdrawal flow works end-to-end
- [ ] Relayer accepts and processes requests
- [ ] Sequencer batches deposits correctly
- [ ] SDK can generate valid proofs

---

## Post-Rebrand Tasks

- [ ] Update GitHub repository name (if desired)
- [ ] Update GitHub repository description
- [ ] Publish new SDK to npm (as @whiteprotocol/sdk)
- [ ] Update any external documentation
- [ ] Announce rebrand to community
- [ ] Update social media profiles
- [ ] Update website/domain (if applicable)

---

## Rollback Plan

If issues arise:
1. Revert merge commit
2. Checkout `main` branch
3. Redeploy old program (if new program was deployed)
4. Notify users of rollback

---

*Checklist Version: 1.0*
*Last Updated: 2026-04-10*
