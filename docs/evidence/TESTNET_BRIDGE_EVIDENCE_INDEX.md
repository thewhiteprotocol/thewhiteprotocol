# Testnet Bridge Evidence Index

## Executive Summary

This index packages non-secret testnet evidence for external review, technical diligence, audit preparation, and internal QA. It covers the private bridge work proven across EVM testnets, Base Sepolia -> Solana Devnet, and Solana Devnet -> Base Sepolia.

The evidence demonstrates guarded source/destination flows, source-bound Solana `bridge_out_v1_with_proof`, exact decimal normalization, deployed signer-set validation, durable note-state gates, paper-mode approval, guarded one-shot submit, withdraw proof/simulation, duplicate submit rejection, duplicate withdraw rejection, and already-withdrawn no-op operator status.

No mainnet readiness claim is made.

## Route Matrix

| Route | Status | Primary Evidence |
| --- | --- | --- |
| Base Sepolia -> Solana Devnet | Complete | `docs/fixes/PR-012W-base-to-solana-hosted-flow-finalized.md` |
| Solana Devnet -> Base Sepolia | Complete | `docs/fixes/PR-013T-solana-to-base-lifecycle-final-evidence.md` |
| Base Sepolia -> Ethereum Sepolia | Complete | `docs/fixes/PR-010I-base-to-ethereum-full-bridge-e2e.md` |
| Ethereum Sepolia -> Base Sepolia | Complete | `docs/fixes/PR-010K-ethereum-to-base-full-bridge-e2e.md` |
| Base Sepolia -> BSC Testnet | Complete | `docs/fixes/PR-010O-bnb-polygon-to-base-bridge-e2e.md` |
| BSC Testnet -> Base Sepolia | Complete | `docs/fixes/PR-010O-bnb-polygon-to-base-bridge-e2e.md` |
| Base Sepolia -> Polygon Amoy | Complete | `docs/fixes/PR-010O-bnb-polygon-to-base-bridge-e2e.md` |
| Polygon Amoy -> Base Sepolia | Complete | `docs/fixes/PR-010O-bnb-polygon-to-base-bridge-e2e.md` |
| Ethereum Sepolia -> BSC Testnet | Complete | `docs/fixes/PR-010P-ethereum-to-bnb-polygon-bridge-e2e.md` |
| Ethereum Sepolia -> Polygon Amoy | Complete | `docs/fixes/PR-010P-ethereum-to-bnb-polygon-bridge-e2e.md` |
| BSC Testnet -> Ethereum Sepolia | Complete | `docs/fixes/PR-010Q-bnb-polygon-to-ethereum-bridge-e2e.md` |
| Polygon Amoy -> Ethereum Sepolia | Complete | `docs/fixes/PR-010Q-bnb-polygon-to-ethereum-bridge-e2e.md` |
| Solana Devnet -> Ethereum Sepolia | Future | Not yet run |
| Ethereum Sepolia -> Solana Devnet | Future | Not yet run |
| Solana Devnet -> BNB Testnet | Future | Not yet run |
| BNB Testnet -> Solana Devnet | Future | Not yet run |
| Solana Devnet -> Polygon Amoy | Future | Not yet run |
| Polygon Amoy -> Solana Devnet | Future | Not yet run |

## Completed Routes

- EVM <-> EVM testnet routes listed above.
- Base Sepolia -> Solana Devnet hosted operator lifecycle.
- Solana Devnet -> Base Sepolia full lifecycle through Base destination withdraw.

## Partially Completed Routes

- Historical Solana -> Base messages from earlier PRs are preserved as blocked/fail-closed evidence where deadlines expired or note-state was unavailable. These are not live-submit candidates.

## Not Yet Proven Routes

- Solana -> Ethereum
- Ethereum -> Solana
- Solana -> BNB
- BNB -> Solana
- Solana -> Polygon
- Polygon -> Solana

## Evidence Links

- Route matrix: `docs/bridge/solana-evm-bridge-route-matrix.md`
- Security assumptions: `docs/audit/TESTNET_SECURITY_ASSUMPTIONS.md`
- External audit checklist: `docs/audit/EXTERNAL_AUDIT_CHECKLIST.md`
- Audit handoff package: `docs/audit/AUDIT_HANDOFF_PACKAGE.md`
- Mainnet blocker register: `docs/audit/MAINNET_BLOCKER_REGISTER.md`
- Mainnet remediation roadmap: `docs/audit/MAINNET_REMEDIATION_ROADMAP.md`
- Auditor question list: `docs/audit/AUDITOR_QUESTIONS.md`
- Production security baseline: `docs/security/PRODUCTION_SECURITY_BASELINE_REVIEW.md`
- API/operator endpoint matrix: `docs/security/API_OPERATOR_ENDPOINT_SECURITY_MATRIX.md`
- Secret and artifact policy: `docs/security/SECRET_AND_ARTIFACT_CONTROL_POLICY.md`
- Bridge message format: `docs/bridge/private-bridge-message-format.md`
- Bridge production policy: `docs/bridge/bridge-production-policy.md`
- Watcher/freeze design: `docs/bridge/bridge-watcher-challenge-freeze.md`
- Signer custody runbook: `docs/runbooks/bridge-signer-custody.md`
- Operator approval checklist: `docs/runbooks/bridge-operator-approval-checklist.md`
- Base -> Solana runbook: `docs/runbooks/base-to-solana-settlement-withdraw.md`
- Solana -> Base destination withdraw runbook: `docs/runbooks/solana-to-base-destination-withdraw.md`

## Security Assumptions

- Testnet evidence only.
- Deployed testnet signer sets are trusted for test evidence.
- Environment-file signer custody is not production custody.
- Durable note-state is operator-controlled sensitive material and must remain outside git.
- Zkeys are operational artifacts and must be checksum-verified on persistent storage.
- Watcher/freeze evidence is dry-run/readiness evidence unless explicitly stated otherwise.

## Known Limitations

- No mainnet custody design is finalized.
- No HSM/KMS/MPC signer integration is active.
- `public_data_hash` / bridge-specific circuit binding remains a known circuit limitation.
- Remaining Solana <-> non-Base EVM routes are not yet proven.
- External auditors must review contracts, Solana programs, circuits, relayer policy, and operator runbooks before mainnet.

## Mainnet Blockers

- Production signer custody.
- Production note-state custody and recovery process.
- Mainnet deployment/verification package.
- External security audit and remediation.
- Mainnet-specific route caps, pause/freeze playbooks, alerting, and incident response.
- Watcher/freeze live execution review.
- Circuit limitation remediation or explicit risk acceptance.

## Redaction / No-Secret Policy

The evidence package must not include note secrets, nullifier secrets, witnesses, private keys, signer keys, wallet files, RPC URLs with keys, operator tokens, zkeys, proof files, or private env contents. Durable operator artifacts under `/data` or `/workspaces/thewhiteprotocol-operator-data` are referenced by path only and are not committed.
