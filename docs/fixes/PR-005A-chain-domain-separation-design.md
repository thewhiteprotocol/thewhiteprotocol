# PR-005A — Chain/Domain Separation Audit and Implementation Design

**Status:** Design Complete (read-only audit)  
**Date:** 2026-05-01  
**Auditor:** Kimi Code CLI  
**Scope:** Circuits, EVM contracts, Solana program, SDK/core, relayer, app, bridge  
**Constraint:** No code changes in this PR. No redeployments. No circuit changes yet.

---

## 1. Summary

PR-004 fixed the EVM asset ID field-prime bug and unified the cross-chain asset ID formula to:

```
assetId = 0x00 || keccak256("white:asset_id:v1" || tokenAddress)[0..31]
```

This formula is **field-safe** and **deterministic**, but it is **not chain-bound**. The same token address on two different EVM chains (e.g., `address(0)` for native ETH on Base Sepolia and Ethereum Sepolia) produces the **identical** asset ID. Combined with the fact that **no circuit or on-chain verifier includes a chain/domain identifier**, this creates a cross-chain proof replay surface.

This document audits the exact replay surface, evaluates four implementation options, and recommends a **hybrid phased approach (Option D)** that:
- Does **not** break existing Solana devnet or Base Sepolia deployments.
- Does **not** require circuit changes in the immediate term.
- Introduces **protocol-scoped domain IDs** and a **v2 asset ID formula** for all new deployments.
- Plans **explicit `domain_id` circuit public inputs** for a future v2 circuit generation (mainnet).
- Preserves **legitimate cross-chain private transfer** via the bridge by ensuring destination-chain notes are bound to the destination domain.

---

## 2. Current Replay/Domain Risk

### 2.1 Threat Model: When Can a Proof Be Replayed?

A Groth16 proof is valid for any verifier that checks the same public inputs. Currently, the circuits do not bind to a specific chain, domain, or pool. The on-chain programs check asset vault membership and Merkle root history, but they do not check domain binding.

| Replay Vector | Exploit Condition | Severity | Likelihood Today |
|---------------|-------------------|----------|------------------|
| **Same asset ID + same Merkle root on two chains** | Attacker mirrors pool state (same root, same asset ID) on a second chain and replays a withdraw proof. | **High** | Low (requires active attack) |
| **Native token `address(0)` collision** | `address(0)` on Base Sepolia and any other EVM chain produce identical asset ID. If both chains register ETH, proofs collide. | **High** | Medium (all EVM chains use `address(0)`) |
| **CREATE2 token address collision** | Token deployed via CREATE2 at same address on two chains gets same asset ID. | **Medium** | Low (requires specific token) |
| **Copied Merkle tree state** | Attacker initializes a pool with the same root as a legitimate pool on another chain. | **Medium** | Low (requires pool authority compromise or malicious deployment) |
| **Bridge misrouting** | A bridge message intended for chain A is processed on chain B. `bridgeMint` inserts the commitment directly into the tree without pending buffer checks. | **High** | Low (requires bridge operator error or exploit) |
| **Relayer cross-chain submission** | A relayer with endpoints on multiple chains submits a proof to the wrong chain. | **Medium** | Low (requires relayer bug) |
| **Nullifier cross-chain spend** | Nullifier spent on chain A does not prevent spend on chain B. By design for bridge flows, but for non-bridge flows this is replay. | **Low** | Low (nullifier maps are per-chain) |

### 2.2 Why This Matters for the White Protocol

The protocol is explicitly multi-chain. The README states:
> "The protocol is live on Solana Devnet and Base Sepolia, sharing the same Circom circuits, Poseidon Merkle tree, and Groth16 proof system across both chains."

Sharing the **same circuits** across chains is a feature for auditability and trust-minimization, but it becomes a bug when proofs are not domain-bound. A user who generates a withdraw proof on Base Sepolia should not have to trust that no one has created a pool with the same root and asset ID on Solana Devnet (or vice versa).

### 2.3 Defense-in-Depth Assessment

| Layer | Current Binding | Gap |
|-------|----------------|-----|
| Circuit | None | No chain/domain public input |
| Asset ID | Token address only | Collides across chains for same token address |
| Commitment | `Poseidon(secret, nullifier, amount, asset_id)` | No domain in note derivation |
| Nullifier | `Poseidon(Poseidon(nullifier, secret), leaf_index)` | No domain in nullifier derivation |
| On-chain EVM | `AssetRegistry.getAssetId(token)` | Returns same value for same token on different chains |
| On-chain Solana | `compute_asset_id(mint)` | Returns same value for same mint on different clusters |
| Bridge | `BridgeAssetRegistry` uses canonical IDs | Bridge messages do not carry domain binding for the proof layer |

---

## 3. Current Asset ID Matrix

| Component | Formula | Chain-bound? | Field-safe? | Evidence |
|-----------|---------|-------------|-------------|----------|
| **EVM Solidity** | `bytes32(uint256(keccak256("white:asset_id:v1" \|\| token)) >> 8)` | ❌ No | ✅ Yes | `AssetRegistry.sol:118-125` |
| **packages/core TS** | `0x00 \|\| keccak256("white:asset_id:v1" \|\| mint)[0..31]` | ❌ No | ✅ Yes | `packages/core/src/crypto.ts:55-62` |
| **EVM E2E** | Same as core TS (`computeAssetIdBigInt`) | ❌ No | ✅ Yes | `chains/evm/test/e2e-base-full.ts:11,68-74` |
| **Solana program** | `0x00 \|\| keccak256("white:asset_id:v1" \|\| mint)[0..31]` | ❌ No | ✅ Yes | `asset_vault.rs:297-309` |
| **Solana SDK** | `0x00 \|\| keccak256("white:asset_id:v1" \|\| mint)[0..31]` | ❌ No | ✅ Yes | `sdk/src/crypto/keccak.ts:49` |
| **Relayer** | Delegates to core `computeAssetId` | ❌ No | ✅ Yes | `relayer/src/api-extensions.ts` (imports core) |
| **app/frontend** | `app/src/lib/crypto.ts` (near-duplicate of core) | ❌ No | ✅ Yes | `app/src/lib/crypto.ts:34-62` |

**Key finding:** PR-004 successfully unified the formula across all components, but the unified formula still lacks chain/domain separation.

---

## 4. Current Circuit Public Input Matrix

| Circuit | # Public Inputs | Public Input List | Includes `asset_id`? | Includes `chain/domain`? | Verifier Change Needed? |
|---------|----------------|-------------------|----------------------|--------------------------|------------------------|
| **deposit** | 3 | `commitment`, `amount`, `asset_id` | ✅ Yes | ❌ No | No (if `asset_id` stays single field) |
| **withdraw** | 8 | `merkle_root`, `nullifier_hash`, `asset_id`, `recipient`, `amount`, `relayer`, `relayer_fee`, `public_data_hash` | ✅ Yes | ❌ No | Yes (to add `domain_id`) |
| **withdraw_v2** | 12 | `schema_version`, `merkle_root`, `asset_id`, `nullifier_hash_0`, `nullifier_hash_1`, `change_commitment`, `recipient`, `amount`, `relayer`, `relayer_fee`, `public_data_hash`, `reserved_0` | ✅ Yes | ❌ No | Yes (to add `domain_id`) |
| **joinsplit** | 10 (for 2-in/2-out) | `merkle_root`, `asset_id`, `input_nullifiers[2]`, `output_commitments[2]`, `public_amount`, `relayer`, `relayer_fee` | ✅ Yes | ❌ No | Yes (to add `domain_id`) |
| **membership** | 4 | `merkle_root`, `commitment_hash`, `threshold`, `asset_id` | ✅ Yes | ❌ No | Yes (to add `domain_id`) |
| **merkle_batch_update** | 5 | `oldRoot`, `newRoot`, `startIndex`, `batchSize`, `commitmentsHash` | ❌ No | ❌ No | Yes (to add `domain_id`) |
| **batch_append** | 11 (for batchSize=8) | `oldRoot`, `newRoot`, `startIndex`, `commitments[8]` | ❌ No | ❌ No | Yes (to add `domain_id`) |

**Observation:** `asset_id` is present in all spending-related circuits (deposit, withdraw, withdraw_v2, joinsplit, membership) but absent in tree-update circuits (merkle_batch_update, batch_append). Adding `domain_id` to the spending circuits is the highest-value change because those are the ones that protect user funds.

---

## 5. Current Note Format Analysis

### 5.1 Note Structure (packages/core)

```typescript
interface Note {
  secret: bigint;
  nullifier: bigint;
  amount: bigint;
  assetId: bigint;
  commitment: bigint;
  leafIndex?: number;
}
```

### 5.2 Note Structure (app/frontend)

```typescript
interface DecodedNote {
  secret: string;
  nullifier: string;
  amount: string;
  asset: string;
  chain: string;        // ← present in UI layer only
  leafIndex?: number;
  commitment?: string;
  assetId?: string;
}
```

### 5.3 Note Structure (Solana SDK)

```typescript
interface Note {
  secret: bigint;
  nullifier: bigint;
  amount: bigint;
  assetId: bigint;
  commitment: bigint;
  leafIndex?: number;
  merkleRoot?: bigint;
  depositTimestamp?: number;
  depositSignature?: string;
}
```

### 5.4 Analysis

| Property | Included? | Used in commitment? | Used in nullifier? |
|----------|-----------|---------------------|-------------------|
| Chain ID / Domain ID | ❌ No (except UI `chain` string) | ❌ No | ❌ No |
| Asset ID | ✅ Yes | ✅ Yes | ❌ No (asset_id is in commitment, not nullifier) |
| Token/Mint address | ❌ No (only assetId hash) | ❌ No | ❌ No |
| Protocol version | ❌ No | ❌ No | ❌ No |
| Commitment derivation version | ❌ No | ❌ No | ❌ No |

### 5.5 Versioning Feasibility

- **Can existing notes be versioned?** Yes, but only at the serialization layer. The `Note` interfaces can be extended with an optional `version?: number` field. However, the **circuit constraint** is what matters: the circuit hardcodes the commitment formula as `Poseidon(secret, nullifier, amount, asset_id)`. Adding a new field to the note that is not in the circuit does not improve security.
- **Would adding domain separation break old notes?** It depends on the mechanism:
  - If we change `asset_id` derivation (Option A), old notes break because their stored `assetId` no longer matches the on-chain vault.
  - If we add `domain_id` to circuits (Option B/C), old notes break because the circuit expects a new public input that old proofs do not provide.
  - If we keep old pools/assets unchanged and only apply domain separation to **new** pools (Option D), old notes remain valid.

---

## 6. Option A Analysis: Asset ID Domain Separation Only

### 6.1 Proposed Formula

```
assetId = 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]
```

Where `domainId` is a **protocol-scoped** identifier (not a native chain ID), assigned by The White Protocol governance/registry.

### 6.2 Pros

- **No circuit changes required.** `asset_id` remains a single 32-byte public input. Existing circuits continue to work.
- **No verifier regeneration or redeployment** for the current circuit set.
- **No Solana VK upload** required.
- **Single field element** — no change to public input count or ordering.
- **Native token collision fixed:** `address(0)` on Base (domain 2) and Ethereum (domain 3) now produce different asset IDs.
- **Easy to implement** in Solidity, Rust, and TypeScript.

### 6.3 Cons

- **Old notes break** if existing asset IDs are migrated to the new formula. The commitment in the note was computed with `assetId_v1`, but the on-chain vault now expects `assetId_v2`.
- **Does not bind the proof itself to the domain.** The proof only binds to `asset_id`. If an attacker registers the same token with the same `assetId_v2` on two chains (e.g., by using the same domain ID), replay is still possible.
- **Does not protect Merkle tree update proofs.** `merkle_batch_update` and `batch_append` have no `asset_id` public input, so they remain completely unbound.
- **Relies on AssetRegistry correctness.** If a malicious or buggy AssetRegistry assigns the wrong domain ID, the binding fails.
- **Bridge complexity:** BridgeAssetRegistry currently maps `local → canonical`. If canonical IDs are now domain-bound, the bridge must handle domain translation.

### 6.4 EVM Impact

- `AssetRegistry._computeAssetId()` must accept or reference a `domainId`.
- `WhiteProtocol` constructor or `AssetRegistry` must store the pool's domain ID.
- Existing Base Sepolia deployment **cannot be updated** without breaking existing notes. A new deployment would be required.
- Forge tests must cover both v1 and v2 asset ID formulas.

### 6.5 Solana Impact

- `compute_asset_id()` in `asset_vault.rs` must accept a `domain_id` parameter.
- `PoolConfig` should store the pool's domain ID (could reuse `_reserved` bytes or add a field).
- Existing Solana devnet pool **cannot be updated** without breaking existing wSOL deposits.

### 6.6 Note/Deposit Impact

- Existing notes with `assetId_v1` become invalid for withdrawal if the on-chain asset vault switches to `assetId_v2`.
- To avoid breakage, old pools must remain on v1 asset IDs. Only **new** pools can use v2.

---

## 7. Option B Analysis: Explicit `domain_id` Public Input

### 7.1 Proposed Change

Add `domain_id` as an additional public input to all spending circuits:

```
deposit public inputs:    commitment, amount, asset_id, domain_id
withdraw public inputs:   root, nullifier_hash, asset_id, recipient, amount, relayer, relayer_fee, public_data_hash, domain_id
withdraw_v2 public inputs: schema_version, merkle_root, asset_id, nullifier_hash_0, nullifier_hash_1, change_commitment, recipient, amount, relayer, relayer_fee, public_data_hash, reserved_0, domain_id
joinsplit public inputs:  merkle_root, asset_id, input_nullifiers, output_commitments, public_amount, relayer, relayer_fee, domain_id
membership public inputs: merkle_root, commitment_hash, threshold, asset_id, domain_id
```

### 7.2 Pros

- **Strongest explicit proof binding.** The proof is cryptographically tied to a specific domain. Even if an attacker copies the Merkle tree and asset registry, the proof cannot verify because `domain_id` is enforced by the Groth16 verifier.
- **Does not require changing asset ID derivation.** Existing asset IDs can remain as-is; the domain binding is orthogonal.
- **Protects against all replay vectors** that involve spending proofs.

### 7.3 Cons

- **Requires circuit changes** for deposit, withdraw, withdraw_v2, joinsplit, and membership.
- **Requires new trusted setup / contribution** for all modified circuits (or at minimum new zkey generation if the ptau is sufficient).
- **Requires new verifier contracts on EVM:** DepositVerifier, WithdrawVerifier, and future verifiers for withdraw_v2/joinsplit/membership.
- **Requires new VK upload on Solana:** The `VerificationKeyAccount` PDAs must be re-initialized with the new VKs.
- **Requires SDK updates:** `ProofGenerator` must include `domain_id` in all witness generation.
- **Requires on-chain program updates:**
  - EVM: `WhiteProtocol.sol` must pass `domain_id` to verifier public inputs.
  - Solana: `public_inputs.rs` must include `domain_id` in `to_field_elements()`.
- **Breaks all existing notes/deposits** on current deployments unless old verifiers are kept alongside new ones.

### 7.4 EVM Impact

- Full redeployment of `WhiteProtocol`, `DepositVerifier`, `WithdrawVerifier`.
- All E2E scripts must generate proofs with `domain_id`.
- Existing Base Sepolia deployment is incompatible with new proofs.

### 7.5 Solana Impact

- New VK accounts must be uploaded and locked for Deposit, Withdraw, WithdrawV2, JoinSplit, Membership.
- `public_inputs.rs` must be updated for all proof types.
- Existing devnet pool cannot verify old proofs after VK swap (unless dual-VK support is added).

### 7.6 Migration Impact

- All existing user notes become invalid unless the old verifiers remain operational.
- Dual-verifier support (v1 and v2 circuits) is possible but complex: the on-chain program would need to route to the correct VK based on note version.

---

## 8. Option C Analysis: Domain in Note Commitment/Nullifier

### 8.1 Proposed Change

Modify the commitment and nullifier derivation to include domain:

```
commitment = Poseidon(secret, nullifier, amount, asset_id, domain_id)
nullifier_hash = Poseidon(Poseidon(nullifier, secret, domain_id), leaf_index)
```

### 8.2 Pros

- **Strongest note-level binding.** The private note itself is tied to the domain. Even if the note is leaked, it cannot be used on another chain.
- **No additional public inputs** if `domain_id` is absorbed into existing public inputs (commitment/nullifier_hash).

### 8.3 Cons

- **Requires circuit changes** for ALL circuits that use commitments or nullifiers (deposit, withdraw, withdraw_v2, joinsplit, membership).
- **Changes the fundamental note format.** Every Note interface must include `domain_id`.
- **Breaks ALL existing notes unconditionally.** Old commitments were computed without `domain_id`; they can never be verified by new circuits.
- **Requires the same verifier/VK redeployment burden as Option B.**
- **Cannot coexist with old notes.** There is no way to support v1 and v2 notes in the same Merkle tree because the leaf values (commitments) are computed differently.

### 8.4 Migration Impact

- **Total breakage.** Every user must withdraw from old pools (using old circuits) and redeposit into new pools.
- Effectively requires a **protocol migration event**.

---

## 9. Option D Analysis: Hybrid Phased Approach

### 9.1 Concept

- **Phase 1 (Immediate):** Keep current v1 circuits unchanged. Introduce **protocol-scoped domain IDs** and a **v2 asset ID formula** for all **new** pool deployments. Existing testnet pools (Base Sepolia, Solana Devnet) remain on v1 asset IDs.
- **Phase 2 (Mainnet preparation):** Design and build **v2 circuits** with explicit `domain_id` public inputs. Regenerate verifiers, perform trusted setup, and deploy mainnet pools with v2 circuits from genesis.
- **Phase 3 (Future):** Consider v3 circuits with domain-absorbed commitments/nullifiers if stronger note-level binding is required.

### 9.2 Why This Is the Safest Path

1. **Preserves existing deployments.** Base Sepolia (fully E2E verified) and Solana Devnet (deposit working) are not touched.
2. **Avoids immediate circuit changes.** No trusted setup re-run, no verifier regeneration, no VK upload, no proof-generation code changes.
3. **Fixes the collision for new deployments.** Any new pool (whether on a new chain or a fresh redeployment) uses domain-bound asset IDs, eliminating native-token collisions.
4. **Allows testnet → mainnet graduation.** Testnets stay on v1; mainnet launches on v2 with full circuit-level domain binding.
5. **Bridge-compatible.** Bridge messages carry canonical asset info; destination-chain `bridgeMint` uses the destination domain's local asset ID for the new commitment.
6. **Audit-friendly.** auditors can see a clear separation between "legacy testnet" and "production-ready mainnet" security models.

### 9.3 Protocol-Scoped Domain ID Design

Native chain IDs are insufficient:
- EVM has `block.chainid` (uint256), but Solana does not have a native chain ID concept.
- Using EVM chain IDs on Solana would require arbitrary mapping.

**Recommended design:**

```
Domain ID = uint32
  High byte (bits 31-24): Chain family
    0x01 = Solana
    0x02 = EVM
    0x03 = Move (future)
    0xFF = Reserved
  Low 3 bytes (bits 23-0): Network identifier (protocol-assigned)

Examples:
  0x01000001 = Solana Mainnet
  0x01000002 = Solana Devnet
  0x02000001 = Base Mainnet
  0x02000002 = Base Sepolia
  0x02000003 = Ethereum Mainnet
  0x02000004 = Ethereum Sepolia
```

This is **deterministic**, **human-readable**, and **fits in a single BN254 field element** (uint32 << 224 is well below the prime).

### 9.4 v2 Asset ID Formula (Phase 1)

```solidity
// Solidity
function _computeAssetId(address token, uint32 domainId) internal pure returns (bytes32) {
    bytes memory prefix = bytes("white:asset_id:v2");
    bytes memory input = abi.encodePacked(prefix, domainId, token);
    bytes32 hash = keccak256(input);
    return bytes32(uint256(hash) >> 8);
}
```

```rust
// Rust (Solana)
pub fn compute_asset_id(mint: &Pubkey, domain_id: u32) -> [u8; 32] {
    let h = crate::crypto::keccak::keccak256_concat(&[
        b"white:asset_id:v2",
        &domain_id.to_be_bytes(),
        mint.as_ref(),
    ]);
    let mut out = [0u8; 32];
    out[1..32].copy_from_slice(&h[0..31]);
    out
}
```

```typescript
// TypeScript
type DomainId = number;
export function computeAssetId(tokenAddress: string | Uint8Array, domainId: DomainId): Uint8Array {
  // ... same pattern with domainId prepended ...
}
```

**Field safety:** The output still has MSB = `0x00`, guaranteeing `< 2^248 < r`.

### 9.5 On-Chain Domain ID Storage (Phase 1)

**EVM:**
- Add `uint32 public domainId` to `WhiteProtocol` (immutable, set in constructor).
- `AssetRegistry` stores per-asset asset IDs; the domain is implicit in the pool contract.
- When `addAsset()` is called, it uses `_computeAssetId(token, domainId)`.

**Solana:**
- Add `domain_id: u32` to `PoolConfig` (can use 4 bytes from `_reserved: [u8; 30]` without breaking account layout).
- `register_asset` instruction passes `domain_id` to `compute_asset_id()`.

### 9.6 Phase 2: v2 Circuits with Explicit `domain_id`

When mainnet circuits are built:

1. Add `domain_id` as a public input to deposit, withdraw, withdraw_v2, joinsplit, membership.
2. Add `domain_id` as a private input to the commitment/nullifier computation (optional — can be public-only first).
3. Regenerate `.wasm`, `.r1cs`, `.zkey`, and verification keys.
4. Run a dedicated trusted setup ceremony for mainnet.
5. Deploy new EVM verifier contracts.
6. Upload new VK accounts to Solana mainnet.
7. Update all SDK proof generation to include `domain_id`.

### 9.7 Phase 3: Bridge Impact

The bridge design must be domain-aware:

**BridgeAssetRegistry:**
- Maps `localAssetAddress → canonicalAssetId`.
- The `canonicalAssetId` should be **domain-agnostic** (it represents the asset concept, e.g., "USDC").
- Bridge messages carry: `(sourceDomain, destinationDomain, canonicalAssetId, amount, newCommitment)`.

**bridgeWithdraw (source chain):**
- Uses the source chain's local asset ID (domain-bound) in the withdraw proof.
- After proof verification, marks nullifier spent and increments `bridgeOutgoing`.

**bridgeMint (destination chain):**
- Looks up the destination chain's local asset ID from `canonicalAssetId`.
- Directly inserts a new commitment into the Merkle tree.
- The new commitment is computed with the **destination domain's** local asset ID.
- This means the bridged note is bound to the destination domain from birth.

**Stealth addresses:**
- Meta-addresses are already cross-chain (universal tag `0x03`).
- Stealth derivation is off-chain and does not involve asset IDs.
- A stealth withdrawal on the destination chain uses the destination domain's asset ID in the proof.

---

## 10. Recommended Option

**Option D (Hybrid Phased Approach)** is recommended.

### 10.1 Why Option D Over A, B, or C

| Criterion | Option A | Option B | Option C | Option D |
|-----------|----------|----------|----------|----------|
| **Security strength** | Medium (registry-dependent) | High (proof-level) | Very High (note-level) | High (phased to Very High) |
| **Implementation complexity** | Low | High | Very High | Low → High |
| **Circuit changes needed now** | No | Yes (all spending) | Yes (all) | No (Phase 1) |
| **Verifier redeploy needed now** | No | Yes | Yes | No (Phase 1) |
| **Solana VK upload needed now** | No | Yes | Yes | No (Phase 1) |
| **Breaks existing Base Sepolia** | Yes (if migrated) | Yes | Yes | No |
| **Breaks existing Solana Devnet** | Yes (if migrated) | Yes | Yes | No |
| **Compatible with future bridge** | Moderate | Yes | Yes | Yes |
| **Migration cost** | Medium | High | Very High | Low |
| **Testability** | High | Medium | Low | High |

Option D gives us **immediate deployability** (Phase 1 can ship today without circuits) while preserving a **clear roadmap** to cryptographic domain binding (Phase 2) without breaking the testnet deployments that PR-004 just stabilized.

---

## 11. Why This Option Is Recommended

1. **Testnet stability is critical.** PR-004 just achieved the first full Base Sepolia E2E. Breaking that for a theoretical replay risk (that requires an active attacker to mirror pool state) is poor risk management.
2. **Mainnet is the real target.** The protocol has no mainnet deployments. Mainnet will require a fresh deployment, fresh circuits, fresh trusted setup, and fresh audits. That is the correct time to introduce circuit-level domain binding.
3. **Asset ID domain separation is sufficient for Phase 1.** For new pools, domain-bound asset IDs eliminate the trivial `address(0)` collision and CREATE2 collision risks. The remaining replay surface (malicious pool state mirroring) is an active attack that requires pool authority, which is a higher bar.
4. **Bridge design is cleaner.** By making destination-chain notes use destination-domain asset IDs, cross-chain transfers are naturally domain-bound without requiring v2 circuits on the bridge path.
5. **User experience.** Users on testnets do not need to regenerate notes or understand versioning. Mainnet users will get the stronger security model from day one.

---

## 12. Implementation Plan for Next PR (PR-005B)

### 12.1 Scope

Implement **Phase 1** of Option D: protocol-scoped domain IDs + v2 asset ID formula for new deployments.

### 12.2 Exact Changes

#### A. Define Domain ID Registry

Create `packages/core/src/domains.ts`:

```typescript
export enum ProtocolDomain {
  SolanaMainnet = 0x01000001,
  SolanaDevnet = 0x01000002,
  BaseMainnet = 0x02000001,
  BaseSepolia = 0x02000002,
  EthereumMainnet = 0x02000003,
  EthereumSepolia = 0x02000004,
  // ... etc
}

export function isValidDomainId(id: number): boolean {
  return id > 0 && id <= 0xFFFFFFFF;
}
```

#### B. Update Asset ID Computation (packages/core)

- `computeAssetId(token, domainId)` — new signature, requires `domainId`.
- `computeAssetIdV1(token)` — preserve old formula for backwards compatibility.
- Update all consumers in `app/`, `relayer/`, and E2E scripts to pass `domainId`.

#### C. Update EVM Contracts

**AssetRegistry.sol:**
- Add `uint32 public domainId` (immutable, set in constructor).
- Update `_computeAssetId(address token)` → `_computeAssetId(address token, uint32 domainId)`.
- Update `addAsset()` to use `domainId`.

**WhiteProtocol.sol:**
- Add `uint32 public domainId` (immutable, set in constructor).
- Pass `domainId` to `AssetRegistry` on construction.

**Deploy.s.sol:**
- Read `domainId` from `networks.json` config.
- Pass `domainId` to `WhiteProtocol` and `AssetRegistry` constructors.

#### D. Update Solana Program

**asset_vault.rs:**
- Update `compute_asset_id(mint: &Pubkey)` → `compute_asset_id(mint: &Pubkey, domain_id: u32)`.

**pool_config.rs:**
- Add `domain_id: u32` to `PoolConfig` (use 4 bytes from `_reserved` to avoid account migration).
- Add getter/setter.

**register_asset.rs:**
- Pass `pool_config.domain_id` to `compute_asset_id()`.

#### E. Update App / Frontend

- `app/src/lib/crypto.ts`: update `computeAssetId` to match core.
- `app/src/config/chains.ts`: map each chain config to its `ProtocolDomain` ID.
- Update all call sites that generate commitments/proofs to include `domainId`.

#### F. Update Relayer

- `relayer/src/config.ts`: add `domainId` to per-chain config.
- `relayer/src/api-extensions.ts`: pass `domainId` to `computeAssetId`.

#### G. Update E2E Scripts

- `chains/evm/test/e2e-base-full.ts`: pass `ProtocolDomain.BaseSepolia` to `computeAssetIdBigInt`.
- `chains/evm/test/e2e-base.ts`: same.
- `chains/solana/sdk/`: update `createNote` to accept `domainId`.

### 12.3 What Is NOT in Scope for PR-005B

- ❌ No circuit changes.
- ❌ No verifier regeneration.
- ❌ No Solana VK upload.
- ❌ No EVM contract redeployment to existing addresses.
- ❌ No modification of existing Base Sepolia or Solana Devnet pool state.
- ❌ No bridge contract changes (bridge analysis only).

---

## 13. Migration Impact

### 13.1 Existing Testnet Pools

| Pool | Domain ID Today | Action | Impact |
|------|----------------|--------|--------|
| Base Sepolia | None (v1 asset IDs) | **Leave as-is** | None. Existing ETH/WETH deposits remain valid. |
| Solana Devnet | None (v1 asset IDs) | **Leave as-is** | None. Existing wSOL deposits remain valid. |

### 13.2 New Testnet Pools

Any new pool deployment (e.g., Base Sepolia v2, Solana Devnet v2, Ethereum Sepolia, BSC Testnet) will:
- Use `ProtocolDomain` ID in pool config.
- Use v2 asset ID formula.
- Be incompatible with v1 notes, but only because it is a **new pool**.

### 13.3 Mainnet Migration (Future)

When mainnet launches:
- All mainnet pools use v2 circuits with explicit `domain_id` public inputs.
- All mainnet asset IDs use v2 formula.
- Testnet users must withdraw testnet funds and deposit into mainnet pools.
- This is standard practice for testnet → mainnet migration.

### 13.4 Note Store Migration

- `SerializedNote` can add an optional `version?: number` field for UI clarity.
- `NoteStore.deserialize()` should default to version 1 if absent.
- No cryptographic migration is needed because v1 notes continue to work on v1 pools.

---

## 14. EVM Impact

### 14.1 Files Changed

| File | Change |
|------|--------|
| `chains/evm/contracts/AssetRegistry.sol` | Add `domainId`; update `_computeAssetId`; update `addAsset` |
| `chains/evm/contracts/WhiteProtocol.sol` | Add `domainId`; pass to `AssetRegistry` |
| `chains/evm/contracts/IVerifiers.sol` | No change (Phase 1) |
| `chains/evm/script/Deploy.s.sol` | Read `domainId` from config; pass to constructors |
| `chains/evm/configs/networks.json` | Add `domainId` to each network entry |
| `chains/evm/test/AssetRegistry.t.sol` | Add v2 formula tests |
| `chains/evm/test/WhiteProtocol.t.sol` | No change (mock verifiers don't check asset ID) |
| `chains/evm/test/e2e-base-full.ts` | Pass `domainId` to `computeAssetIdBigInt` |

### 14.2 Redeploy Need

- **Phase 1:** No forced redeploy. Existing Base Sepolia contracts remain operational.
- **Phase 2 (future):** Full redeploy of `WhiteProtocol`, all verifiers, and `AssetRegistry` for mainnet.

### 14.3 Existing Notes/Deposits

- Unaffected. The existing `AssetRegistry` at `0x568aD2F600011E343a4EC53F8C7b9b8eDC6173b4` stores v1 asset IDs. Notes computed with those asset IDs remain valid.

---

## 15. Solana Impact

### 15.1 Files Changed

| File | Change |
|------|--------|
| `chains/solana/programs/white-protocol/src/state/asset_vault.rs` | Update `compute_asset_id` signature |
| `chains/solana/programs/white-protocol/src/state/pool_config.rs` | Add `domain_id: u32` (from reserved bytes) |
| `chains/solana/programs/white-protocol/src/instructions/register_asset.rs` | Pass `domain_id` to `compute_asset_id` |
| `chains/solana/sdk/src/crypto/keccak.ts` | Update `computeAssetId` |
| `chains/solana/sdk/src/note/note.ts` | Update `createNote` to accept `domainId` |

### 15.2 Redeploy/Upgrade Need

- **Phase 1:** No forced program upgrade. Existing devnet program `C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW` remains operational.
- New pool initializations will use the upgraded code if a new program binary is deployed.

### 15.3 Existing Notes/Deposits

- Unaffected. Existing `AssetVault` PDAs store v1 asset IDs. Notes computed with those asset IDs remain valid for withdrawal.

---

## 16. Bridge Impact

### 16.1 Design Principle

Cross-chain private transfers should **not** replay proofs across chains. Instead, they should **burn on source, mint on destination** with a **fresh commitment** bound to the destination domain.

### 16.2 BridgeAssetRegistry

Currently:
```solidity
mapping(address => uint32) public localToCanonical;
```

Recommended addition (Phase 1):
```solidity
mapping(uint32 => uint32) public canonicalToDomain; // canonicalAssetId => sourceDomain (optional)
```

### 16.3 Bridge Message Format

Current `BridgeMessage`:
```solidity
struct BridgeMessage {
    uint32 canonicalAsset;
    uint256 amount;
    bytes32 newCommitment;
    uint64 sourceNonce;
}
```

Recommended addition:
```solidity
struct BridgeMessage {
    uint32 canonicalAsset;
    uint32 sourceDomain;      // ← new
    uint32 destinationDomain; // ← new
    uint256 amount;
    bytes32 newCommitment;
    uint64 sourceNonce;
}
```

### 16.4 bridgeOut (Source Chain)

1. User generates withdraw proof using **source domain's** local asset ID.
2. Contract verifies proof, marks nullifier spent.
3. Contract increments `bridgeOutgoing[asset]`.
4. Message includes `sourceDomain` and `destinationDomain`.

### 16.5 _lzReceive (Destination Chain)

1. Decode `BridgeMessage`.
2. Look up local asset from `canonicalAsset → localAsset`.
3. Verify `destinationDomain == this.domainId`.
4. Call `whiteProtocol.bridgeMint(localAsset, amount, newCommitment)`.
5. The `newCommitment` inserted into the destination Merkle tree is computed off-chain using the **destination domain's** local asset ID.

### 16.6 Does Chain-Specific Asset ID Break Cross-Chain Private Transfer?

**No.** The bridged note is a **new note** on the destination chain. The user (or bridge relayer) computes the destination commitment using:
- A new `secret` and `nullifier` (or derived deterministically from the source note + bridge nonce).
- The destination chain's `assetId` (which is domain-bound).
- The destination chain's `domain_id` (if v2 circuits are in use).

The recipient only needs to know the destination note's parameters. The fact that the asset ID differs from the source is irrelevant because the source note was burned and the destination note is fresh.

### 16.7 Stealth Address + Bridge Interaction

- Stealth meta-addresses are cross-chain by design (`ChainTag.Universal`).
- A user can receive a bridged payment at their stealth address on any chain.
- The destination commitment is computed with the destination domain's asset ID.
- Stealth scanning detects the payment using the destination chain's event logs.

---

## 17. Test Plan

### 17.1 Unit Tests

**EVM (Foundry):**
- `test_AssetIdV2FormulaIsFieldSafe` — verify MSB = 0x00 for all domain IDs.
- `test_AssetIdV2DomainSeparation` — same token, different domains → different asset IDs.
- `test_AssetIdV2DifferentTokensSameDomain` — different tokens, same domain → different asset IDs.
- `test_AssetIdV1Compatibility` — verify v1 formula still produces expected values.

**Solana (Rust unit tests):**
- `test_asset_id_domain_separation` — same mint, different domain IDs → different asset IDs.
- `test_asset_id_field_safe` — all outputs < BN254 prime.

**TypeScript (packages/core):**
- Cross-implementation parity: TS `computeAssetId` matches Solidity and Rust outputs for test vectors.

### 17.2 Integration Tests

- Register a new asset on a v2 pool and verify deposit/withdraw flow (using existing v1 circuits).
- Verify that v1 pools continue to operate normally.

### 17.3 E2E Tests

- Update `e2e-base-full.ts` to use `ProtocolDomain.BaseSepolia` for new deployments.
- Add a test that attempts to register the same token with two different domain IDs and confirms different asset IDs.

---

## 18. Risk Classification

| Risk | Severity | Current State | Proposed Fix (Phase 1) | Proposed Fix (Phase 2) | Follow-up |
|------|----------|---------------|------------------------|------------------------|-----------|
| Cross-chain proof replay via same asset ID + root | **High** | Unmitigated | v2 asset IDs for new pools make collision harder | Explicit `domain_id` in circuits makes replay cryptographically impossible | Audit v2 circuits before mainnet |
| Native token `address(0)` collision across EVM chains | **High** | Unmitigated | v2 asset IDs encode domain, so `address(0)` on Base ≠ `address(0)` on Ethereum | Same as Phase 1 + circuit enforcement | Register all mainnet assets with v2 IDs |
| Bridge misrouting | **Medium** | Partial (bridge caps, LZ validation) | Add `sourceDomain`/`destinationDomain` to bridge message format | Same as Phase 1 + circuit enforcement | Full bridge E2E test |
| CREATE2 token address collision | **Medium** | Unmitigated | v2 asset IDs prevent collision | Same as Phase 1 | Low likelihood |
| Merkle tree update proof replay | **Low** | Unmitigated | Not fixed in Phase 1 (no asset_id in tree proofs) | Add `domain_id` to `merkle_batch_update` circuit | Lower priority than spending proofs |
| Relayer cross-chain submission | **Low** | Unmitigated | v2 asset IDs make accidental submission harder | Explicit `domain_id` prevents it entirely | Relayer config validation |
| Old testnet notes breaking | **Low** | N/A | **Prevented** by leaving old pools on v1 | N/A (mainnet is fresh) | None |

---

## 19. Public Claims Impact

### 19.1 Safe Claims (Unchanged)

- "Base Sepolia testnet contracts are deployed and tested" — ✅ Still true.
- "Solana devnet deposit with real ZK proof works" — ✅ Still true.
- "EVM contracts are chain-agnostic" — ✅ Still true (no hardcoded chain logic).
- "50 Foundry tests pass for EVM contracts" — ✅ Still true.

### 19.2 Updated Claims

- "Shared Circom circuits across Solana and Base" — ✅ True, but add qualifier: *"Testnet deployments use v1 circuits; mainnet will launch with v2 circuits including explicit domain binding."*
- "Cross-chain private transfers via bridge" — ⚠️ Update to: *"Bridge contracts support domain-aware messaging; full E2E bridge testing is pending."*

### 19.3 Unsafe Claims (Must Not Be Made Until Phase 2)

- "Proofs are cryptographically bound to a specific chain" — ❌ False until v2 circuits are deployed.
- "Cross-chain replay is impossible" — ❌ False until v2 circuits are deployed.
- "Mainnet-ready security model" — ❌ False until audit + v2 circuits + dedicated trusted setup.

---

## 20. Remaining Open Questions

1. **Domain ID assignment authority.** Who assigns `ProtocolDomain` values? A registry contract? A governance proposal? A hardcoded enum in `packages/core`?
2. **v2 circuit timeline.** When will v2 circuits be designed, trusted-setup-ceremonied, and audited? This gates mainnet.
3. **Dual-verifier support.** Should the on-chain programs support both v1 and v2 VKs simultaneously (e.g., via `ProofType` enum extension) to ease migration?
4. **Merkle batch update domain binding.** Should `merkle_batch_update` include `domain_id` in Phase 2? It has no `asset_id` input, so the only binding mechanism is a new public input.
5. **Bridge commitment derivation.** Should the bridge specify a deterministic derivation for destination commitments (e.g., `Poseidon(sourceSecret, sourceNullifier, nonce, destinationDomainId)`) so users can recover bridged notes deterministically?
6. **Solana `domain_id` account layout.** Using `_reserved` bytes is safe for devnet, but does it affect future account migrations? Should `PoolConfig` be version-bumped?

---

## 21. Final Recommendation

1. **Adopt Option D (Hybrid Phased Approach).**
2. **Implement Phase 1 in PR-005B:** Introduce protocol-scoped `ProtocolDomain` IDs and a v2 asset ID formula (`white:asset_id:v2` + domainId + token) for all new pool deployments. Do not modify existing Base Sepolia or Solana Devnet pools.
3. **Preserve all v1 circuits, verifiers, and VKs.** No circuit changes in PR-005B.
4. **Design Phase 2 v2 circuits** with explicit `domain_id` public inputs for all spending proofs. Target these for mainnet deployment.
5. **Update bridge message format** to include `sourceDomain` and `destinationDomain`.
6. **Maintain v1 compatibility** in SDK/core via `computeAssetIdV1` alongside `computeAssetIdV2`.

---

*Document version: 1.0*  
*Generated: 2026-05-01*  
*Next step: PR-005B implementation (code changes) based on this design.*
