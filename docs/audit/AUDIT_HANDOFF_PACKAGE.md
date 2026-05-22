# Audit Handoff Package

## Scope Summary

This package defines the current external audit handoff scope for The White Protocol private bridge. It is based on completed testnet evidence only. It does not claim mainnet readiness.

The audit scope covers:

- private pool contracts and bridge contracts on EVM testnets;
- Solana programs used for MASP deposit, settlement, withdraw, and bridge source/destination flows;
- BridgeMessageV1 encoding and cross-language hash parity;
- relayer paper/live-testnet policy gates, signer recovery, simulation, and guarded submit commands;
- watcher findings, alerting, and freeze readiness;
- operational runbooks for approval, note-state custody, recovery, duplicate handling, and already-complete no-op status;
- ZK circuit public inputs, zkey artifact policy, and known bridge-specific binding limitations.

## Repositories / Modules In Scope

- `chains/evm/contracts/**`
- `chains/evm/test/**`
- `chains/solana/programs/**`
- `chains/solana/tests/**`
- `chains/solana/sdk/**`
- `relayer/src/bridge/**`
- `docs/bridge/**`
- `docs/runbooks/**`
- `docs/audit/**`
- `docs/evidence/**`

## Contracts In Scope

- `WhiteProtocol`
- `BridgeInbox`
- `BridgeOutbox`
- `BridgeAssetRegistry`
- `BridgeMessageLib`
- `BridgeAttestationLib`
- `DepositVerifier`
- `WithdrawVerifier`
- `MerkleBatchVerifier`
- `MerkleTreeWithHistory`
- deployed testnet artifact consistency and explorer verification process

Auditors should focus on message consumption, frozen message handling, route caps, asset support, signer-set versioning, threshold validation, duplicate submit rejection, duplicate withdraw rejection, and root/nullifier semantics.

## Solana Programs In Scope

- `white-protocol`
- `white-bridge-solana`
- MASP deposit/settlement/withdraw instructions
- `bridge_out_v1_with_proof`
- `accept_bridge_v1_mint`
- freeze/frozen-message lifecycle
- PDA derivation and authority checks
- Solana BridgeMessageV1 hash parity

The unsafe `init_bridge_v1_out` path is not accepted as trusted Solana source evidence by relayer policy.

## Relayer / Daemon Modules In Scope

- paper replay and durable state persistence;
- Solana -> Base fixture reconstruction and approval;
- guarded submit commands;
- signer recovery and threshold checks;
- route, asset, cap, deadline, finality, frozen, consumed, and spent-nullifier checks;
- read-only simulation/callStatic gates;
- check-only mode and one-shot live-testnet submit mode;
- no-op status for already-submitted and already-withdrawn destinations.

## Watcher Modules In Scope

- watcher smoke fixtures and expected finding codes;
- severity policy and freeze preview;
- dry-run reporting;
- hosted readiness output;
- no open critical finding gates before operator approval.

Live freeze execution remains a production-governance blocker and is not claimed enabled for mainnet.

## ZK Circuits And Artifact Policy

The audit should review deposit, withdraw, and batch update circuits, including public input binding, proof verification contracts/program logic, and witness/proof handling.

Zkeys are operational artifacts. They must not be committed to future audit evidence bundles unless explicitly marked as public ceremony artifacts and reviewed. Hosted zkeys must be stored on persistent disk and checksum-verified before use.

Witnesses, proof JSON files, note-state files, nullifier secrets, and note secrets are out of git scope.

## BridgeMessageV1 Encoding / Parity

BridgeMessageV1 requires auditor review for:

- domain separation;
- source/destination chain IDs;
- source and destination message hash derivation;
- canonical asset ID derivation;
- cross-decimal amount normalization;
- deadline and nonce semantics;
- root, leaf index, nullifier, commitment, memo, metadata, and reserved field encoding;
- EVM/Solana/Rust/TypeScript golden vector parity.

## Testnet Route Evidence

The testnet evidence index is `docs/evidence/TESTNET_BRIDGE_EVIDENCE_INDEX.md`.

Completed routes:

- Base Sepolia -> Solana Devnet
- Solana Devnet -> Base Sepolia
- Base Sepolia -> Ethereum Sepolia
- Ethereum Sepolia -> Base Sepolia
- Base Sepolia -> BSC Testnet
- BSC Testnet -> Base Sepolia
- Base Sepolia -> Polygon Amoy
- Polygon Amoy -> Base Sepolia
- Ethereum Sepolia -> BSC Testnet
- Ethereum Sepolia -> Polygon Amoy
- BSC Testnet -> Ethereum Sepolia
- Polygon Amoy -> Ethereum Sepolia

Remaining routes:

- Solana Devnet -> Ethereum Sepolia
- Ethereum Sepolia -> Solana Devnet
- Solana Devnet -> BSC Testnet
- BSC Testnet -> Solana Devnet
- Solana Devnet -> Polygon Amoy
- Polygon Amoy -> Solana Devnet

## Operator Runbooks

Primary operator docs:

- `docs/runbooks/bridge-operator-approval-checklist.md`
- `docs/runbooks/bridge-signer-custody.md`
- `docs/runbooks/base-to-solana-settlement-withdraw.md`
- `docs/runbooks/solana-to-base-destination-withdraw.md`
- `docs/bridge/bridge-watcher-challenge-freeze.md`
- `docs/bridge/bridge-production-policy.md`

## Known Limitations

- Testnet-only evidence.
- External audit not complete.
- Environment-file signer custody is not production custody.
- No HSM/KMS/MPC signer custody.
- Signer rotation and governance are not productionized.
- Watcher live freeze execution is not production-approved.
- Durable note-state custody is still operator responsibility.
- `public_data_hash` / bridge-specific circuit binding remains a known limitation.
- Zkey provenance and production artifact ceremony are not formalized.
- Mainnet monitoring, alerting, dashboarding, and incident response remain incomplete.

Internal security review docs:

- `docs/security/PRODUCTION_SECURITY_BASELINE_REVIEW.md`
- `docs/security/API_OPERATOR_ENDPOINT_SECURITY_MATRIX.md`
- `docs/security/SECRET_AND_ARTIFACT_CONTROL_POLICY.md`

## Explicit Out Of Scope

- Mainnet launch approval.
- Production signer custody implementation.
- Mainnet deployment transactions.
- New bridge routes.
- Private env contents, signer keys, wallet files, note-state, witnesses, proof files, zkeys, and operator tokens.
- Legal/compliance approval.

## Questions For Auditors

See `docs/audit/AUDITOR_QUESTIONS.md` for the focused review question list.

## Requested Audit Deliverables

- Findings report with severity, affected module, exploit scenario, and remediation recommendation.
- BridgeMessageV1 domain separation and replay-protection opinion.
- Circuit public-input binding assessment.
- Signer custody and governance recommendations.
- Watcher/freeze operational risk assessment.
- Mainnet blocker disposition table.
- Re-audit requirements after remediation.
