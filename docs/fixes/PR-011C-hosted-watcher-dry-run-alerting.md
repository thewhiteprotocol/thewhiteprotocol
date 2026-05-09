# PR-011C - Hosted Watcher Dry-Run and Alerting

**Date:** 2026-05-09
**Status:** Complete for hosted testnet dry-run rollout

## 1. Summary

PR-011C prepares the bridge watcher for hosted testnet dry-run operation. It keeps the watcher disabled by default, keeps freeze submission disabled, adds optional alert hooks, improves watcher status, and adds retention cleanup for old closed findings.

No contracts, Solana programs, circuits, BridgeMessageV1 layout, deployment artifacts, live E2E routes, or runtime deployments were changed.

## 2. Hosted Dry-Run Mode

Safe defaults:

- `BRIDGE_WATCHER_ENABLED=false`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_ALERT_DRY_RUN=true`

The hosted relayer only starts the daemon when `BRIDGE_WATCHER_ENABLED=true` and `STATE_DIR` is configured. Even then, live freeze submission remains off by default.

## 3. Required Env Vars

Non-secret watcher settings:

- `BRIDGE_WATCHER_ENABLED`
- `BRIDGE_WATCHER_DRY_RUN`
- `BRIDGE_WATCHER_INTERVAL_MS`
- `BRIDGE_WATCHER_FINDINGS_PATH`
- `BRIDGE_WATCHER_MAX_FINDINGS_PER_TICK`
- `BRIDGE_WATCHER_FINDING_RETENTION_DAYS`
- `BRIDGE_WATCHER_AUTO_FREEZE`
- `BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE`
- `BRIDGE_ALERT_MIN_SEVERITY`
- `BRIDGE_ALERT_DRY_RUN`
- `BRIDGE_ALERT_LOG`

Secrets to set in the host dashboard, not in git:

- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_ALERT_WEBHOOK_URL`

## 4. Alerting Hook

Added:

- `relayer/src/bridge/alerts.ts`

Sinks:

- no-op sink by default
- webhook sink when `BRIDGE_ALERT_WEBHOOK_URL` is configured and alert dry-run is false
- log sink when `BRIDGE_ALERT_LOG=true`

Alerting defaults to dry-run and no-op. No real webhook is committed.

## 5. Alert Payload Schema

Payload fields:

- `findingId`
- `severity`
- `code`
- `messageHash`
- `sourceChain`
- `destinationChain`
- `recommendedAction`
- `dryRun`
- `createdAt`
- `evidenceSummary`

The evidence summary is sanitized and can include policy reasons, tx hash, block number, source event kind, confirmations, source/destination domains, canonical asset ID, amount, and nonce.

It does not include private keys, signer keys, RPC URLs, webhook URLs, wallet files, proof witnesses, or private environment contents.

## 6. Alert Thresholds and Dedup

`BRIDGE_ALERT_MIN_SEVERITY` defaults to `high`.

Alert deduplication uses the persisted finding evidence hash. If a finding/evidence pair was already alerted, repeated watcher ticks do not send the same alert again.

## 7. Watcher Status

`GET /bridge/watcher/status` now exposes:

- enabled/running/dry-run/auto-freeze flags
- interval and max findings per tick
- retention days
- counts by severity
- counts by status
- last tick timestamp
- last tick duration
- safe last error text
- alerting enabled/dry-run/min-severity/sink

The status response does not include `BRIDGE_OPERATOR_API_TOKEN` or `BRIDGE_ALERT_WEBHOOK_URL`.

## 8. Finding Retention

Added retention cleanup to `BridgeWatcherFindingStore`.

Default:

- `BRIDGE_WATCHER_FINDING_RETENTION_DAYS=30`

Cleanup behavior:

- old `resolved` findings can be deleted
- old `ignored` findings can be deleted
- open critical findings are never deleted automatically

## 9. Render Deployment Notes

`render.yaml` now includes non-secret watcher dry-run settings:

- watcher disabled
- watcher dry-run enabled
- auto-freeze disabled
- findings path under `/app/data`
- retention set to 30 days
- alert dry-run enabled
- alert min severity high

`BRIDGE_OPERATOR_API_TOKEN` and `BRIDGE_ALERT_WEBHOOK_URL` are listed only as secrets to set in Render, with no values committed.

## 10. Tests Added

Added/extended tests for:

- watcher disabled by default
- dry-run true by default
- hosted config parsing
- no-op alert sink without webhook URL
- webhook alert with sanitized payload
- alert severity threshold
- duplicate alert deduplication
- watcher status hiding secrets
- retention cleanup of old resolved/ignored findings
- retention preserving open critical findings
- `.env.example` required watcher keys
- `render.yaml` required watcher keys

## 11. Commands Run

```text
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
```

Results:

- Relayer tests: 18 suites passed, 262 tests passed
- Typecheck: passed
- Build: passed

## 12. Remaining Limitations

- Testnet dry-run rollout only.
- No runtime deployment was changed.
- No live freeze transaction submission.
- No production signer custody.
- No HSM/KMS/MPC operator custody.
- No external alert webhook has been configured in this PR.
- `public_data_hash` remains weak/dummy-constrained in-circuit.
- Solana -> EVM economic amount normalization remains a follow-up.

## 13. Next Recommended PR

PR-011D - deploy the hosted watcher in testnet dry-run mode, monitor real findings and alert behavior, then define operator custody and live freeze runbooks before any freeze submission is enabled.
