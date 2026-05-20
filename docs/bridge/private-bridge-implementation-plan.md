# Private Bridge v1 — Implementation Plan

**Version:** 1.1  
**Date:** 2026-05-04  
**Status:** EVM↔EVM Testnet Live / Base→Solana Devnet Live / Solana→Base Sepolia Live

---

## 1. Overview

This plan defines the concrete implementation steps for The White Protocol Private Bridge v1.

**Current state:**
- EVM BridgeInbox/BridgeOutbox deployed on Base Sepolia, Ethereum Sepolia, Polygon Amoy, BSC Testnet
- Solana bridge mint instruction (`accept_bridge_v1_mint`) implemented in main program
- Solana source bridge-out instruction (`bridge_out_v1_with_proof`) implemented and proven on localnet
- Relayer bridge service implemented with state machine, signer service, EVM adapter, status API
- Relayer production policy rejects unsafe message-level source events and includes watcher/freeze recommendation scaffolding
- Watcher dry-run observation/reporting, signer custody adapter interface, and daemonized bridge paper/live-testnet mode are implemented for testnet operations
- Cross-decimal Base Sepolia to Solana Devnet amount normalization is defined and proven live: source `BridgeOut.amount` is source-local, generated destination `BridgeMint.amount` is destination-local, and non-divisible conversions are rejected
- First EVM↔EVM E2E (Base Sepolia → Ethereum Sepolia) completed successfully
- Reverse EVM↔EVM E2E (Ethereum Sepolia → Base Sepolia) completed successfully
- Forward EVM↔EVM E2E (Base Sepolia → BSC Testnet) completed successfully
- Forward EVM↔EVM E2E (Base Sepolia → Polygon Amoy) completed successfully
- Live Base Sepolia → Solana Devnet private bridge rerun completed with automated exact-decimal normalization and real Solana settlement/withdraw proofs
- Live Solana Devnet → Base Sepolia private bridge E2E completed with `bridge_out_v1_with_proof`, Base commitment insertion, Base withdraw, and replay checks
- PR-010M: EVM bridge matrix cleanup, artifact audit, route matrix documentation completed
- No bridge-specific circuits; `public_data_hash` has dummy constraint

---

## 2. Existing Code Audit Matrix

| Component | Current Status | Real/Stubbed | Reusable for v1? | Risk | Action Required |
|-----------|---------------|--------------|------------------|------|-----------------|
| `BridgeInbox.sol` / `BridgeOutbox.sol` (EVM) | Deployed & tested | Real | Yes — threshold, pause, caps | Low | Monitor mainnet readiness |
| `BridgeAttestationLib.sol` | Deployed & tested | Real | Yes — secp256k1 raw hash | Low | None |
| `WhiteProtocol.sol` hooks | Deployed & tested | Real | Yes — `bridgeMint`/`bridgeWithdraw` | Low | None |
| Solana `accept_bridge_v1_mint` | Implemented & live-tested | Real | Yes — threshold + pending buffer | Low | Monitor Devnet route coverage |
| Solana `bridge_out_v1_with_proof` | Implemented & live-tested | Real | Yes — withdraw proof + nullifier + custody lock | Medium | Formalize Solana -> EVM amount normalization policy |
| Relayer bridge service | Implemented & tested | Real | Yes — state machine, signer, adapters, production policy, watcher scaffolding | Medium | Needs daemonized watcher/freeze operations |
| `packages/core` bridge message | Implemented & tested | Real | Yes — encoding, hashing, validation | Low | None |
| Bridge E2E script | Implemented | Real | Yes — EVM routes and Solana↔Base proven | Low | Extend to remaining Solana routes |

---

## 3. Implementation PR Sequence

### PR-010B: Bridge Message Format Library ✅ COMPLETE

**Deliverable:** All three languages compute identical `messageHash` for the same inputs.

---

### PR-010C: EVM BridgeInbox/Outbox v1 ✅ COMPLETE

**Deliverable:** EVM contracts compile, 149 tests pass, threshold signature verification works.

---

### PR-010D: Solana Bridge Program v1 ✅ COMPLETE (in main program)

**Deliverable:** `accept_bridge_v1_mint` instruction compiles, 115 Solana tests pass, SBF build passes.

---

### PR-010E: Relayer Bridge Service ✅ COMPLETE

**Deliverable:** Relayer bridge module with state store, signer service, EVM/Solana adapters, status API. 210/210 relayer tests pass.

---

### PR-010F: Bridge Relayer Attestation Service ✅ COMPLETE

**Scope:**
- Bridge relayer state machine (JSON file-based persistence)
- Bridge signer service (secp256k1 raw hash signing, sorted signatures)
- EVM bridge adapter (viem-based event watching + submit)
- Solana bridge adapter skeleton (instruction builder + PDA derivations)
- Bridge status API endpoints
- 35 new bridge tests

**Deliverable:** Bridge relayer foundation complete, all tests pass.

---

### PR-010G: Base ↔ Ethereum E2E Bridge ✅ COMPLETE

**Scope:**
- Deploy BridgeInbox/Outbox to Base Sepolia and Ethereum Sepolia
- Configure 2-of-3 test signer set
- Configure routes, assets, caps
- Run message-level E2E: Base BridgeOut → relayer signs → Ethereum BridgeIn → WhiteProtocol commitment insertion
- Verify duplicate submit rejection

**Deliverable:** First live EVM↔EVM bridge message proven end-to-end.

**Results:**
- Base Sepolia BridgeOutbox: `0xA195F05dDFe97514c7a7ede113204f8752828383`
- Base Sepolia BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Ethereum Sepolia BridgeOutbox: `0x8831AB44113a5De63f1577E157F3E7faaBeeC314`
- Ethereum Sepolia BridgeInbox: `0x236BaE88bd55779CaFC88c90afC9E336131b3463`
- Gas for `acceptBridgeMint` (2-of-3): ~954,229
- E2E tx: BridgeOut `0xb78be5db...`, BridgeIn `0x0513bc95...`

---

### PR-010H: Source Note-Spend / Nullifier Binding ✅ COMPLETE

**Scope:**
- Add `WhiteProtocol.bridgeOutV1` that requires a valid ZK withdraw proof
- Bind `publicDataHash` to the bridge message hash (mod BN254 scalar field)
- Close direct `BridgeOutbox.initBridgeOut` production bypass
- Verify nullifier is atomically spent during bridge out

**Deliverable:** Source note cannot be bridged without a valid ZK proof; message hash is cryptographically bound to the proof.

---

### PR-010I: Base Sepolia → Ethereum Sepolia Full Bridge E2E ✅ COMPLETE

**Scope:**
- Deposit on Base, settle, generate bridge withdraw proof
- Call `bridgeOutV1`, wait finality, produce 2-of-3 threshold signatures
- Submit `acceptBridgeMint` on Ethereum
- Verify destination commitment insertion
- Prove duplicate bridge replay rejection

**Deliverable:** Full source-to-destination commitment flow proven live.

See `docs/fixes/PR-010I-base-to-ethereum-full-bridge-e2e.md` for full transaction log.

---

### PR-010J: Destination Withdrawal from Bridge-Minted Commitment ✅ COMPLETE

**Scope:**
- Generate destination withdraw proof for the bridge-minted commitment on Ethereum
- Call `WhiteProtocol.withdraw` using a signer-enabled contract instance
- Verify recipient receives funds and nullifier is marked spent
- Prove duplicate destination withdraw/nullifier replay rejection
- Fix E2E script clean exit (explicit provider cleanup + `process.exit(0)`)

**Deliverable:** The full private bridge user journey is complete: deposit → bridge → withdraw.

**Evidence:**
- Destination withdraw tx: `0xd7e9...99c5`
- Gas used: 324,822
- Duplicate bridge replay: rejected (`MessageAlreadyConsumed`)
- Duplicate withdraw replay: rejected (`Nullifier already spent`)

See `docs/fixes/PR-010J-destination-withdraw-bridge-minted-note.md` for full report.

---

### PR-010K: Ethereum Sepolia → Base Sepolia Full Bridge E2E (Reverse Direction) ✅ COMPLETE

**Scope:**
- Redeploy Ethereum Sepolia `WhiteProtocol` with `bridgeOutV1` support
- Wire new Ethereum WP to BridgeOutbox; wire BridgeInbox to correct Base WP
- Configure Base BridgeInbox for inbound Ethereum canonical asset ID
- Fund Base Sepolia deployer via L1→L2 bridge
- Run full E2E: deposit → settle → bridgeOutV1 → threshold sign → acceptBridgeMint → destination withdraw
- Prove duplicate bridge replay and duplicate destination withdraw rejection
- Fix RPC state-lag issues and gas estimation failures

**Deliverable:** Reverse-direction private bridge proven end-to-end. Both EVM↔EVM directions now work.

**Evidence:**
- Ethereum deposit tx: `0xfc4d0449...`
- Ethereum bridgeOutV1 tx: `0x14d1fda8...`
- Base acceptBridgeMint tx: `0x3d964bbe...`
- Base destination withdraw tx: `0xee102071...`

See `docs/fixes/PR-010K-ethereum-to-base-full-bridge-e2e.md` for full report.

---

### PR-010L: BNB Chain + Polygon EVM Routes ✅ COMPLETE (Forward Routes)

**Scope:**
- Deploy BridgeInbox/BridgeOutbox to BNB Testnet and Polygon Amoy
- Add routes: Base → BNB, Base → Polygon (forward only; reverse requires WP redeploy with bridgeOutV1)
- Test all combinations
- Tune gas and finality per chain

**Deliverable:** Forward routes from Base Sepolia to BNB Testnet and Polygon Amoy proven end-to-end.

**Evidence:**

Route A: Base Sepolia → BSC Testnet
- Base deposit tx: `0x212d47d0...`
- Base bridgeOutV1 tx: `0x5349e301...`
- BSC acceptBridgeMint tx: `0x529a43f0...`
- BSC destination withdraw tx: `0x7aa87067...`
- Gas: bridgeOutV1 545,255 | acceptBridgeMint 992,356 | withdraw 324,798

Route B: Base Sepolia → Polygon Amoy
- Base deposit tx: `0x74f74d1c...`
- Base bridgeOutV1 tx: `0x5f0165d6...`
- Polygon acceptBridgeMint tx: `0x495664bf...`
- Polygon destination withdraw tx: `0x0da0eed2...`
- Gas: bridgeOutV1 545,315 | acceptBridgeMint 992,404 | withdraw 324,798

**Fixes Applied:**
- Cross-chain canonical asset mapping: destination BridgeInboxes need `supportAsset` + `setLocalAsset` for source domain asset IDs
- Polygon Amoy gas override: legacy transactions at 35 gwei required (publicnode enforces min 25 gwei tip)
- Base deployer funding via L1StandardBridge `0xfd0Bf71F60660E2f608ed56e1659C450eB113120`
- BSC RPC fallback: `data-seed-prebsc-1-s1.bnbchain.org:8545` (publicnode lacks archive state)

**Notes:**
- BNB and Polygon WhiteProtocol deployments lack `bridgeOutV1`; reverse routes require WP redeploy
- All replay protections verified: duplicate bridge → `MessageAlreadyConsumed`, duplicate withdraw → `Nullifier already spent`

---

### PR-010M: EVM Bridge Matrix Cleanup & Route Readiness ✅ COMPLETE

**Scope:**
- Audit and fix malformed deployment JSON artifacts (Base, BNB, Polygon)
- Enrich bridgeV1 metadata (domainId, supportsBridgeOutV1, route limitations, gas overrides)
- Create canonical EVM bridge route matrix (`docs/bridge/evm-bridge-route-matrix.md`)
- Audit E2E scripts for copy-paste errors and stale comments
- Verify package scripts for all proven routes
- Run regression tests (EVM Foundry + relayer tests + typecheck + build)
- Document BNB/Polygon reverse-route blockers

**Deliverable:** Clean artifacts, documented matrix, passing regression tests, clear next steps.

**Key Findings:**
- 3 of 4 deployment JSONs had JSON syntax errors (fixed).
- BNB and Polygon `WhiteProtocol` deployments lack `bridgeOutV1`; reverse routes blocked.
- All 4 proven routes are repeatable with fresh notes/commitments per run.

---

### PR-010N: Upgrade/Redeploy BNB + Polygon WhiteProtocol with bridgeOutV1

**Scope:**
- Redeploy `WhiteProtocol` on BNB Chain Testnet and Polygon Amoy with PR-010H+ bytecode
- Redeploy `BridgeOutbox` on both chains wired to new `WhiteProtocol`
- Configure outbound routes and asset mappings
- Run full E2E: BNB → Base and Polygon → Base
- Verify duplicate replay protections

**Deliverable:** BNB and Polygon become full source chains. Reverse routes unblocked.

---

### PR-010O: BNB → Base + Polygon → Base Reverse-Direction E2E ✅ COMPLETE

**Scope:**
- Fix BNB and Polygon `canonicalAssetId` to match AssetRegistry v2 on-chain values
- Configure Base BridgeInbox inbound asset mapping for BNB and Polygon assets
- Run full E2E: BNB → Base and Polygon → Base with destination withdraw
- Verify duplicate replay protections

**Deliverable:** BNB → Base and Polygon → Base are fully proven.

**Evidence:**
- BNB deposit tx: `0x50d10cf1...`
- BNB bridgeOutV1 tx: `0xebf4c006...`
- Base acceptBridgeMint (BNB): `0x568fdcbf...`
- Base destination withdraw (BNB): `0xa40c4da8...`
- Polygon deposit tx: `0xa19c7c97...`
- Polygon bridgeOutV1 tx: `0xd623fe02...`
- Base acceptBridgeMint (Polygon): `0x43d56a6d...`
- Base destination withdraw (Polygon): `0xb387349d...`

See `docs/fixes/PR-010O-bnb-polygon-to-base-bridge-e2e.md` for full report.

---

### PR-010P: Ethereum → BNB + Ethereum → Polygon E2E ✅ COMPLETE

See `docs/fixes/PR-010P-ethereum-to-bnb-polygon-bridge-e2e.md` for full report.

---

### PR-010Q: BNB → Ethereum + Polygon → Ethereum E2E ✅ COMPLETE

See `docs/fixes/PR-010Q-bnb-polygon-to-ethereum-bridge-e2e.md` for full report.

---

### PR-010R: Solana Bridge TS/Anchor Integration Tests ✅ COMPLETE

**Scope:**
- Solana `accept_bridge_v1_mint` instruction tests with real threshold signatures
- `init_bridge_v1_out`, signer set, route, and asset configuration tests
- Replay protection, insufficient signature, and unknown signer rejection tests
- Bridge message encoding/decoding across Solana ↔ EVM domain boundaries
- **Discovered and fixed SBF stack overflow in `AcceptBridgeV1Mint`**

**Deliverable:** Solana bridge codepath is integration-tested and relayer-ready.

**Results:**
- 12/12 integration tests pass on localnet
- Stack overflow fixed by boxing all accounts in `AcceptBridgeV1Mint`
- 115/115 Rust tests pass, SBF build clean

See `docs/fixes/PR-010R-solana-bridge-v1-integration-tests.md` for full report.

---

### PR-010V: Cross-decimal Amount Normalization ✅ COMPLETE

**Scope:**
- Define v1 amount semantics without changing `BridgeMessageV1`
- Add deterministic exact decimal conversion for `BridgeOut` to `BridgeMint`
- Reject non-divisible downscales and uint128 overflow
- Add Base Sepolia ETH to Solana Devnet wSOL route metadata
- Sign the generated destination `BridgeMint` hash instead of a manually edited message
- Update Base to Solana source-side E2E state generation for automated destination message creation

**Decision:**
- `BridgeOut.amount` is source-local units
- `BridgeMint.amount` is destination-local units
- Base ETH 18 decimals to Solana wSOL 9 decimals uses `exact-decimal`
- `1e15` wei maps to `1e6` lamports, not `1e9` lamports

See `docs/bridge/cross-chain-amount-normalization.md` and `docs/fixes/PR-010V-cross-decimal-amount-normalization.md`.

---

### PR-010W: Base Sepolia → Solana Devnet Normalized E2E ✅ COMPLETE

**Scope:**
- Fund the Base Sepolia deployer and rerun the Base source path.
- Parse JSON-loaded `BridgeMessageV1` numeric fields through bigint-safe helpers.
- Use automated `BridgeOut` to `BridgeMint` transformation with exact-decimal normalization.
- Sign the generated Solana `BridgeMint` hash with the 2-of-3 threshold signer set.
- Run live Solana Devnet accept, pending enqueue, settlement, withdraw, and duplicate checks.

**Deliverable:** Base Sepolia to Solana Devnet private bridge path is proven end-to-end without manual destination message edits.

**Evidence:**
- Source amount: `1_000_000_000_000_000` wei
- Destination amount: `1_000_000` lamports
- Source `BridgeOut` hash: `0xa17dd855e9927eb508e5cea8abec4002c05d79f148a3f84237ae14781eb6edad`
- Generated destination `BridgeMint` hash: `0x706f7b492e5ea1efc568f6bcf5929631650f00635fc4102596fefb231f7f944a`
- Base `bridgeOutV1` tx: `0xc931d4989abc6fa8c6c85726575780d12370c2a26d38db063c837bd0491ac6d2`
- Solana accept tx: `3jWjcDwEhiNcZ6AgfzU26hoWioLyCeuhSM9YjsodDGxghqJqVGfyb3Tvj1ApyudJTueA6rt1ZLwWQdWGQ2WRYmRh`
- Solana settle tx: `jMmPT2MSPsUKkGofn1mRrprtUXnpfWRLuRwtwNbtJv542L2XrwtfQLtbXZR47jQ7gWLVVSRn2Jp3UNrNwRhtnFF`
- Solana withdraw tx: `26t1UmPPCDftKv48j8dZxs5GCV5c31YyRyDWD32q6ARHEyEdJ3DajgNCNAZF56CShu75zD15ErEMnxWfdrgLmthW`

See `docs/fixes/PR-010W-live-base-to-solana-normalized-rerun.md` for full report.

---

### PR-010X: Solana Source BridgeOut Binding Audit ✅ COMPLETE

**Scope:**
- Audit current Solana `init_bridge_v1_out` behavior before attempting Solana → Base.
- Compare current source path with EVM `WhiteProtocol.bridgeOutV1`.
- Decide whether current Solana source bridge-out is production-safe.
- Specify the required source note/nullifier binding instruction if missing.

**Finding:** Current `init_bridge_v1_out` is message-level only. It does not verify a withdraw proof, spend a source nullifier, bind `sourceNullifierHash`, bind `public_data_hash` to `hash_bridge_message_v1(message)`, or lock source-side value.

**Deliverable:** Solana → Base E2E is blocked until `bridge_out_v1_with_proof` or equivalent is implemented.

See `docs/fixes/PR-010X-solana-source-bridgeout-binding-audit.md` for full report.

---

### PR-010Y: Solana Source BridgeOut With Proof ✅ COMPLETE

**Scope:**
- Add `bridge_out_v1_with_proof` to the main Solana program.
- Verify a real withdraw proof with `public_data_hash = hash_bridge_message_v1(message)`.
- Bind source nullifier, Merkle root, amount, source asset, canonical asset, route, and domain to the message.
- Create a spent nullifier PDA and outbound replay PDA.
- Transfer source-side value from the shielded vault to bridge custody.
- Update route and asset cap accounting.
- Keep `init_bridge_v1_out` as message-level/test-only by relayer policy.
- Add localnet positive and negative coverage.

**Deliverable:** Solana source BridgeOut is source-note/nullifier-bound on localnet. Live Solana Devnet -> Base Sepolia E2E is unblocked for PR-010Z.

**Results:**
- New source-with-proof localnet test: 19/19 checks pass.
- Existing bridge integration localnet test: 12/12 checks pass.
- Existing bridge settle/withdraw localnet summary: 14/14 checks pass.
- Rust unit tests: 115/115.
- SBF build passes.

See `docs/fixes/PR-010Y-solana-bridge-out-with-proof.md` for full report.

---

### PR-010Z: Solana Devnet → Base Sepolia Private Bridge E2E ✅ COMPLETE

**Scope:**
- Upgrade Solana Devnet program to include PR-010Y `bridge_out_v1_with_proof`.
- Configure Solana -> Base source route and Base inbound Solana asset mapping.
- Run Solana source deposit and settlement with real proofs.
- Run Solana `bridge_out_v1_with_proof` with a real withdraw proof bound to `hashBridgeMessageV1(message)`.
- Produce sorted 2-of-3 raw secp256k1 threshold signatures.
- Submit Base `BridgeInbox.acceptBridgeMint`.
- Verify Base destination commitment insertion and Base withdraw with a real proof.
- Verify duplicate Solana bridge-out, duplicate Base bridge accept, and duplicate Base withdraw rejection.

**Deliverable:** Solana Devnet -> Base Sepolia private bridge route proven live.

**Evidence:**
- Solana deposit tx: `yomzcemuB7fsKBTmsVP9coXa9RsGQ6myy4cUAebk8baRdxKRXBh4Y3CirGhBxdj677XnLVHhHz5wKfLvMP1HQcW`
- Solana settlement tx: `2UZXPpgxtY5eqB3N3QtXk8rHY2AdDssmVUfR7fmpWY7GLWyuMqqdPZRZWyyCLV3FXhuQ7T9i2iohjxA6wNECjWwR`
- Solana `bridge_out_v1_with_proof` tx: `BQNRKsUFX5ttshDzZcjtqecsUJjt6cbvURtQtcqX4K7edtmTsNnK5kbNM3hjBwSUtwq2MQfDXhs8SKjP96S3QDQ`
- Bridge message hash: `0x16a3f7f82b64a4d4d669b79118fcdaf7b720bd24d7bbced1dffc36dba3e71334`
- Base `acceptBridgeMint` tx: `0x8035a98d328dcfc6442e5253fc86320fb9488000bc252a9fb3dd74019f706c2e`
- Base withdraw tx: `0x24f31bda6e2b415527f9f4d949ef050fd7394987a0ebaf23325076caffcff6fa`

**Notes:**
- `init_bridge_v1_out` was not used.
- A later fresh rerun emitted an additional Solana BridgeOut but stopped before Base accept because the Base deployer was low on Base Sepolia ETH. The recorded PR-010Z success path above is complete.
- Solana -> EVM economic amount normalization remains a follow-up policy item.

See `docs/fixes/PR-010Z-solana-to-base-private-bridge-e2e.md` for full report.

---

### PR-011A: Watcher / Challenge / Freeze ✅ COMPLETE (policy scaffolding)

**Scope:**
- Production relayer source-event acceptance policy
- Explicit rejection of unsafe Solana `init_bridge_v1_out`
- Explicit acceptance of Solana `bridge_out_v1_with_proof`
- Explicit EVM BridgeOut source-bound policy
- Finality policy per testnet source chain
- Route, asset, amount cap, and cross-decimal policy checks
- Watcher finding/recommendation scaffolding for delay, alert, manual review, and freeze
- Offline relayer tests for policy decisions

**Files:**
- `relayer/src/bridge/policy.ts`
- `relayer/src/bridge/watcher.ts`
- `relayer/src/bridge/__tests__/policy.test.ts`
- `docs/bridge/bridge-production-policy.md`
- `docs/bridge/bridge-watcher-challenge-freeze.md`

**Deliverable:** Production relayer policy rejects unsafe message-level events and watcher scaffolding produces deterministic freeze/manual-review recommendations. No runtime deployments or on-chain freeze transactions were added in this PR.

**Results:**
- Relayer tests: 17 suites passed, 231 tests passed
- Typecheck: passed
- Build: passed

**Next:** PR-011B should daemonize watcher operations, persist findings, expose operator APIs, and add approved on-chain freeze submission flows.

---

### PR-011B–PR-011G: Operational Hardening ✅ COMPLETE (testnet-only)

**Scope:**
- watcher daemon, persistent findings, authenticated operator APIs
- hosted dry-run alerting and smoke fixtures
- observation window reports and escalation policy
- freeze execution design without live freeze enablement
- signer custody adapter interface and signing policy gate
- daemonized bridge relayer mode with `disabled`, `paper`, and gated `live-testnet`

**Deliverable:** Bridge operations can be exercised in hosted testnet paper mode without default live destination submission. Mainnet remains blocked, freeze submission remains disabled by default, and Solana daemon submission is preview-only in PR-011G.

**Results:**
- PR-011F relayer tests: 20 suites passed, 293 tests passed
- PR-011G adds daemon tests for mode gating, watcher blocks, signer policy, EVM/Solana previews, persistence, and operator auth

**Next:** PR-011H should run hosted bridge daemon paper mode on current testnet routes, compare previews against known E2E flows, and define the narrow operator checklist before any live-testnet submit enablement.

---

### PR-011H: Bridge Daemon Paper Replay ✅ COMPLETE (historical event)

**Scope:**
- Add offline-safe `npm run bridge:daemon:paper:once`
- Replay the documented PR-010W Base Sepolia -> Solana Devnet source event artifact
- Apply policy/finality/signing gates in paper mode
- Generate Solana `accept_bridge_v1_mint` submit preview
- Persist daemon state and inspect it with `npm run bridge:daemon:paper:status`
- Keep live destination submission disabled

**Deliverable:** The bridge daemon can process a real historical testnet source event artifact in paper mode and reach `paper_ready_to_submit` with signatures and a submit preview while `submitTxHash=null`.

**Blocked live scan note:** Fresh live RPC scanning was not run in this shell because Base/Ethereum RPC env vars and signer/operator env were absent. The PR therefore proves the historical replay path and documents the live-env blocker by variable name only.

---

### PR-011I: Hosted Paper-Mode Live-Log Prep ✅ COMPLETE (environment-blocked)

**Scope:**
- Add `npm run bridge:daemon:env:check`
- Add `npm run bridge:daemon:paper:scan`
- Carry live EVM confirmation counts from source log scans into daemon policy
- Add hosted env/runbook checklist for Render or equivalent hosts
- Add mocked live-log tests for final, not-final, and no-event scan windows
- Keep live destination submission disabled

**Deliverable:** Hosted paper-mode live-log observation is implementation-ready. In this shell, fresh live scanning remained blocked because hosted RPC/signer/operator env was absent, so the PR follows the environment-blocked acceptance path with mocked live-scan coverage.

**Next:** PR-011J should run the hosted scanner in an environment with real RPC and signer/operator secrets configured, then record fresh scan evidence without enabling destination submission.

---

### PR-011J: Hosted Paper Mode With Real Env ✅ COMPLETE (environment-blocked)

**Scope:**
- Run `npm run bridge:daemon:env:check` through the hosted-real-env path
- Run `npm run bridge:daemon:paper:scan` only if required hosted env is present
- Keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- Record missing env names without printing values
- Run historical paper fallback only as a clearly labeled fallback
- Keep destination submission disabled

**Deliverable:** The hosted paper-mode real-env command path remains safe. In this local shell, the required hosted RPC, signer, operator token, daemon mode, route, and state-path env names were still absent, so fresh live scanning was blocked before RPC access and no destination transaction was submitted. The historical fallback continued to reach `paper_ready_to_submit` with signatures and Solana preview while `submitTxHash=null`.

**Next:** PR-011K should execute the same scanner on Render or an equivalent host after configuring the required secrets, then record fresh scan range, finality evidence, operator API evidence, and no-submit proof.

---

### PR-011K: Hosted Paper Scan With Real Secrets ✅ COMPLETE (environment-blocked)

**Scope:**
- Run the hosted env readiness check for the real-secrets paper scan
- Stop before live scan if hosted env is incomplete
- Keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- Record missing env names without printing values
- Re-run relayer regression, build, watcher smoke, and watcher report
- Keep destination submission disabled

**Deliverable:** The hosted paper scan remains gated correctly. In this local shell, hosted RPC, signer, operator token, daemon mode, route, and state-path env names were still absent. The run stopped before Base Sepolia RPC access, no fresh logs were scanned, and no destination transaction was submitted.

**Next:** PR-011L should run the same commands on Render or an equivalent host after the required secrets are actually configured, then record fresh scan range, finality evidence, operator API evidence, and no-submit proof.

---

### PR-011M: Hosted Paper Known-Range Scan ✅ COMPLETE (expired historical event)

**Scope:**
- Fix malformed EVM deployment JSON syntax without changing contract addresses
- Target the known PR-010W Base Sepolia -> Solana Devnet BridgeOut block range
- Verify the scanner can find and parse the historical event
- Keep live destination submission disabled

**Deliverable:** The known-range paper scan found the PR-010W source event at Base Sepolia block `41275766` and parsed message hash `0xa17dd855e9927eb508e5cea8abec4002c05d79f148a3f84237ae14781eb6edad`. Current-time policy rejected the event with `expired_deadline`, so no signatures or submit preview were produced. No destination transaction was submitted.

**Next:** Generate one fresh low-value Base Sepolia -> Solana Devnet source event with explicit operator approval, then run hosted paper scan around that block range while keeping live submit disabled.

---

### PR-011N: Fresh Hosted Paper Scan ✅ COMPLETE

**Scope:**
- Generate one low-value Base Sepolia -> Solana Devnet source `BridgeOut` through `WhiteProtocol.bridgeOutV1`
- Keep destination submission disabled
- Let hosted paper mode observe the fresh event
- Verify policy, finality, signer policy, signatures, Solana preview, persisted state, and read-only operator APIs

**Deliverable:** Hosted paper mode processed fresh source tx `0xf0f3f4f12ddbd2ade17334f72a4a348dce614b706ad6427077840dbf9cfef866` from Base block `41539671`, accepted policy, produced 2 signatures, created a Solana `accept_bridge_v1_mint` preview, persisted `paper_ready_to_submit`, and kept `submitTxHash=null`.

**Next:** Prepare an operator approval package for the fresh message and Solana preview before any live-testnet destination submission PR.

---

### PR-011O: Paper Operator Approval Package ✅ COMPLETE

**Scope:**
- Review the PR-011N hosted paper message and submit preview
- Verify amount normalization, signer evidence, Solana PDA derivations, and read-only Solana Devnet account state
- Create a reusable operator approval checklist
- Keep live destination submission disabled

**Deliverable:** The PR-011N message was reviewed for paper-mode approval. The package confirms source hash `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`, destination BridgeMint hash `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`, exact 18-to-9 decimal normalization, 2 signatures, and read-only Solana account existence for the deployed program/config/route/asset/pool state. Live submission remains on hold because the Solana submit preview is still preview-only and must be reconciled to the destination hash, signer set version, and real live-submit account inputs.

**Next:** PR-011P should implement Solana destination live-submit adapter readiness while keeping live submit disabled until a separate approval window.

---

### PR-011P: Solana Destination Submit Adapter Readiness ✅ COMPLETE

**Scope:**
- Use destination BridgeMint hash for Solana preview and destination PDAs
- Preserve source BridgeOut hash separately for audit
- Use Base Sepolia -> Solana Devnet signer set version `2`
- Replace placeholder Solana accounts with deployed Devnet account config
- Add read-only pre-submit readiness checks
- Keep live submission disabled

**Deliverable:** Base Sepolia -> Solana Devnet paper preview now uses destination hash `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`, signer set PDA `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`, deployed PoolConfig/MerkleTree/AssetVault/PendingBuffer accounts, destination-hash consumed/frozen PDAs, and a readiness status. `liveSubmissionImplemented=false` remains intentional because this PR does not submit or serialize a live Solana transaction.

**Next:** PR-011Q should build a full Solana `accept_bridge_v1_mint` transaction dry-run without sending it.

---

### PR-011Q: Solana Destination Transaction Assembly Dry-Run ✅ COMPLETE

**Scope:**
- Build an unsigned Solana `accept_bridge_v1_mint` transaction preview
- Attach compute budget instructions
- Encode destination `BridgeMessageV1`, threshold signatures, and signer set version
- Validate account metas against the Rust/Anchor account order
- Serialize locally without sending
- Keep live submission disabled

**Deliverable:** The Solana preview now includes transaction assembly metadata with compute budget instructions, account meta validation, nonzero serialized length, destination BridgeMint hash usage, source BridgeOut hash audit metadata, signer set version `2`, and `willSubmit=false`. `liveSubmissionImplemented=false` remains intentional.

**Next:** PR-011R should add safe simulation and the final approval gate while keeping live submit disabled.

---

### PR-011R: Solana Destination Simulation And Final Approval Gate ✅ COMPLETE

**Scope:**
- Require explicit destination BridgeMint hash approval
- Reject source BridgeOut hash-only approval
- Re-run consumed/frozen/commitment-index idempotency checks before simulation
- Add a safe Solana `simulateTransaction` helper using `sigVerify=false`
- Sanitize simulation logs
- Keep all send paths disabled

**Deliverable:** The relayer now has simulation and final approval-gate primitives for the assembled Solana destination transaction. Daemon previews expose approval and readiness fields, while `liveSubmissionImplemented=false` remains intentional.

**Next:** PR-011S should run hosted Solana simulation for the approved PR-011N destination BridgeMint hash, still without submitting.

---

### PR-011S: Hosted Solana Simulation For Approved Message ✅ IMPLEMENTATION READY

**Scope:**
- Add a hosted-safe simulation command for the PR-011N destination BridgeMint message
- Require `BRIDGE_APPROVED_MESSAGE_HASHES`
- Load persisted daemon paper state
- Re-run read-only idempotency checks against Solana Devnet
- Simulate with `sigVerify=false`
- Keep destination submit disabled

**Deliverable:** `npm run bridge:daemon:solana:simulate` now performs the hosted simulation flow when env/state are present and stops safely with env names only when they are missing. Local validation was environment-blocked before RPC access; no transaction was submitted.

**Next:** PR-011T should run the command in the hosted Render environment with the approved destination hash and record simulation logs/compute units.

---

### PR-011T: Hosted Solana Simulation Attempt ✅ BLOCKED BY HOSTED STATE

**Scope:**
- Check hosted relayer status
- Confirm paper mode and live-submit disabled
- Inspect daemon messages
- Attempt approved-message simulation path where possible

**Result:** The hosted relayer was reachable and running in paper mode with `allowLiveTestnetSubmit=false`, but `/bridge/daemon/messages` returned an empty list. The approved PR-011N message was not present in hosted daemon state, so pre-submit checks and simulation could not be run. No transaction was submitted.

**Next:** PR-011U should restore or replay the approved message into hosted daemon state, then run `npm run bridge:daemon:solana:simulate` on Render.

---

### PR-011U: Restore/Replay Approved Daemon Message Attempt ✅ BLOCKED BY HOSTED STATE ACCESS

**Scope:**
- Re-check hosted daemon state
- Confirm paper mode and live-submit disabled
- Attempt to locate the approved PR-011N message by source hash
- Define the bounded replay range for the approved source event

**Result:** The hosted daemon remained reachable in paper mode with live submit disabled, but `/bridge/daemon/messages` was still empty and the approved source hash returned 404. Public endpoints do not expose state path or replay controls, and this local environment does not have Render shell/job access or the hosted operator token. Replay and simulation were not attempted. No transaction was submitted.

**Next:** PR-011V should add or run a hosted-only authenticated replay job/operator endpoint for the bounded block range, or generate a fresh approved low-value source event if the PR-011N deadline has expired.

---

### PR-011V: Hosted Bounded Replay Job ✅ IMPLEMENTED, HOSTED RUN BLOCKED

**Scope:**
- Add a safe hosted replay mechanism for a bounded source block range
- Enforce paper mode and disabled live submit
- Require configured testnet route and bounded from/to blocks
- Support expected source and destination hash checks
- Keep destination submit disabled

**Deliverable:** `npm run bridge:daemon:paper:replay` replays a bounded Base Sepolia source range into daemon paper state when hosted RPC, signer, route, and state-path env are present. CLI output is sanitized and does not include secret env values or raw signature arrays.

**Result:** Local validation proved the replay handler and safety gates with mocked source events. The hosted public API still showed an empty message list before hosted replay. This local environment does not have Render shell/job access, so the PR-011N range was not replayed into hosted state here. No transaction was submitted.

**Next:** Run the PR-011V replay command on Render with range `41539651` to `41539691`. If the PR-011N message is rejected by current-time `expired_deadline`, generate a new approved low-value Base Sepolia -> Solana Devnet source event and replay that fresh block range.

---

### PR-011W: Hosted Replay Attempt ✅ BLOCKED BY HOSTED JOB ACCESS

**Scope:**
- Re-check hosted daemon read endpoints
- Confirm paper mode and disabled live submit
- Attempt to proceed with hosted replay or document blocker
- Preserve the no-submit guarantee

**Result:** The hosted relayer remained reachable in paper mode with `allowLiveTestnetSubmit=false`, but `/bridge/daemon/messages` still returned an empty list and the approved PR-011N source hash returned `404`. This local environment does not have Render shell/job access, so the bounded replay command could not be executed against the hosted state path. Local env checks reported missing env names only and the local replay command stopped before RPC access. No destination transaction was submitted.

**Continuation:** After Render env was updated with `BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon`, the current shell was confirmed to be Codespace (`/workspaces/thewhiteprotocol`), not Render (`/opt/render/project/src`). Required live-source env names were still absent locally, so fresh event generation was not run. Use `git rev-parse --show-toplevel` in Render before running hosted commands.

**Continuation result:** A fresh low-value Base Sepolia -> Solana Devnet source event was generated and replayed successfully into hosted paper state. The fresh message reached `paper_ready_to_submit` with policy accepted, finality satisfied, 2 signatures, and a Solana submit preview. Hosted simulation reached the Solana program with `sigVerify=false` and failed deterministically on `frozen_message` account initialization (`AnchorError AccountNotInitialized`, custom `3012`). No destination transaction was submitted and no Solana state mutation was observed.

**Next:** PR-011X should reconcile the Solana destination `frozen_message` account lifecycle for `accept_bridge_v1_mint`, then rerun hosted simulation. Do not enable live submit until simulation succeeds.

---

## 4. Technical Decisions

### 4.1 No New Circuit for v1

**Decision:** Use existing `withdraw` / `withdraw_v2` circuits with `public_data_hash` binding.

**Rationale:**
- Faster time to market.
- Existing circuits are tested and audited.
- On-chain threshold attestation provides sufficient security for v1.

**Cost:** `public_data_hash` only has dummy constraint in-circuit. Semantic binding is on-chain.

**v2 path:** Add dedicated `bridge_withdraw` circuit with proper hash binding.

### 4.2 secp256k1 for Both Chains

**Decision:** Use secp256k1 signatures on both EVM and Solana.

**Rationale:**
- EVM natively supports `ecrecover`.
- Solana supports `secp256k1_recover` precompile.
- Single curve reduces signer infrastructure complexity.

**Status:** Proven on EVM (2-of-3 and 5-of-7). Solana implementation ready, pending devnet test.

### 4.3 Per-Chain Local Merkle Trees

**Decision:** No global Merkle tree in v1.

**Rationale:**
- Simpler implementation.
- Each chain's privacy set is independent.
- No need for cross-chain Merkle proofs.

**Cost:** Smaller anonymity set per chain. Bridge linking heuristics possible.

### 4.4 Operational Rebalancing

**Decision:** Liquidity rebalancing is manual/operational, not automated.

**Rationale:**
- Automated cross-chain rebalancing requires AMMs or atomic swaps.
- Operational rebalancing is sufficient for testnet and early mainnet beta.

**v2 path:** Vault-to-vault swaps or automated market maker integration.

---

## 5. Testing Strategy

| Layer | Test Type | Coverage | Status |
|-------|-----------|----------|--------|
| Message format | Unit (TS/Solidity/Rust) | Cross-language hash parity, validation rules | ✅ Complete |
| EVM contracts | Unit + integration (Foundry) | Threshold verification, caps, pause, replay | ✅ 149 tests pass |
| Solana program | Unit + integration (Anchor) | CPIs, signature verification, CU limits | ✅ 115 tests pass |
| Relayer | Unit + integration (Jest) | Message flow, signature collection, submission | ✅ 213 tests pass |
| E2E | Integration | BridgeOut → sign → BridgeIn/accept → commitment insert → withdraw | ✅ EVM↔EVM routes and Base→Solana proven |
| Fuzz | Property-based | Message decoding, cap edge cases, signature malleability | ⏳ Future |

---

## 6. Open Engineering Questions

1. **Solana source E2E:** Run Solana Devnet -> Base Sepolia using `bridge_out_v1_with_proof`.
2. **Relayer daemon mode:** Current relayer bridge service processes events synchronously. Needs background polling loop for production.
3. **Message retry / backoff:** `FAILED` state messages need automatic retry with exponential backoff.
4. **Explorer verification:** Bridge contracts need verification on Basescan/Etherscan for transparency.

---

## 7. Success Criteria

- [x] All core EVM routes have working E2E tests (Base→Ethereum proven).
- [x] Threshold signature verification works on EVM (2-of-3, 5-of-7).
- [x] Replay protection passes integration testing.
- [x] Cap enforcement blocks exceeded transfers.
- [x] Pause/freeze stops all bridge activity within 1 block/slot.
- [x] No secrets logged in relayer.
- [x] Typecheck and build pass for all modified packages.
- [x] Destination withdrawal from bridge-minted commitment proven.
- [x] Duplicate bridge replay and duplicate destination withdraw replay rejected.
- [x] Base Sepolia → Solana Devnet route proven with automated exact-decimal normalization.
- [x] EVM bridge matrix cleanup and route readiness documented (PR-010M).
- [x] BNB and Polygon WhiteProtocol upgraded with bridgeOutV1 (PR-010N).
- [x] BNB → Base and Polygon → Base reverse routes proven (PR-010O).
- [x] ETH → BNB and ETH → Polygon routes proven (PR-010P).
- [x] BNB → ETH and Polygon → ETH routes proven (PR-010Q).
- [x] Solana Bridge V1 TS/Anchor integration tests pass (PR-010R).
- [x] SBF stack overflow in `accept_bridge_v1_mint` fixed.
- [x] Solana source BridgeOut is bound to withdraw proof/nullifier/value lock on localnet (PR-010Y).
- [x] Solana Devnet → Base Sepolia route proven with source-bound `bridge_out_v1_with_proof` (PR-010Z).
- [x] Solana frozen-message lifecycle fixed so normal BridgeMint accepts do not require pre-created freeze records (PR-011X).
- [x] Solana destination signer set version reconciled to active devnet signer set v3 (PR-011Y).
- [x] Guarded single-message Solana live-testnet submit command implemented with approval, simulation, and idempotency gates (PR-012A).
- [ ] PR-012A daemon-submitted Solana commitment settlement + withdraw evidence captured (PR-012B).
- [x] Destination note-state validation/export flow added; PR-012A note state not recovered from Render (PR-012C).
- [ ] Guarded live submit with validated new note state reached Solana, but settlement/withdraw blocked by non-durable Render note-state export (PR-012D).
- [x] Durable destination note-state backup gate added before guarded Solana live submit (PR-012E).
- [x] Fresh Base Sepolia -> Solana Devnet bridge completed with durable note-state backup, guarded submit, FIFO settlement, withdraw, and duplicate-withdraw rejection (PR-012F).
- [x] Hosted settlement/withdraw preflight added for zkey checksum verification, durable note-state validation, FIFO planning, wallet authority checks, and non-secret report export (PR-012G).
- [x] Hosted settlement/withdraw job wrapper added with fresh preflight report requirement, dry-run default, explicit execute flag, safety blockers, and non-secret result export (PR-012H).
- [x] Hosted settlement/withdraw operator job index added with preflight SHA256 binding, dry-run audit entries, duplicate execution guard, and non-secret index/show commands (PR-012I).
- [x] Hosted settlement/withdraw resume/recovery mode added with persisted phases, preflight hash binding, recovery reports, and ambiguous-state blockers (PR-012J).
- [x] Read-only live recovery snapshot command added for direct Solana tx, PDA, pending/FIFO, note-state, preflight, and job-index checks before resume execution (PR-012K).
- [x] Hosted settlement/withdraw execute/resume mode now requires a fresh recovery snapshot report with SHA256 binding, recommended-action gating, and safe no-op handling for already-complete state (PR-012L).
- [x] Recovery snapshot now derives the expected spent-nullifier PDA directly from validated destination note-state and checks it without printing note secrets or nullifier secrets (PR-012M).
- [x] Hosted PR-012F preflight, live recovery snapshot, and dry-run job wrapper were run on Render; the wrapper safely blocked execution on missing leaf-index evidence for the already-settled target (PR-012N).
- [x] Non-secret settled leaf-index evidence files and command added so recovery snapshot can derive spent-nullifier PDAs for already-settled targets when trusted evidence exists (PR-012O).
- [x] Hosted zkey bootstrap and operator prerequisite commands added to recreate persistent-disk zkey symlinks and verify safe hosted readiness after Render deploys (PR-012P).
- [ ] Remaining Solana → EVM routes proven (Solana → Ethereum, BNB, Polygon).
- [x] Reverse direction (Ethereum→Base) proven.
- [ ] External audit package prepared.
