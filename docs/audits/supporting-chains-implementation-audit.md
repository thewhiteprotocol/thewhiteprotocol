# Supporting Chains Implementation Audit — The White Protocol

**Audit Date:** 2026-04-28  
**Auditor:** Kimi Code CLI (read-only, no modifications)  
**Scope:** All chain-specific code, configs, deployments, tests, relayer, frontend, SDK, CI  
**Exclusions:** Bridge deep-dive (separate audit), marketing copy, generic READMEs

---

## 1. Executive Summary

### Direct Answer

| Category | Chains |
|----------|--------|
| **Production-implemented** | None. No mainnet contracts are deployed. |
| **Testnet-ready** | **Base Sepolia** (EVM) — contracts deployed, 50 Foundry tests pass, E2E script exercised. |
| **Testnet-partial** | **Solana Devnet** — deposit works with real ZK proofs; withdrawal blocked by settlement failure. |
| **Config-only** | Ethereum Sepolia, Polygon Amoy, Polygon zkEVM Cardona, BSC Testnet, Base Mainnet, Ethereum Mainnet, Polygon Mainnet, Polygon zkEVM Mainnet, BSC Mainnet. |
| **Stubbed** | Solana bridge program (`white-bridge-solana`), relayer Solana adapter, `private_transfer`, `prove_membership`, `execute_shielded_action` instructions. |

### What Should Be Removed From Public Claims

- "Multi-chain production protocol" — only Base Sepolia testnet is live.
- "Cross-chain bridge live" — bridge contracts exist but LayerZero CPIs are stubbed on Solana; no E2E bridge test exists.
- "BSC support" — no deployment, no funded wallet, E2E script uses `assetId: BigInt(0)` placeholder (`chains/evm/test/e2e/e2e-bsc-testnet.ts:397`).
- "Polygon / zkEVM support" — config only, zero deployments.
- "Private transfer / JoinSplit" — Solana instructions return `NotImplemented`.

### Source of Truth Today

**Base Sepolia** is the only chain with:
- Deployed contracts (`chains/evm/deployments/base-sepolia.json`)
- Passing tests (`forge test` — 50/50 pass)
- Real E2E execution (`chains/evm/test/e2e/e2e-base.ts`, `e2e-base-full.ts`)
- Working relayer sequencer (`relayer/src/sequencer/evm.ts`)

---

## 2. Chain Support Matrix

| Chain | Code Exists | Contracts/Program | Deployment Config | Deployed Address | Tests | Relayer Support | Frontend Support | SDK/Core Support | Status | Production Ready? |
|-------|:-----------:|:-----------------:|:-----------------:|:----------------:|:-----:|:---------------:|:----------------:|:----------------:|:------:|:-----------------:|
| **Solana Devnet** | ✅ | ✅ White Protocol + Bridge skeleton | ✅ Anchor.toml | ✅ `C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW` | ⚠️ Partial | ⚠️ Stubbed | ✅ `frontend/` + `app/` | ✅ Solana SDK | **PARTIAL** | ❌ No |
| **Base Sepolia** | ✅ | ✅ Full EVM suite | ✅ `networks.json` | ✅ `0xAc0ae70cd63C98d23858a81aa0860213cb4CcBd0` | ✅ 50 Foundry + TS E2E | ✅ Live | ✅ `app/` | ✅ Core SDK | **COMPLETE** | ❌ Testnet only |
| **Ethereum Sepolia** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ⚠️ Config only | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ No |
| **Polygon Amoy** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ⚠️ Config only | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ No |
| **Polygon zkEVM Cardona** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ⚠️ Config only | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ No |
| **BSC Testnet** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ⚠️ E2E script only | ⚠️ Config only | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ No |
| **Base Mainnet** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ❌ Blocked | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ Blocked |
| **Ethereum Mainnet** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ❌ Blocked | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ Blocked |
| **Polygon Mainnet** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ❌ Blocked | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ Blocked |
| **Polygon zkEVM Mainnet** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ❌ Blocked | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ Blocked |
| **BSC Mainnet** | ✅ Generic contracts | ✅ (same as Base) | ✅ `networks.json` | ❌ None | ❌ None | ❌ Blocked | ⚠️ Config only | ✅ Core SDK | **CONFIG_ONLY** | ❌ Blocked |

**Statuses used:**
- **COMPLETE** — Contracts deployed, tests passing, E2E exercised, relayer active.
- **PARTIAL** — Some flows work, others are blocked by known bugs.
- **CONFIG_ONLY** — JSON config exists, no deployment, no tests, no relayer activity.
- **STUBBED** — Code exists but does not perform real operations.
- **MISSING** — No code at all.

---

## 3. Per-Chain Deep Dive

---

### Solana Devnet

#### Implementation Status
The Solana program is **the most feature-complete component in the repo** (35 instructions), but critical paths are blocked by a settlement bug. Deposit works. Withdrawal does not.

**What exists:**
- Full Anchor program with 35 instructions (`chains/solana/programs/white-protocol/src/lib.rs:62-443`)
- Groth16 proof verification using Solana alt_bn128 syscall + arkworks fallback
- Poseidon hashing using Solana Poseidon syscall (~350 CU)
- Multi-asset SPL vaults (`AssetVault`)
- Relayer registry with fee bounds
- Yield registry for LSTs
- Stealth withdrawal support
- Bridge instructions (`bridge_withdraw`, `bridge_mint`)
- Chunked VK upload (3-step init/append/finalize)

**What is stubbed:**
- `private_transfer` — returns `NotImplemented` (`chains/solana/programs/white-protocol/src/instructions/private_transfer.rs:116`)
- `prove_membership` — returns `NotImplemented` (`chains/solana/programs/white-protocol/src/instructions/prove_membership.rs:63`)
- `execute_shielded_action` — all 5 action variants are TODO stubs (`chains/solana/programs/white-protocol/src/instructions/shielded_cpi/execute_action.rs:73-98`)
- `white-bridge-solana` — LZ endpoint CPIs are entirely stubbed (`chains/solana/programs/white-bridge-solana/src/lib.rs:8,196-234`)

**What is blocked:**
- `batch_process_deposits` exceeds 1.4M CU limit (`E2E-TEST-FINAL-RESULTS.md:44-46`)
- `settle_deposits_batch` proof verification mismatch — snarkjs proof verifies locally but fails on-chain with `CryptographyError (6009)` (`E2E-TEST-FINAL-STATUS.md:42-45`)

#### Evidence
- `declare_id!` in source: `DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk` (`chains/solana/programs/white-protocol/src/lib.rs:27`)
- `declare_id!` ≠ Anchor.toml devnet ID (`C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW`). The deployed binary was built with a different ID than what the source currently declares.
- Bridge program uses wSOL mint address as its own program ID: `So11111111111111111111111111111111111111112` (`chains/solana/Anchor.toml:14`, `chains/solana/programs/white-bridge-solana/src/lib.rs:27`)

#### Deposit Flow
- **Status:** ✅ Implemented and working
- **Evidence:** Real devnet transaction `4qNhrsaEvubeL6qxsXpUEoatjMhFWAietrnqzNq7DB8VSQy5LxakWPCUnSHt1qZdqFEWwT4JF8KMhRBTeppvMduZ` consumed 121,369 CU. ZK proof verified on-chain. Commitment queued in pending buffer. (`E2E-TEST-FINAL-RESULTS.md:21-34`)

#### Withdraw Flow
- **Status:** ❌ Blocked
- **Evidence:** Withdraw instruction (`withdraw_masp.rs`) is fully implemented, but it requires a settled Merkle tree. Deposits never leave the pending buffer because settlement fails. (`E2E-TEST-FINAL-RESULTS.md:49-55`)

#### Stealth Withdraw Flow
- **Status:** ⚠️ Implemented but untested
- **Evidence:** `handler_stealth` exists (`withdraw_masp.rs:530-721`) and emits `StealthWithdrawal` event. Never executed in E2E because withdraw is blocked.

#### Asset Registry
- **Status:** ✅ Implemented
- **Evidence:** `register_asset.rs` creates `AssetVault` PDAs. `compute_asset_id` uses `0x00 || keccak256("white:asset_id:v1" || mint)[0..31]` (`asset_vault.rs:297-309`).

#### Verifier Integration
- **Status:** ✅ Implemented for Deposit, Withdraw, MerkleBatchUpdate
- **Evidence:** VKs uploaded and locked on devnet. `verify_proof_from_account` uses alt_bn128 syscall. (`crypto/groth16.rs:295-306`)
- **Risk:** `insecure-dev` feature completely bypasses proof verification (`crypto/groth16.rs:307-319`). Compile-error guard only blocks release builds; debug builds with this feature would be trivially exploitable.

#### Relayer/Sequencer Integration
- **Status:** ⚠️ Stubbed
- **Evidence:** `relayer/src/chains/solana.ts:47-54` — `submitWithdrawal` and `getMerkleRoot` throw `"not yet implemented"`. The relayer has a Solana adapter interface but no working implementation.

#### Frontend/App Integration
- **Status:** ✅ Frontend + App both support Solana Devnet
- **Evidence:** `frontend/` is Solana-only (`frontend/client/src/components/DepositWithdrawUI.tsx`). `app/` supports Solana Devnet with Phantom + Solflare (`app/src/providers/WalletProvider.tsx:35`).

#### Deployment Readiness
- **Deployed:** ✅ Program v8 on devnet (`C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW`)
- **Required env vars:** `ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET` (hardcoded to `~/.config/solana/id.json` in `Anchor.toml:30`)
- **Missing:** Shadow deployment keypairs are placeholders (`ShadowWht1111111111111111111111111111111111`)

#### Test Coverage
- **Rust unit tests:** Poseidon vectors, public input builders, asset ID computation, relayer fee validation, batch size CU budget.
- **TypeScript E2E tests:** 28 test files. Most target live devnet RPC.
- **Working tests:** `e2e-01-deposit.ts` (deposit only)
- **Blocked tests:** `test-02-withdraw.ts`, `test-03-partial-withdraw.ts`, `test-04-rejections.ts`, `test-05-relayer-http.ts`, `test-06-yield.ts`
- **Note:** `run-all-e2e.ts` orchestrates tests 02-06, but all are blocked by settlement.

#### Risks
1. **Settlement proof mismatch** — highest priority blocker. No withdrawal possible.
2. `insecure-dev` feature bypass — could be accidentally deployed.
3. `event-debug` feature leaks recipient + amount in events.
4. Hardcoded devnet program ID in SDK means mainnet users would interact with devnet program by default.
5. Live Helius API keys committed in source (`scripts/parse-historical-buffer.ts:9`, `scripts/register-relayer-e5jr.ts:9`, and 10+ other files).

#### Verdict
**Testnet-ready only** — deposit works, but the protocol is non-functional end-to-end because withdrawals are impossible.

---

### Base Sepolia

#### Implementation Status
The EVM side is the **most production-ready component**. Contracts are chain-agnostic, fully tested, and deployed.

**What exists:**
- `WhiteProtocol.sol` — main privacy pool
- `AssetRegistry.sol` — multi-asset support
- `MerkleTreeWithHistory.sol` — 20-level Poseidon tree
- `DepositVerifier.sol`, `WithdrawVerifier.sol`, `MerkleBatchVerifier.sol` — auto-generated Groth16 verifiers
- `WhiteBridge.sol` — LayerZero OApp with 52-byte compact wire format
- `BridgeAssetRegistry.sol` — cross-chain canonical asset IDs

**What does not exist:**
- Verifier contracts for `withdraw_v2`, `joinsplit`, `membership`, `batch_append`

#### Evidence
- Deployment artifact: `chains/evm/deployments/base-sepolia.json`
- Contracts: `WhiteProtocol: 0xAc0ae70cd63C98d23858a81aa0860213cb4CcBd0`, `AssetRegistry: 0x568aD2F600011E343a4EC53F8C7b9b8eDC6173b4`
- Broadcast logs: `chains/evm/broadcast/Deploy.s.sol/84532/`

#### Deposit Flow
- **Status:** ✅ Implemented
- **Evidence:** `deposit()` in `WhiteProtocol.sol:179-184` accepts proof + commitment + amount + token. Handles native ETH (`address(0)`) and ERC-20 generically.

#### Withdraw Flow
- **Status:** ✅ Implemented
- **Evidence:** `withdraw()` in `WhiteProtocol.sol:257-270` verifies Groth16 proof, checks nullifier not spent, transfers tokens, emits event.

#### Stealth Withdraw Flow
- **Status:** ✅ Implemented
- **Evidence:** `withdrawStealth()` in `WhiteProtocol.sol:333-346` verifies proof with ephemeral pubkey, emits `StealthWithdrawal` event.

#### Asset Registry
- **Status:** ✅ Implemented
- **Evidence:** `AssetRegistry.sol:62` — `assetIds[token] = keccak256(abi.encodePacked(token))`.

#### Verifier Integration
- **Status:** ✅ Implemented for Deposit, Withdraw, MerkleBatchUpdate
- **Evidence:** 3 verifier contracts present. Public input counts match circuits (Deposit: 3, Withdraw: 8, MerkleBatch: 5).
- **Missing:** No verifiers for `withdraw_v2` (12 inputs), `joinsplit`, `membership` (4 inputs), `batch_append`.

#### Relayer/Sequencer Integration
- **Status:** ✅ Live
- **Evidence:** `relayer/src/sequencer/evm.ts` — generic EVM sequencer. `relayer/src/sequencer/multi-chain.ts` maps `84532 → 10000ms` poll interval. Base-specific legacy sequencer also exists (`relayer/src/base-sequencer.ts`).

#### Frontend/App Integration
- **Status:** ✅ Supported in `app/`
- **Evidence:** `app/src/config/chains.ts` defines `BASE_SEPOLIA`. `app/src/providers/WalletProvider.tsx:35` includes `baseSepolia` in Wagmi chains. `app/src/lib/chainService.ts` instantiates `baseChainService`.

#### Deployment Readiness
- **Deployed:** ✅ Base Sepolia
- **Deploy script:** `chains/evm/script/Deploy.s.sol` — reads `configs/networks.json`, deploys all contracts, resolves assets per chain.
- **Mainnet guard:** `ALLOW_MAINNET` env var required for mainnet deployments (`Deploy.s.sol:65-72`).

#### Test Coverage
- **Foundry unit tests:** 50 tests, all passing (local in-memory, no real RPC).
- **TypeScript E2E:** `test/e2e/e2e-base.ts` (deposit + settlement, withdraw skipped), `test/e2e/e2e-base-full.ts` (full flow).
- **Mocks used in unit tests:** `MockDepositVerifier`, `MockWithdrawVerifier`, `MockMerkleBatchVerifier` — these always return `true` and are only used in `test/WhiteProtocol.t.sol` and `test/bridge/WhiteProtocolBridgeHooks.t.sol`.
- **Real verifiers used in:** E2E tests (`e2e-base.ts`, `e2e-base-full.ts`).

#### Risks
1. **Missing verifier contracts** for `withdraw_v2`, `joinsplit`, `membership`. If these features are enabled, there is no on-chain verification.
2. `DeployWithAssets.s.sol` deploys mock verifiers for testing — must never be used for production deployments.
3. No chain ID in ZK public inputs — proofs are not bound to a specific chain.

#### Verdict
**Testnet-ready** — the most complete and tested chain. Not production-ready because it is testnet-only and lacks audit.

---

### Ethereum Sepolia

#### Implementation Status
Config-only. No deployment, no tests, no E2E.

#### Evidence
- `chains/evm/configs/networks.json:16-29` — full config entry exists.
- `isLive: false`
- No deployment artifact in `chains/evm/deployments/`.
- No broadcast logs for chain ID `11155111`.

#### Verdict
**Config-only**

---

### Polygon Amoy

#### Implementation Status
Config-only. No deployment, no tests, no E2E.

#### Evidence
- `chains/evm/configs/networks.json:30-44` — full config entry exists.
- `isLive: false`
- `deployWrappedNativeIfNull: true` — script would deploy `WrappedNative9` if run.

#### Verdict
**Config-only**

---

### Polygon zkEVM Cardona

#### Implementation Status
Config-only. No deployment, no tests, no E2E.

#### Evidence
- `chains/evm/configs/networks.json:45-59` — full config entry exists.
- `isLive: false`

#### Verdict
**Config-only**

---

### BSC Testnet

#### Implementation Status
Config-only with an E2E script that has not been executed.

#### Evidence
- `chains/evm/configs/networks.json:60-73` — full config entry exists.
- `isLive: false`
- E2E script: `chains/evm/test/e2e/e2e-bsc-testnet.ts` exists but uses `assetId: BigInt(0)` as placeholder (line 397).
- No deployment artifact.

#### Verdict
**Config-only** (E2E script is not evidence of working support)

---

### Base Mainnet

#### Implementation Status
Config-only. Blocked by mainnet guard.

#### Evidence
- `chains/evm/configs/networks.json:74-88` — full config entry exists.
- `isLive: false`, `blockedReason: "Awaiting external audit"`
- `Deploy.s.sol:65-72` — requires `ALLOW_MAINNET=true` to deploy.

#### Verdict
**Config-only / Blocked**

---

### Ethereum Mainnet

#### Implementation Status
Config-only. Blocked by mainnet guard.

#### Evidence
- `chains/evm/configs/networks.json:89-103`
- `isLive: false`, `blockedReason: "Awaiting external audit"`

#### Verdict
**Config-only / Blocked**

---

### Polygon Mainnet

#### Implementation Status
Config-only. Blocked by mainnet guard.

#### Evidence
- `chains/evm/configs/networks.json:104-118`
- `isLive: false`, `blockedReason: "Awaiting external audit"`

#### Verdict
**Config-only / Blocked**

---

### Polygon zkEVM Mainnet

#### Implementation Status
Config-only. Blocked by mainnet guard.

#### Evidence
- `chains/evm/configs/networks.json:119-133`
- `isLive: false`, `blockedReason: "Awaiting external audit"`

#### Verdict
**Config-only / Blocked**

---

### BSC Mainnet

#### Implementation Status
Config-only. Blocked by mainnet guard.

#### Evidence
- `chains/evm/configs/networks.json:134-148`
- `isLive: false`, `blockedReason: "Awaiting external audit"`

#### Verdict
**Config-only / Blocked**

---

## 4. Cross-Chain Consistency Audit

### 4.1 Asset ID Format
| Chain | Derivation | Evidence |
|-------|-----------|----------|
| EVM | `keccak256(abi.encodePacked(token_address))` | `AssetRegistry.sol:62` |
| Solana | `0x00 \|\| keccak256("white:asset_id:v1" \|\| mint)[0..31]` | `asset_vault.rs:304-308` |

**Verdict:** ❌ **MISMATCH.** A deposit proof for the same conceptual asset (e.g., USDC) will have different `asset_id` public inputs on EVM vs Solana. Cross-chain proofs are incompatible.

### 4.2 Commitment Format
| Chain | Format | Evidence |
|-------|--------|----------|
| EVM | `uint256` | `WhiteProtocol.sol:181` |
| Solana | `[u8; 32]` | `deposit_masp.rs:127` |

**Verdict:** ✅ Match at cryptographic level (both use `Poseidon(secret, nullifier, amount, asset_id)`).

### 4.3 Nullifier Hash Format
| Chain | Format | Evidence |
|-------|--------|----------|
| EVM | `uint256` | `WhiteProtocol.sol:257` |
| Solana | `[u8; 32]` | `withdraw_masp.rs:163` |

**Verdict:** ✅ Match at cryptographic level.

### 4.4 Root Format
| Chain | Format | Evidence |
|-------|--------|----------|
| EVM | `uint256` | `MerkleTreeWithHistory.sol` |
| Solana | `[u8; 32]` | `merkle_tree.rs:52` |

**Verdict:** ✅ Match at cryptographic level.

### 4.5 Public Input Ordering (Withdraw)
| # | Field | EVM Evidence | Solana Evidence |
|---|-------|-------------|-----------------|
| 1 | merkle_root | `WhiteProtocol.sol:288` | `public_inputs.rs:203` |
| 2 | nullifier_hash | `WhiteProtocol.sol:289` | `public_inputs.rs:204` |
| 3 | asset_id | `WhiteProtocol.sol:290` | `public_inputs.rs:205` |
| 4 | recipient | `WhiteProtocol.sol:291` | `public_inputs.rs:206` |
| 5 | amount | `WhiteProtocol.sol:292` | `public_inputs.rs:207` |
| 6 | relayer | `WhiteProtocol.sol:293` | `public_inputs.rs:208` |
| 7 | relayer_fee | `WhiteProtocol.sol:294` | `public_inputs.rs:209` |
| 8 | public_data_hash | `WhiteProtocol.sol:295` | `public_inputs.rs:210` |

**Verdict:** ✅ Match.

### 4.6 Verifier Input Encoding
| Chain | Encoding | Evidence |
|-------|----------|----------|
| EVM | `uint256[]` calldata to Groth16 verifier | `DepositVerifier.sol:65`, `WithdrawVerifier.sol:80` |
| Solana | `Vec<[u8;32]>` field elements via alt_bn128 | `groth16.rs:295-306` |

**Verdict:** ✅ Match at protocol level (both use BN254 field elements).

### 4.7 Merkle Tree Depth
| Chain | Depth | Evidence |
|-------|-------|----------|
| EVM | Fixed `20` | `MerkleTreeWithHistory.sol:12` |
| Solana | Configurable `4-24`, default `20` | `merkle_tree.rs:26`, `init-new-deployment.ts:10` |

**Verdict:** ⚠️ Runtime match (if Solana initialized with 20), but Solana's configurability creates risk of divergence.

### 4.8 Root History Length
| Chain | Size | Evidence |
|-------|------|----------|
| EVM | Fixed `30` | `MerkleTreeWithHistory.sol:13` |
| Solana | Configurable `≥30`, default `100` | `merkle_tree.rs:35`, `init-new-deployment.ts:11` |

**Verdict:** ❌ MISMATCH. Solana keeps 100 roots by default; EVM keeps 30. A proof valid against root #31 on Solana would be rejected on EVM.

### 4.9 Fee Model
| Chain | Model | Evidence |
|-------|-------|----------|
| EVM | Global constants: 0.5% relayer, 5% yield, 10% max | `WhiteProtocol.sol:47-49` |
| Solana | Per-relayer configurable: 0.1%-5% default, 10% max | `relayer.rs:88-89`, `withdraw_masp.rs:42-43` |

**Verdict:** Design divergence. Not a bug, but users will see different fee behavior across chains.

### 4.10 Chain ID / Domain Separator
| Chain | Usage | Evidence |
|-------|-------|----------|
| EVM | `block.chainid` checked only in deployment script | `Deploy.s.sol:75` |
| Solana | No chain ID in any public input | N/A |
| Circuits | No chain ID in any circuit public input | All `.circom` files |

**Verdict:** ❌ **SECURITY GAP.** ZK proofs are not bound to any chain. If the same Merkle root and asset ID ever exist on two chains, a valid proof could be replayed. The differing asset-ID derivations currently mitigate this, but it is defense-through-obscurity, not explicit binding.

### 4.11 Note Serialization
| Chain | Serialization | Evidence |
|-------|--------------|----------|
| EVM | No note parameter in deposit | `WhiteProtocol.sol:179-184` |
| Solana | `_encrypted_note: Option<Vec<u8>>` accepted but ignored | `deposit_masp.rs:130` |

**Verdict:** ❌ API inconsistency. Solana accepts an encrypted note parameter; EVM does not.

### 4.12 Stealth Address Format
| Chain | Ephemeral Pubkey Size | Evidence |
|-------|----------------------|----------|
| EVM Contract | `bytes32` (32 bytes) | `WhiteProtocol.sol:257` |
| EVM TS | 33-byte compressed secp256k1 | `packages/core/src/stealth/derive-secp256k1.ts:85-107` |
| Solana | 32-byte ed25519 | `withdraw_masp.rs:540` |

**Verdict:** ❌ MISMATCH. EVM TypeScript generates 33-byte compressed secp256k1 pubkeys, but the Solidity contract stores `bytes32`. The extra byte would be truncated or cause encoding issues.

### 4.13 Token Decimals Handling
| Chain | Handling | Evidence |
|-------|----------|----------|
| EVM | Native ETH (18 decimals) + ERC-20 generic | `WhiteProtocol.sol:181-184` |
| Solana | wSOL (9 decimals) + SPL generic | `deposit_masp.rs:127` |

**Verdict:** ✅ Both handle arbitrary decimals via `amount` uint64/u256. No hardcoded decimals.

---

## 5. Deployment Reality Check

| Chain | Claimed Support | Actual Support | Evidence | Blocker |
|-------|-----------------|----------------|----------|---------|
| Solana Devnet | Full program | Deposit only | `E2E-TEST-FINAL-RESULTS.md` | Settlement proof mismatch (`CryptographyError 6009`) |
| Base Sepolia | Full protocol | Full protocol | `deployments/base-sepolia.json`, 50 passing tests | Testnet only |
| Ethereum Sepolia | Configured | Config-only | `networks.json` | No deployment, no tests |
| Polygon Amoy | Configured | Config-only | `networks.json` | No deployment, no tests |
| Polygon zkEVM Cardona | Configured | Config-only | `networks.json` | No deployment, no tests |
| BSC Testnet | Configured + E2E script | Config-only | `networks.json`, `e2e-bsc-testnet.ts:397` | No deployment, placeholder assetId |
| Base Mainnet | Configured | Config-only | `networks.json`, `blockedReason` | Awaiting audit |
| Ethereum Mainnet | Configured | Config-only | `networks.json`, `blockedReason` | Awaiting audit |
| Polygon Mainnet | Configured | Config-only | `networks.json`, `blockedReason` | Awaiting audit |
| Polygon zkEVM Mainnet | Configured | Config-only | `networks.json`, `blockedReason` | Awaiting audit |
| BSC Mainnet | Configured | Config-only | `networks.json`, `blockedReason` | Awaiting audit |

---

## 6. Test Gap Matrix

| Chain | Unit Tests | Integration Tests | E2E Tests | Deployment Tests | Relayer Tests | Missing Critical Tests |
|-------|:----------:|:-----------------:|:---------:|:----------------:|:-------------:|:----------------------|
| Solana Devnet | ⚠️ Minimal (Poseidon vectors, CU budget) | ✅ `deposit-withdraw-integration.ts` | ⚠️ Deposit only | ❌ None | ❌ None | Batch settlement, withdraw, double-spend, relayer HTTP, yield |
| Base Sepolia | ✅ 50 Foundry tests | ❌ None | ✅ `e2e-base.ts`, `e2e-base-full.ts` | ❌ None | ⚠️ Manual only | Integration tests, deployment verification, relayer E2E |
| All other EVM | ❌ None | ❌ None | ❌ None | ❌ None | ❌ None | Everything |

### Exact Test Commands

**EVM:**
```bash
cd chains/evm && forge test -vvv
# Result: 50 passed, 0 failed
```

**Solana:**
```bash
cd chains/solana && anchor test
# Result: Not run in CI. E2E tests require live devnet RPC.
```

**Circuits:**
```bash
cd circuits && ./build.sh
# Result: Only deposit, withdraw, withdraw_v2, membership compiled. merkle_batch_update exists but build.sh does not compile it.
```

---

## 7. CI Gap Matrix

| Component | Build Checked | Tests Checked | Deployment Checked | Verifier/Circuit Checked | IDL/ABI Checked |
|-----------|:-------------:|:-------------:|:------------------:|:------------------------:|:---------------:|
| EVM Contracts | ✅ `forge build --sizes` | ✅ `forge test -vvv` | ❌ No | ❌ No | ❌ No |
| Solana Program | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| Circuits | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |
| Relayer | ✅ `npm run build` | ❌ No | ❌ No | N/A | N/A |
| Frontend | ✅ `npm run build` | ❌ No | ❌ No | N/A | N/A |
| App | ❌ No | ❌ No | ❌ No | N/A | N/A |

### CI Files Found
- `.github/workflows/ci.yml` — builds frontend, relayer, Docker image. No tests.
- `chains/evm/.github/workflows/test.yml` — formats, builds, tests EVM contracts only.

### Critical Gaps
1. No Solana program CI (no `cargo check`, no `anchor test`, no `anchor build`).
2. No circuit CI (no `build.sh` execution, no artifact verification).
3. No verifier-vs-circuit consistency check.
4. No IDL/ABI drift detection.
5. No E2E test automation.

---

## 8. Recommended Fix Order

### Phase 1: Supporting Chain Correctness (Blockers)
1. **Fix Solana `settle_deposits_batch` proof mismatch** — debug why snarkjs proofs fail on-chain. Compare public input byte ordering, SHA-256 to field conversion, and proof format conversion.
2. **Fix or remove `batch_process_deposits`** — it exceeds 1.4M CU. Either optimize Poseidon (MontFp! constants) or deprecate in favor of `settle_deposits_batch`.
3. **Fix EVM stealth pubkey size mismatch** — `bytes32` in contract vs 33-byte compressed secp256k1 in TypeScript.
4. **Unify asset ID derivation** — pick one format and apply to both chains, or add chain-specific prefix/salt.
5. **Unify root history size** — pick one value (recommend 30 to match EVM, or make EVM configurable).
6. **Add chain ID to ZK public inputs** — prevent cross-chain proof replay.

### Phase 2: Chain-Specific Tests
7. **Add Solana program CI** — `cargo check`, `anchor build`, `anchor test` in GitHub Actions.
8. **Add circuit CI** — run `build.sh`, verify artifacts exist, check manifest matches disk.
9. **Run full Solana E2E** — deposit → settle → withdraw → double-spend check on devnet.
10. **Run E2E on all configured EVM testnets** — at minimum verify deployment scripts execute correctly.

### Phase 3: Relayer/Sequencer Per Chain
11. **Implement `relayer/src/chains/solana.ts`** — currently throws `"not yet implemented"`.
12. **Remove or fix `app/src/lib/chainService.ts` BSC hardcoded Base address bug** — `isSpent`, `getCommitmentPendingIndex`, `findDepositEvent` hardcode `BASE_PROTOCOL_ADDRESS` regardless of chain.

### Phase 4: Deployment Scripts and Config Validation
13. **Generate real keypairs for shadow deployment** — replace `ShadowWht1111111111111111111111111111111111` placeholder.
14. **Fix Solana `declare_id!` mismatch** — source declares `DbYzCrBE…` but deployed program is `C9GAJTF…`.
15. **Remove live API keys from source** — 10+ files contain Helius API keys.
16. **Add pre-deployment config validation** — verify all required env vars, RPC URLs, and keypairs before `forge script` or `anchor deploy`.

### Phase 5: Frontend Chain Gating
17. **Remove unsupported chains from `app/` default chain list** until they are deployed and tested.
18. **Add chain-capability detection** — if a chain has no deployment, gray it out in UI.
19. **Fix `frontend/` to be multi-chain or rename it** — currently Solana-only despite "multi-chain" branding.

### Phase 6: Bridge Deep-Dive (Separate Audit)
20. **Integrate real LayerZero Solana endpoint CPIs** into `white-bridge-solana`.
21. **Fix `white-bridge-solana` program ID** — currently uses wSOL mint address.
22. **Run bridge E2E tests** after core chain fixes are complete.

---

## 9. Public Claims Safety

### Safe Claims
- "Base Sepolia testnet contracts are deployed and tested" — ✅ True. Addresses and tests exist.
- "Solana devnet deposit with real ZK proof works" — ✅ True. Transaction `4qNhrsaE…` proves this.
- "EVM contracts are chain-agnostic" — ✅ True. No hardcoded chain IDs or addresses in Solidity.
- "50 Foundry tests pass for EVM contracts" — ✅ True. `forge test` confirms.

### Unsafe Claims
- "Multi-chain privacy protocol" — ❌ Unsafe. Only Base Sepolia is live. All other chains are config-only.
- "Cross-chain bridge" — ❌ Unsafe. Bridge contracts exist but Solana LZ CPIs are stubbed. No E2E bridge test.
- "BSC support" — ❌ Unsafe. No deployment, no tests, E2E script uses placeholder assetId.
- "Polygon / zkEVM support" — ❌ Unsafe. Config-only.
- "Private transfer / JoinSplit" — ❌ Unsafe. Solana instructions return `NotImplemented`.
- "Production-ready" — ❌ Unsafe. No mainnet deployments, no audit, settlement bug on Solana.
- "Stealth withdrawals on EVM" — ⚠️ Unsafe. Contract uses `bytes32` but implementation generates 33-byte keys.

### Safe With Qualifier
- "Solana program has 35 instructions implemented" — ✅ True, but 3 are stubs and withdrawal is blocked.
- "Relayer supports 10 EVM chains" — ⚠️ True in config, but only Base Sepolia is `isLive=true`.

---

## 10. Final Verdict

### Are all supporting chains successfully implemented?
**No.** Only **Base Sepolia** is fully implemented and testable. **Solana Devnet** has a working deposit but a broken settlement path that blocks all withdrawals. **All other 9 chains** are config-only.

### Which chain should be considered the source of truth today?
**Base Sepolia.** It has deployed contracts, passing tests, real E2E execution, and a working relayer sequencer.

### Which chains should be disabled in frontend until fixed?
1. **BSC Testnet** — no deployment, broken `chainService.ts` reads.
2. **All mainnets** (Base, Ethereum, Polygon, zkEVM, BSC) — blocked pending audit, no deployments.
3. **Ethereum Sepolia, Polygon Amoy, Polygon zkEVM Cardona** — config-only, no deployments, no tests.

The `app/` should only show **Solana Devnet** and **Base Sepolia** as active options. Solana should carry a "Deposit only — withdrawal temporarily disabled" warning.

### Which chains should be fixed first?
1. **Solana Devnet** — fix settlement proof mismatch. This unblocks the entire Solana E2E test suite.
2. **Base Sepolia** — already working; use it as the reference for deploying to other EVM testnets.
3. **BSC Testnet** — fix `chainService.ts` hardcoded Base address bug, then deploy and test.

### Is the repo ready to move to bridge-focused remediation?
**No.** Bridge work must wait until:
- Solana settlement is fixed (otherwise there is nothing to bridge *from* Solana).
- At least one additional EVM chain is deployed and E2E-tested (to have a meaningful bridge pair).
- The relayer Solana adapter is implemented (currently stubbed).

**Recommendation:** Complete Phase 1 (supporting chain correctness) before beginning the bridge audit.

---

## Appendix: File Reference Index

| File | Relevance |
|------|-----------|
| `chains/evm/configs/networks.json` | All EVM chain configs |
| `chains/evm/configs/loader.ts` | Network loader |
| `chains/evm/foundry.toml` | RPC endpoints, etherscan |
| `chains/evm/script/Deploy.s.sol` | Deployment script with mainnet guard |
| `chains/evm/deployments/base-sepolia.json` | Only deployment artifact |
| `chains/evm/contracts/WhiteProtocol.sol` | Core EVM privacy pool |
| `chains/evm/contracts/bridge/WhiteBridge.sol` | LZ OApp |
| `chains/solana/Anchor.toml` | Program IDs, cluster config |
| `chains/solana/programs/white-protocol/src/lib.rs` | Program entry point, declare_id! mismatch |
| `chains/solana/programs/white-protocol/src/instructions/settle_deposits_batch.rs` | Blocked settlement path |
| `chains/solana/programs/white-protocol/src/instructions/batch_process_deposits.rs` | CU-overflow path |
| `chains/solana/programs/white-protocol/src/instructions/deposit_masp.rs` | Working deposit |
| `chains/solana/programs/white-protocol/src/instructions/withdraw_masp.rs` | Implemented but untested withdraw |
| `chains/solana/programs/white-protocol/src/instructions/private_transfer.rs` | Stubbed |
| `chains/solana/programs/white-protocol/src/instructions/prove_membership.rs` | Stubbed |
| `chains/solana/programs/white-protocol/src/instructions/shielded_cpi/execute_action.rs` | Stubbed |
| `chains/solana/programs/white-bridge-solana/src/lib.rs` | Bridge stubs |
| `chains/solana/programs/white-protocol/src/crypto/groth16.rs` | insecure-dev bypass |
| `chains/solana/programs/white-protocol/src/state/asset_vault.rs` | Asset ID derivation |
| `chains/solana/programs/white-protocol/src/state/merkle_tree.rs` | Tree depth/history constants |
| `relayer/src/config.ts` | Relayer network config |
| `relayer/src/chains/solana.ts` | Stubbed Solana adapter |
| `relayer/src/chains/base.ts` | Hardcoded Base Sepolia adapter |
| `relayer/src/sequencer/evm.ts` | Generic EVM sequencer |
| `app/src/config/chains.ts` | App chain list |
| `app/src/config/constants.ts` | Hardcoded chain values |
| `app/src/lib/chainService.ts` | BSC hardcoded Base address bug |
| `app/src/providers/WalletProvider.tsx` | Multi-chain wallet setup |
| `frontend/client/src/config.ts` | Solana-only config |
| `frontend/client/src/components/DepositWithdrawUI.tsx` | Solana-only UI |
| `packages/core/src/constants.ts` | Chain-agnostic constants |
| `circuits/build.sh` | Circuit build script |
| `circuits/manifest.json` | Artifact manifest (out of sync) |
| `.github/workflows/ci.yml` | Root CI |
| `chains/evm/.github/workflows/test.yml` | EVM CI |
| `E2E-TEST-FINAL-RESULTS.md` | Solana deposit success, settlement failure |
| `E2E-TEST-FINAL-STATUS.md` | Settlement proof mismatch details |
| `STATUS-POOL-V8.md` | Older deployment addresses |
