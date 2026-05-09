# PR-011D - Hosted Watcher Dry-Run Smoke and Alert Monitoring

**Date:** 2026-05-09
**Status:** Complete for testnet dry-run rollout readiness

## 1. Summary

PR-011D adds an offline watcher smoke path, deterministic synthetic bridge-risk fixtures, alert failure retry coverage, and an operator runbook for hosted testnet dry-run rollout.

No contracts, Solana programs, circuits, BridgeMessageV1 consensus layout, mainnet config, runtime deployments, or live freeze transactions were changed.

## 2. PR-011C Baseline

PR-011C completed:

- hosted dry-run watcher config
- no-op/dry-run alerting defaults
- sanitized alert payloads
- watcher status endpoint expansion
- finding retention cleanup
- `render.yaml` and `.env.example` hosted placeholders
- tests for alerting/status/retention/config

## 3. Smoke-Test Design

Added:

- `relayer/src/bridge/watcher-smoke.ts`
- `npm run watcher:smoke`

The smoke runner:

- uses no live RPC
- sends no real webhook by default
- enables the watcher only inside the smoke process
- keeps `dryRun=true`
- keeps `autoFreeze=false`
- injects synthetic source observations
- persists findings to a temp directory or `BRIDGE_WATCHER_SMOKE_STATE_DIR`
- builds a freeze dry-run preview
- verifies no freeze transaction submission happened

## 4. Synthetic Findings

Added deterministic fixtures in `relayer/src/bridge/watcher-smoke-fixtures.ts` for:

- unsafe Solana `init_bridge_v1_out`
- amount over cap
- expired deadline
- unsupported asset
- not-final source event
- cross-decimal mismatch

These fixtures are test-only and contain no secrets.

## 5. Alert Behavior

Alert behavior now covers:

- no-op behavior when no webhook is configured
- dry-run marker in alert payloads
- severity threshold handling
- deduplication by finding evidence hash
- failed webhook sends returning `alert_failed` instead of crashing the watcher
- retry on repeated ticks when a previous webhook send failed

Alert payloads remain sanitized and do not include keys, RPC secrets, webhook URLs, wallet files, or witness data.

## 6. Hosted Dry-Run Rollout Steps

The hosted rollout remains dry-run only:

1. Set `BRIDGE_OPERATOR_API_TOKEN` as a secret.
2. Optionally set `BRIDGE_ALERT_WEBHOOK_URL` as a secret.
3. Set `BRIDGE_WATCHER_ENABLED=true`.
4. Keep `BRIDGE_WATCHER_DRY_RUN=true`.
5. Keep `BRIDGE_WATCHER_AUTO_FREEZE=false`.
6. Check `/bridge/watcher/status` with the operator token.
7. Review findings and alerts.
8. Do not submit freeze transactions.

## 7. Operator API Usage

The runbook documents:

- `GET /bridge/watcher/status`
- `GET /bridge/watcher/findings`
- `GET /bridge/watcher/findings/:id`
- `POST /bridge/watcher/findings/:id/ack`
- `POST /bridge/watcher/findings/:id/ignore`
- `POST /bridge/watcher/findings/:id/freeze-dry-run`
- `POST /bridge/watcher/tick`

All watcher routes require `BRIDGE_OPERATOR_API_TOKEN`.

## 8. Render Notes

`render.yaml` keeps:

- `BRIDGE_WATCHER_ENABLED=false`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- alert dry-run enabled
- findings path under `/app/data`

Comments now state that dry-run rollout requires setting the operator token secret first and keeping auto-freeze disabled.

## 9. Tests Added

Added `relayer/src/bridge/__tests__/watcher-smoke.test.ts` for:

- smoke fixture generation
- smoke runner persistence and dry-run behavior
- synthetic unsafe Solana event finding
- no-op alert sink in smoke mode
- failed webhook retry/no-crash behavior
- authenticated status after smoke tick
- retention cleanup with synthetic findings

## 10. Commands Run

```text
cd relayer && npm test -- watcher-smoke.test.ts --runInBand
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
```

Results are recorded in the terminal summary for this PR.

Observed results:

- Targeted smoke tests: 1 suite passed, 7 tests passed
- Relayer tests: 19 suites passed, 269 tests passed
- Typecheck: passed
- Build: passed
- Smoke command: passed with 6 synthetic findings and 0 freeze submissions

## 11. Remaining Limitations

- Testnet dry-run only.
- No runtime deployment was changed.
- No live freeze transaction submission.
- No auto-freeze.
- No production signer custody.
- No HSM/KMS/MPC custody.
- No mainnet finality model.
- `public_data_hash` remains weak/dummy-constrained in-circuit.
- Solana -> EVM economic normalization remains a follow-up.

## 12. Next Recommended PR

PR-011E - hosted testnet watcher dry-run rollout observation window, operator alert review, and freeze execution design without enabling live freeze by default.
