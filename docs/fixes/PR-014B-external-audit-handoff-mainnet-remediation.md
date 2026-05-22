# PR-014B - External Audit Handoff And Mainnet Remediation

## Summary

PR-014B converts the PR-014A testnet bridge evidence package into a concrete external audit handoff and mainnet blocker remediation roadmap.

No bridge flows, proof generation, transaction submission, contract changes, Solana program changes, or circuit changes were performed.

## Files Created

- `docs/audit/AUDIT_HANDOFF_PACKAGE.md`
- `docs/audit/MAINNET_BLOCKER_REGISTER.md`
- `docs/audit/MAINNET_REMEDIATION_ROADMAP.md`
- `docs/audit/AUDITOR_QUESTIONS.md`
- `docs/fixes/PR-014B-external-audit-handoff-mainnet-remediation.md`

## Mainnet Blocker Categories

The blocker register currently tracks 15 blockers:

- external audit;
- production signer custody;
- HSM/KMS/MPC;
- signer rotation and governance;
- deployment artifact verification;
- route caps and governance;
- watcher live freeze and alerting;
- incident response;
- note-state custody;
- zkey provenance;
- bridge-specific circuit binding;
- monitoring dashboard;
- secret/env management;
- remaining Solana routes;
- legal/compliance route policy.

Severity counts:

- Critical: 6
- High: 7
- Medium: 2

## Audit Scope

The audit handoff package scopes EVM contracts, Solana programs, BridgeMessageV1 encoding, ZK circuits and artifacts, relayer policy, watcher modules, operational runbooks, and testnet route evidence.

Explicitly out of scope:

- mainnet launch approval;
- production custody implementation;
- mainnet deployment transactions;
- new bridge routes;
- private operator material;
- legal/compliance approval.

## Remediation Phases

The roadmap groups remediation into:

- Phase A - audit handoff cleanup;
- Phase B - production signer custody;
- Phase C - circuit hardening decision;
- Phase D - watcher/freeze/monitoring;
- Phase E - mainnet deployment readiness;
- Phase F - controlled mainnet beta.

Each phase records objective, tasks, expected outputs, pass/fail criteria, dependencies, and recommended PR sequence.

## No-Secret Scan Result

PR-014B documentation files were scanned for obvious forbidden committed artifacts and secret patterns. No PR-014B-scoped secret/artifact issue was found.

The repository still has historical tracked test artifacts and placeholder names that broad pattern scans flag, including tracked zkey paths and test/helper field names. PR-014B did not add those artifacts and did not stage them.

## Tests Run

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- Mainnet is not ready.
- External audit is not complete.
- Production signer custody is not implemented.
- Watcher live freeze execution is not production-approved.
- Durable note-state custody remains an operator process.
- Zkey provenance and production artifact ceremony remain open.
- `public_data_hash` / bridge-specific circuit binding remains a known limitation.
- Remaining Solana <-> non-Base EVM routes are not proven.

## Next Recommended PR

PR-014C - internal audit handoff review cleanup: resolve link drift, assign blocker owners, decide launch route scope, and prepare the external auditor data room without private artifacts.
