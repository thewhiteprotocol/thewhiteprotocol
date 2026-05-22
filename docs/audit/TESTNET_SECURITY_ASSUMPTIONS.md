# Testnet Security Assumptions

## Scope

This document describes the assumptions behind the current testnet bridge evidence package. It is not a mainnet security claim.

Related audit handoff docs:

- `docs/audit/AUDIT_HANDOFF_PACKAGE.md`
- `docs/audit/MAINNET_BLOCKER_REGISTER.md`
- `docs/audit/MAINNET_REMEDIATION_ROADMAP.md`
- `docs/audit/AUDITOR_QUESTIONS.md`

## Testnet-Only Status

All lifecycle evidence is from Solana Devnet, Base Sepolia, Ethereum Sepolia, BSC Testnet, and Polygon Amoy. Testnet deployments, keys, RPCs, funds, and operational practices are not production controls.

## Signer Set

- Testnet bridge approvals use a deployed threshold signer set.
- Current Base destination evidence uses a 2-of-3 signer threshold.
- Environment-file signer custody is acceptable only for testnet evidence.
- No HSM, KMS, MPC, hardware wallet ceremony, or production key rotation process is active yet.

## Watcher And Freeze

- Watcher policy, dry-run reports, challenge/freeze design, and hosted readiness endpoints exist.
- Live watcher-triggered freeze execution is not enabled as a production control.
- Watcher findings must be reviewed before mainnet route activation.

## Note-State Custody

- Destination note-state is operator responsibility.
- Note-state contains private destination note material and must remain outside git.
- Durable note-state backup gates are required before guarded Solana -> Base submit.
- Missing note-state can make a destination commitment unrecoverable for withdrawal.

## ZK Artifacts

- Zkeys are operational artifacts, not source-controlled artifacts.
- Hosted zkeys must live on persistent storage and pass checksum verification before use.
- Witnesses and generated proof files must not be committed.

## Circuit Limitations

- `public_data_hash` / bridge-specific circuit binding remains a known limitation.
- Current evidence proves testnet lifecycle behavior, not full production circuit hardening.
- External audit must review deposit, withdrawal, batch update, and bridge-specific proof semantics.

## Deadline And Finality Policy

- Expired messages are rejected.
- Source finality is required before paper replay/signing.
- Operator approval re-runs read-only destination checks and simulation before live submit.

## Amount Normalization

- Solana -> Base uses exact 9-to-18 decimal normalization.
- Cross-decimal mismatches are watcher findings and policy blockers.
- Route caps and asset support checks are enforced before destination submit.

## Solana Source Binding

- Solana source bridge messages must use `bridge_out_v1_with_proof`.
- Unsafe `init_bridge_v1_out` source events are rejected by relayer policy.
- Source-bound proof, spent nullifier, and value-lock evidence are required for Solana source flows.

## Duplicate Protection

- Destination submit is protected by consumed-message checks.
- Destination withdraw is protected by spent-nullifier checks.
- Operator no-op status maps already-withdrawn destinations to `no_action_already_complete`.

## Mainnet Readiness

Mainnet remains blocked on production custody, external audit, deployment verification, incident runbooks, alerting, route caps, pause/freeze governance, and remediation or acceptance of known circuit limitations. The tracked blocker register is `docs/audit/MAINNET_BLOCKER_REGISTER.md`.
