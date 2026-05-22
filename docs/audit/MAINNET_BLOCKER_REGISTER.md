# Mainnet Blocker Register

This register tracks blockers that must be remediated or explicitly accepted before any mainnet launch claim. Owner is intentionally a placeholder until assigned by the project team.

| Blocker ID | Category | Severity | Status | Description | Risk If Unresolved | Required Remediation | Owner | Evidence / Doc Link | Recommended PR / Phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MBR-001 | External audit | Critical | Open | External security audit has not been completed. | Undetected protocol, custody, circuit, or operations defects could reach mainnet. | Complete external audit, triage findings, remediate, and obtain sign-off or risk acceptance. | TBD by project team | `docs/audit/EXTERNAL_AUDIT_CHECKLIST.md` | Phase A |
| MBR-002 | Signer custody | Critical | Open | Production signer custody is missing. | Env-file keys can be copied, lost, or misused. | Define production custody architecture and migration plan. | TBD by project team | `docs/runbooks/bridge-signer-custody.md` | Phase B |
| MBR-003 | HSM/KMS/MPC | Critical | Open | HSM/KMS/MPC is not implemented. | Threshold approvals may depend on non-production key storage. | Implement HSM/KMS/MPC or equivalent reviewed custody. | TBD by project team | `docs/audit/TESTNET_SECURITY_ASSUMPTIONS.md` | Phase B |
| MBR-004 | Signer governance | High | Open | Signer rotation, emergency removal, and governance procedures are not productionized. | Compromised or stale signer sets could keep approval authority. | Add rotation ceremony, approval policy, audit log, and emergency runbook. | TBD by project team | `docs/audit/AUDIT_HANDOFF_PACKAGE.md` | Phase B |
| MBR-005 | Deployment artifacts | Critical | Open | Mainnet deployment artifacts are not produced or verified. | Users may interact with unverified or misconfigured contracts/program IDs. | Produce deterministic deployment package, explorer verification, and artifact checksums. | TBD by project team | `docs/audit/EXTERNAL_AUDIT_CHECKLIST.md` | Phase E |
| MBR-006 | Route caps / governance | High | Open | Mainnet caps, route activation, and governance policy are not finalized. | Routes may expose too much value or unsupported assets. | Define per-route caps, asset allowlist, pause authority, and activation checklist. | TBD by project team | `docs/bridge/solana-evm-bridge-route-matrix.md` | Phase E |
| MBR-007 | Watcher live freeze | High | Open | Watcher live freeze and alerting posture are not production-approved. | Critical findings may not halt unsafe messages quickly enough. | Decide dry-run vs live freeze policy, alert routing, escalation, and emergency authority. | TBD by project team | `docs/bridge/bridge-watcher-challenge-freeze.md` | Phase D |
| MBR-008 | Incident response | High | Open | Incident response runbook is missing or incomplete for mainnet bridge operations. | Operators may respond inconsistently during compromise, stuck messages, or chain incidents. | Add incident runbook with roles, thresholds, communications, freeze/pause playbooks, and recovery steps. | TBD by project team | `docs/runbooks/bridge-operator-approval-checklist.md` | Phase D |
| MBR-009 | Note-state custody | Critical | Open | Production note-state custody process is not formalized. | Missing note-state can make commitments unrecoverable; leaked note-state can compromise privacy/funds. | Define encrypted storage, backup, access control, restore test, and no-log policy. | TBD by project team | `docs/runbooks/solana-to-base-destination-withdraw.md` | Phase B |
| MBR-010 | Zkey provenance | High | Open | Zkey provenance and production artifact ceremony are not formalized. | Incorrect or untrusted proving keys may invalidate security assumptions. | Define trusted setup/provenance record, checksums, storage, rotation, and deployment verification. | TBD by project team | `docs/audit/TESTNET_SECURITY_ASSUMPTIONS.md` | Phase C |
| MBR-011 | Circuit binding | Critical | Open | `public_data_hash` / bridge-specific circuit binding remains a known limitation. | Proofs may not bind all bridge-specific public data as strongly as required for mainnet. | Remediate circuit binding or obtain explicit audited risk acceptance with compensating controls. | TBD by project team | `docs/audit/TESTNET_SECURITY_ASSUMPTIONS.md` | Phase C |
| MBR-012 | Monitoring dashboard | High | Open | Mainnet monitoring/dashboard is missing. | Operators may miss stuck queues, failed proofs, signer failures, or watcher findings. | Add dashboards for routes, message states, nullifiers, balances, alerts, and liveness. | TBD by project team | `docs/audit/AUDIT_HANDOFF_PACKAGE.md` | Phase D |
| MBR-013 | Secret / env management | Critical | Open | Mainnet secret/env management is not formalized. | RPC keys, private keys, tokens, or note material could leak through logs, deploys, or shells. | Define secret manager, redaction policy, access controls, rotation, and audit logging. | TBD by project team | `docs/evidence/TESTNET_BRIDGE_EVIDENCE_INDEX.md` | Phase B |
| MBR-014 | Remaining Solana routes | Medium | Open | Solana <-> Ethereum, BNB, and Polygon routes are not proven. | Launch scope may exceed tested route evidence. | Either prove routes before launch or exclude them from launch scope. | TBD by project team | `docs/bridge/solana-evm-bridge-route-matrix.md` | Phase E |
| MBR-015 | Legal / compliance route policy | Medium | Open | Legal/compliance policy for route support is not defined. | Unsupported jurisdictions/assets or route policies may create operational risk. | Define route policy, asset policy, compliance review, and documented launch constraints. | TBD by project team | `docs/audit/AUDIT_HANDOFF_PACKAGE.md` | Phase E |

## Severity Counts

- Critical: 6
- High: 7
- Medium: 2

## Launch Rule

No blocker with `Critical` or `High` severity should remain open for mainnet launch unless there is a written risk acceptance approved by the project team and auditors.
