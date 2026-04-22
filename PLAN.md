# Comprehensive Security & Bug Fix Plan — The White Protocol

## 0. Your Deposit Error: Root Cause
**"Transaction simulation failed: This transaction has already been processed"**

**Primary cause:** Frontend double-click / rapid retry + wallet-adapter internal retry + `sendRawTransaction` default `skipPreflight: false`.
- React state batching means `setBusy(true)` doesn't synchronously disable the button.
- Two concurrent `handleDeposit` calls both invoke `ensureAtaAndWrapIfNeeded()`.
- Wallet adapters retry identical signed bytes if the first HTTP response is lost.
- RPC preflight simulation rejects the duplicate with "already been processed".
- **No catch block treats this string as success**, so a landed transaction looks like a failure.

**Secondary cause (Vite frontend):** `assetIdHex` parameter name doesn't match relayer's expected `assetId`, causing 400 errors and aggressive user retries.

**Tertiary cause:** `devLog` infinite recursion in dev mode crashes the UI mid-flow, leaving state inconsistent.

---

## Phase 1: CRITICAL On-Chain Security (Must Redeploy)

### 1.1 Duplicate Commitment Double-Spend (THEFT)
- **File:** `chains/solana/programs/white-protocol/src/instructions/deposit_masp.rs`
- **Bug:** No check if commitment already exists in `pending_buffer` or Merkle tree.
- **Exploit:** Same commitment + different leaf_index = different nullifier hash = multiple withdrawals per deposit.
- **Fix:** Reject duplicate commitments in `deposit_masp`.

### 1.2 `settle_deposits_batch` Corrupts Tree State
- **File:** `chains/solana/programs/white-protocol/src/instructions/settle_deposits_batch.rs`
- **Bug:** Updates `current_root` and `next_leaf_index` but **never updates `filled_subtrees`, `total_leaves`, `last_insertion_at`**.
- **Impact:** Future `batch_process_deposits` and `get_merkle_path` produce wrong values.
- **Fix:** Update all tree fields consistently, or deprecate on-chain insertion entirely.

### 1.3 `get_merkle_path` Returns Zero for Right Siblings
- **File:** `chains/solana/programs/white-protocol/src/state/merkle_tree.rs:382-391`
- **Bug:** For left-child leaves with an existing right sibling, returns zero hash instead of actual sibling.
- **Impact:** ~50% of leaves have invalid Merkle proofs; withdrawals impossible.
- **Fix:** Maintain `right_subtrees` or recompute actual siblings.

---

## Phase 2: CRITICAL Client Fixes (Unblock Deposits Immediately)

### 2.1 Catch "Already Processed" as Success
- Wrap all `sendRawTransaction` / `sendTransaction` calls in a helper that detects the string and treats it as landed.
- Pass `{ skipPreflight: true, maxRetries: 0 }` on retry attempts.
- Add `"already been processed"` to relayer `nonRetryablePatterns`.

### 2.2 Debounce Deposit Buttons
- Use `useRef` synchronous guard (not React state) to prevent double-invocation.

### 2.3 Fix `assetIdHex` → `assetId` Mismatch
- Change frontend parameter key to match relayer expectation.

### 2.4 Fix `devLog` Infinite Recursion
- Change recursive self-call to `console.log(...args)`.

### 2.5 Fix Relayer `build-deposit-tx`
- Remove premature Merkle tree insertion (corrupts tree before confirmation).
- Add `requireAuth` middleware.

### 2.6 Fix Relayer Stale ATA Cache
- Use fresh RPC or `createAssociatedTokenAccountIdempotentInstruction`.

---

## Phase 3: HIGH Priority Fixes

### 3.1 Deposit amount limits not enforced (`validate_deposit_amount` never called)
### 3.2 `FEATURE_MASP` flag ignored
### 3.3 `batch_process_deposits` timing guard is no-op (`should_batch` inside `is_full` check)
### 3.4 `clear_pending` missing PDA seed validation
### 3.5 `compute_commitments_hash` incomplete modular reduction (`>= 2P` not handled)
### 3.6 Relayer `syncMerkleTree` cannot backfill on fresh start
### 3.7 Relayer state store non-atomic (direct `writeFileSync`, no temp+rename)
### 3.8 Frontend discards relayer-provided blockhash

---

## Phase 4: MEDIUM Priority Fixes

### 4.1 `total_deposits` double-counted (counted at deposit + again at settlement)
### 4.2 `clear_processed` can panic if `total_pending > deposits.len()`
### 4.3 `_encrypted_note` parameter accepted but completely unused
### 4.4 Two conflicting `ProofType` enums
### 4.5 Fake pairing stub (`groth16_verifier.rs`, `curve_utils.rs`) still compiles
### 4.6 `DepositMaspEvent` no longer emitted (indexers miss deposits)
### 4.7 App shield page interval leak (no cleanup on unmount)
### 4.8 `addNote` allows duplicate notes in localStorage
### 4.9 wSOL wrapping precision loss (`bigint` → `Number` cast)
### 4.10 Use idempotent ATA creation everywhere
### 4.11 Relayer `withTimeout` leaks timers
### 4.12 Relayer `hexToBytes` silently corrupts `0x`-prefixed input
### 4.13 Relayer `supportedAssets` case-sensitive lookup bug
### 4.14 Base adapter hardcoded to `baseSepolia`
### 4.15 Base sequencer loop is no-op (`getPendingCount()` returns 0)

---

## Phase 5: Settlement & Proof Verification

### 5.1 Batch settlement proof mismatch (cryptographic mismatch between circuit and on-chain)
### 5.2 `MerkleBatchUpdate` trusted setup incomplete (`zkey` is partial)
### 5.3 `batch_process_deposits` exceeds 1.4M CU limit (Poseidon too expensive on-chain)

---

## Phase 6: Cleanup

### 6.1 Remove backup files from repo (.bak, .backup-*)
### 6.2 Remove scratch file `github-relayer-api-extensions.ts` (wrong PDA seeds)
