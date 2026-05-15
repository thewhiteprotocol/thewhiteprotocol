# Bridge Watcher Observation Window Runbook

**Date:** 2026-05-15
**Status:** Hosted testnet dry-run only; not production-ready

## 1. Purpose

The observation window is a hosted testnet period where the bridge watcher runs against live relayer state, persists findings, emits dry-run alerts if configured, and generates operator reports. It is meant to validate watcher signal quality and operational procedures before any live freeze execution PR.

## 2. Duration

- Minimum: 24 hours for hosted testnet smoke.
- Preferred: 72 hours before considering live-action work.
- Extend the window if critical/high findings remain open, alert delivery is unreliable, or watcher ticks are failing.

## 3. Required Env Vars

Non-secret values:

- `STATE_DIR=/app/data`
- `BRIDGE_WATCHER_ENABLED=true`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_WATCHER_INTERVAL_MS=30000`
- `BRIDGE_WATCHER_FINDINGS_PATH=/app/data/bridge-watcher-findings.json`
- `BRIDGE_WATCHER_OBSERVATION_WINDOW_HOURS=24`
- `BRIDGE_WATCHER_OBSERVATION_REPORT_PATH=/app/data/bridge-watcher-observation-report.json`
- `BRIDGE_WATCHER_OBSERVATION_LABEL=hosted-testnet-dry-run`
- `BRIDGE_ALERT_MIN_SEVERITY=high`
- `BRIDGE_ALERT_DRY_RUN=true`

Secrets, set only in the host dashboard:

- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_ALERT_WEBHOOK_URL`, optional

## 4. Start Hosted Dry-Run Watcher

1. Configure `BRIDGE_OPERATOR_API_TOKEN` as a secret.
2. Keep `BRIDGE_WATCHER_DRY_RUN=true`.
3. Keep `BRIDGE_WATCHER_AUTO_FREEZE=false`.
4. Deploy with `BRIDGE_WATCHER_ENABLED=true`.
5. Check `/health`.
6. Check watcher status with the operator token.

## 5. Run Smoke

Run locally or as a one-off hosted job:

```bash
cd relayer
npm run watcher:smoke
```

Expected result: six synthetic findings, `dryRun=true`, `autoFreeze=false`, and zero freeze submissions.

## 6. Generate Report

```bash
cd relayer
npm run watcher:report
```

The command reads persisted findings, writes JSON and Markdown reports, and does not use live RPC or submit transactions. The report includes counts by severity, status, route, and code, alert/freeze-preview counts, and `liveFreezeTxCount`.

In dry-run, `liveFreezeTxCount` must be `0`. Any non-zero value is a stop condition.

## 7. Inspect Findings

```bash
curl -fsS \
  -H "Authorization: Bearer $BRIDGE_OPERATOR_API_TOKEN" \
  "https://<relayer-host>/bridge/watcher/findings?limit=50"
```

Useful filters:

- `status=open`
- `severity=critical`
- `severity=high`

## 8. Triage Findings

Use this default escalation policy:

| Severity | Action |
| --- | --- |
| low | Log only. |
| medium | Alert only if repeated. |
| high | Alert immediately and require manual review. |
| critical | Alert immediately, generate freeze preview, require operator review. |
| critical repeated | Freeze recommended, but still dry-run unless a future PR explicitly enables live freeze. |

Ignored and resolved findings must not alert or escalate unless evidence changes.

## 9. Proceed Criteria

Proceed to the live freeze design implementation PR only if:

- observation ran for at least 24h, preferably 72h
- watcher ticks are stable
- reports show `liveFreezeTxCount=0`
- alert payloads are sanitized
- no unresolved critical findings remain without operator notes
- operator API auth remains required
- freeze previews are correct for EVM and Solana targets

## 10. Stop Criteria

Stop rollout if:

- any live freeze tx appears during dry-run
- `BRIDGE_WATCHER_DRY_RUN=false` is found in hosted env
- `BRIDGE_WATCHER_AUTO_FREEZE=true` is found in hosted env
- operator token or webhook URL appears in logs, docs, screenshots, or git
- watcher ticks crash repeatedly
- critical findings recur without a clear source
- report generation fails

## 11. Emergency Process Placeholder

For critical findings:

1. Pause signing for the affected route.
2. Export finding JSON and report output.
3. Generate `freeze-dry-run` preview only.
4. Notify bridge operators.
5. Do not submit live freeze transactions during PR-011E.

## 12. What Not To Do

- Do not set `BRIDGE_WATCHER_AUTO_FREEZE=true`.
- Do not set `BRIDGE_WATCHER_DRY_RUN=false`.
- Do not expose `BRIDGE_OPERATOR_API_TOKEN`.
- Do not commit webhook URLs.
- Do not commit private keys or wallet files.
- Do not call this production-ready.

