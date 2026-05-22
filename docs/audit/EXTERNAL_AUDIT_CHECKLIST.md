# External Audit Checklist

Related handoff docs:

- `docs/audit/AUDIT_HANDOFF_PACKAGE.md`
- `docs/audit/MAINNET_BLOCKER_REGISTER.md`
- `docs/audit/MAINNET_REMEDIATION_ROADMAP.md`
- `docs/audit/AUDITOR_QUESTIONS.md`
- `docs/security/PRODUCTION_SECURITY_BASELINE_REVIEW.md`
- `docs/security/API_OPERATOR_ENDPOINT_SECURITY_MATRIX.md`
- `docs/security/SECRET_AND_ARTIFACT_CONTROL_POLICY.md`

## 1. Contracts

- Review `WhiteProtocol` deposit, withdraw, bridge mint, bridge withdraw, root, nullifier, and asset registry flows.
- Review `BridgeInbox` signature verification, signer set versioning, route enable/pause, asset support, amount caps, consumed message protection, and freeze behavior.
- Review `BridgeOutbox` source message construction and event semantics.
- Confirm deployment artifacts match source and are explorer-verified before mainnet.

## 2. Solana Program

- Review `bridge_out_v1_with_proof` source binding.
- Review `accept_bridge_v1_mint`, signer-set checks, frozen-message lifecycle, PDA derivations, and settlement/withdraw flows.
- Confirm `init_bridge_v1_out` cannot be used as trusted production source evidence.

## 3. BridgeMessageV1 Encoding

- Review cross-language encoding parity.
- Review domain separation, chain IDs, asset IDs, amount normalization, deadlines, nonces, roots, nullifiers, commitments, memo hashes, and reserved fields.
- Confirm golden vectors cover Base/EVM and Solana routes.

## 4. ZK Circuits

- Review deposit, withdraw, batch update, and bridge source/destination public inputs.
- Review `public_data_hash` / bridge-specific binding limitation.
- Review zkey provenance, checksum verification, and operational storage requirements.

## 5. Relayer Policy

- Review paper/live-testnet daemon mode.
- Review finality, deadline, route, asset, cap, watcher, signer, simulation, and idempotency gates.
- Review Solana source policy requiring `bridge_out_v1_with_proof`.
- Review guarded one-shot submit commands and approved-hash scoping.

## 6. Watcher

- Review watcher findings, severity policy, dry-run alerting, freeze preview, and hosted readiness endpoint.
- Confirm watcher live freeze execution is either disabled with explicit risk acceptance or production-hardened before mainnet.

## 7. Signer Custody

- Review current testnet env-file signer custody.
- Define production custody requirements: HSM/KMS/MPC/hardware wallet, rotation, quorum, audit logs, and emergency key removal.

## 8. Note-State Custody

- Review durable note-state backup gate.
- Confirm note-state never enters git, logs, reports, or public artifacts.
- Review recovery/no-op classification for already-withdrawn or unrecoverable notes.

## 9. Operational Runbooks

- Review bridge operator approval checklist.
- Review Base -> Solana settlement/withdraw runbook.
- Review Solana -> Base destination withdraw runbook.
- Review hosted startup/zkey/bootstrap/readiness procedures.

## 10. Deployment Artifacts

- Confirm testnet deployment artifacts are complete and non-secret.
- Define mainnet artifact verification requirements.
- Confirm no private env files, RPC keys, signer keys, wallet files, note-state, witnesses, proofs, or zkeys are committed.

## 11. Tests

- Review EVM contract tests.
- Review Solana Rust tests.
- Review relayer tests, watcher smoke/report, signer recovery, approval, submit, note-state, and no-op status tests.
- Review cross-chain E2E reports and blocked/fail-closed evidence.

## 12. Mainnet Blockers

- External audit complete and remediated.
- Production signer custody complete.
- Mainnet deployment and explorer verification complete.
- Mainnet route caps and governance approved.
- Production watcher/freeze/alerting posture approved.
- Note-state custody and recovery process approved.
- Circuit limitations remediated or explicitly accepted.
- Blocker status reviewed against `docs/audit/MAINNET_BLOCKER_REGISTER.md`.
- Backend/API production baseline reviewed against `docs/security/PRODUCTION_SECURITY_BASELINE_REVIEW.md`.
