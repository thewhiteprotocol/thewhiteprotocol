# PR-011E - Watcher Observation Window and Freeze Execution Design

**Date:** 2026-05-15
**Status:** Complete; local validation passed

## 1. Summary

PR-011E prepares the hosted testnet bridge watcher for a dry-run observation window and documents the future freeze execution path. It adds offline observation summaries, a report command, escalation policy helpers, dry-run safeguard tests, and operator documentation.

No live freeze transaction submission is enabled.

## 2. What PR-011D Completed

PR-011D added offline watcher smoke mode, deterministic synthetic findings, alert failure retry/no-crash behavior, hosted dry-run runbook updates, and verified smoke behavior with zero freeze submissions.

## 3. Observation Window Model

Added `relayer/src/bridge/observation.ts` with:

- observation label
- time range and duration
- watcher mode
- dry-run and auto-freeze status
- chains and routes monitored
- tick count and last tick metadata
- findings by severity, status, route, and code
- repeated finding counts
- alert counts
- freeze preview counts
- live freeze tx count
- dry-run violation flag

## 4. Observation Report Command

Added:

```bash
cd relayer
npm run watcher:report
```

The command reads persisted watcher findings and writes sanitized JSON and Markdown reports. It requires no live RPC and submits no transactions.

## 5. Escalation Policy

Added pure helpers:

- `determineEscalation`
- `shouldAlert`
- `shouldGenerateFreezePreview`
- `shouldRequireManualReview`

Policy:

- low: log only
- medium: alert if repeated
- high: alert immediately and require manual review
- critical: alert immediately, generate freeze preview, require operator review
- critical repeated: freeze recommended, but live execution remains blocked in dry-run

## 6. Dry-Run Safeguards

Tests cover:

- live freeze count remains zero in dry-run reports
- dry-run flags any non-zero live freeze tx count
- auto-freeze with dry-run still does not call `submitFreeze`
- smoke findings remain dry-run only
- reports omit evidence payloads and do not leak tokens or webhook URLs
- config defaults are safe

## 7. Freeze Execution Design

Created `docs/bridge/freeze-execution-design.md` covering:

- preconditions for live freeze
- EVM `freezeMessage(bytes32)` path
- Solana `freeze_bridge_v1_message` path
- operator approval flow
- failure modes
- audit log requirements
- why PR-011E does not enable live freeze

## 8. Runbook Updates

Created `docs/runbooks/bridge-watcher-observation-window.md` with:

- 24h minimum and 72h preferred observation window
- required env vars
- hosted dry-run startup
- smoke command
- report command
- finding inspection and triage
- escalation policy
- proceed/stop criteria
- emergency process placeholder
- explicit "what not to do" list

Updated existing watcher docs to reference observation reporting and freeze design.

## 9. Tests Added

Added `relayer/src/bridge/__tests__/observation.test.ts` for observation summaries, report sanitization, escalation policy, smoke report coverage, dry-run freeze guarantees, and safe config defaults.

## 10. Commands Run

```bash
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
cd relayer && npm run watcher:report
```

Additional report validation used a fixed smoke state directory:

```bash
cd relayer
BRIDGE_WATCHER_SMOKE_STATE_DIR=/tmp/pr011e-smoke-state npm run watcher:smoke
STATE_DIR=/tmp/pr011e-smoke-state BRIDGE_WATCHER_OBSERVATION_REPORT_PATH=/tmp/pr011e-smoke-state/bridge-watcher-observation-report.json npm run watcher:report
```

## 11. Passing/Failing Results

- Relayer tests: 20 suites / 281 tests passed.
- Typecheck: passed.
- Build: passed.
- Watcher smoke: passed, 6 findings / 0 freeze submissions.
- Watcher report: passed, including smoke-backed report with 6 findings and `liveFreezeTxCount=0`.

## 12. Remaining Limitations

- Testnet dry-run only.
- No live freeze transaction submission.
- No production signer custody.
- No HSM/KMS/MPC integration.
- `public_data_hash` remains weak/dummy-constrained in-circuit.
- Observation quality depends on hosted state persistence and adapter coverage.

## 13. Next Recommended PR

PR-011F - signer custody adapter interface:

- local-dev signer
- env/file signer
- KMS/HSM placeholder
- MPC placeholder
- signer policy tests
- no production keys committed
