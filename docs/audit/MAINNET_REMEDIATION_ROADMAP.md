# Mainnet Remediation Roadmap

This roadmap turns the testnet evidence package into a phased mainnet-readiness plan. It does not authorize mainnet launch.

## Phase A - Audit Handoff Cleanup

Objective: prepare a reviewable, non-secret audit handoff.

Tasks:

- Freeze the audit scope.
- Confirm all evidence links resolve.
- Remove stale or contradictory route status language.
- Provide auditors with testnet deployment artifacts and command summaries.
- Confirm no private env, note-state, witness, proof, zkey, or generated transaction files are included.

Expected outputs:

- `docs/audit/AUDIT_HANDOFF_PACKAGE.md`
- `docs/audit/MAINNET_BLOCKER_REGISTER.md`
- `docs/audit/MAINNET_REMEDIATION_ROADMAP.md`
- `docs/audit/AUDITOR_QUESTIONS.md`
- final evidence index review

Pass / fail criteria:

- Pass: auditors can identify scope, evidence, limitations, and requested deliverables without private artifacts.
- Fail: evidence package requires private state, unclear deployment references, or route status ambiguity.

Dependencies:

- PR-014A evidence package.

Recommended PR sequence:

- PR-014B audit handoff and blocker register.
- PR-014C audit package cleanup after internal review.

## Phase B - Production Signer Custody

Objective: replace testnet env-file signer custody with production-grade custody and governance.

Tasks:

- Select HSM, KMS, MPC, or hardware-backed signer architecture.
- Define signer enrollment, quorum, rotation, removal, and emergency disable procedures.
- Add audit logging and approval records.
- Update guarded submit commands to use production signer adapters.
- Run custody integration tests in staging.

Expected outputs:

- production signer custody design;
- signer rotation runbook;
- custody adapter implementation or integration plan;
- staging evidence for signer recovery and threshold checks.

Pass / fail criteria:

- Pass: no production bridge approval depends on plaintext env-file private keys.
- Fail: signer custody still requires shell-accessible private keys for mainnet.

Dependencies:

- MBR-002, MBR-003, MBR-004, MBR-013.

Recommended PR sequence:

- PR-014D signer custody architecture.
- PR-014E custody adapter implementation.
- PR-014F signer rotation/governance tests.

## Phase C - Circuit Hardening Decision

Objective: remediate or formally accept circuit binding limitations before mainnet.

Tasks:

- Audit deposit, withdraw, batch update, and bridge-specific public inputs.
- Decide whether to modify circuits to bind bridge-specific public data.
- Define zkey provenance and production ceremony.
- Rebuild, verify, and document artifacts if circuits change.
- Update verifier deployment requirements.

Expected outputs:

- circuit limitation disposition;
- zkey provenance/ceremony plan;
- updated circuit artifacts if remediation is chosen;
- auditor sign-off or explicit risk acceptance.

Pass / fail criteria:

- Pass: circuit binding risk is remediated or accepted with auditor-reviewed compensating controls.
- Fail: known binding limitation remains unresolved without acceptance.

Dependencies:

- MBR-010, MBR-011.

Recommended PR sequence:

- PR-014G circuit binding decision record.
- PR-014H circuit/zkey ceremony plan.
- PR-014I circuit remediation if required.

## Phase D - Watcher / Freeze / Monitoring

Objective: productionize live monitoring, alerting, and emergency response.

Tasks:

- Define watcher severity thresholds and live freeze policy.
- Configure production alert sinks.
- Add dashboards for route state, balances, message lifecycle, nullifiers, failed simulations, and signer health.
- Complete incident response and communications runbook.
- Run table-top incident drills.

Expected outputs:

- production watcher policy;
- alerting and dashboard evidence;
- incident response runbook;
- freeze/pause authority matrix.

Pass / fail criteria:

- Pass: operators can detect, escalate, pause/freeze, and communicate incidents under a documented process.
- Fail: critical findings remain dry-run only without approved operational response.

Dependencies:

- MBR-007, MBR-008, MBR-012.

Recommended PR sequence:

- PR-014J watcher production policy.
- PR-014K monitoring dashboards.
- PR-014L incident response runbook and drill report.

## Phase E - Mainnet Deployment Readiness

Objective: define exactly what can launch on mainnet and prove deployment safety.

Tasks:

- Freeze launch route scope.
- Decide whether remaining Solana routes are launch blockers or out of scope.
- Finalize route caps, asset allowlists, pause controls, and governance.
- Produce mainnet deployment plan with artifact checksums.
- Verify deployment artifacts and explorer source verification.
- Run staging/mainnet-fork dry runs.

Expected outputs:

- route launch scope;
- mainnet deployment checklist;
- verified artifacts;
- cap/governance approval record;
- staging or fork test evidence.

Pass / fail criteria:

- Pass: every launch route has explicit caps, assets, governance, deployment artifact verification, and test evidence.
- Fail: launch scope includes unproven routes or unverified artifacts.

Dependencies:

- MBR-005, MBR-006, MBR-014, MBR-015.

Recommended PR sequence:

- PR-014M launch route scope.
- PR-014N deployment artifact verification.
- PR-014O mainnet-fork readiness.

## Phase F - Controlled Mainnet Beta

Objective: launch only after audit, custody, circuits, monitoring, and deployment readiness are complete.

Tasks:

- Apply low caps and staged route activation.
- Run operator approval with production custody.
- Monitor first messages and withdrawals.
- Maintain rollback/pause readiness.
- Publish post-launch evidence package.

Expected outputs:

- controlled beta launch report;
- production route evidence;
- monitoring and incident status;
- post-launch blocker register update.

Pass / fail criteria:

- Pass: beta executes under approved caps with monitoring, custody, and rollback readiness.
- Fail: any critical blocker remains open or launch scope differs from approved plan.

Dependencies:

- Phases A-E complete.

Recommended PR sequence:

- PR-015A controlled beta checklist.
- PR-015B first-route beta execution.
- PR-015C post-launch evidence and blocker update.
