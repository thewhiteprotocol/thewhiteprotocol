# Bridge Watcher Dry-Run Runbook

**Date:** 2026-05-09
**Status:** Testnet dry-run only; not production-ready

## 1. Purpose

This runbook describes how to run the bridge watcher in hosted testnet dry-run mode, verify smoke behavior, inspect findings, and respond to alerts without submitting freeze transactions.

## 2. Safety Defaults

Keep these defaults unless a follow-up PR explicitly changes the rollout plan:

- `BRIDGE_WATCHER_ENABLED=false`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_ALERT_DRY_RUN=true`
- no live freeze transaction executor

Do not enable auto-freeze or live freeze submission during PR-011D rollout.

## 3. Required Env Vars

Set non-secret hosted values:

- `BRIDGE_WATCHER_ENABLED=true` for dry-run rollout
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_WATCHER_INTERVAL_MS=30000`
- `BRIDGE_WATCHER_FINDINGS_PATH=/app/data/bridge-watcher-findings.json`
- `BRIDGE_WATCHER_MAX_FINDINGS_PER_TICK=100`
- `BRIDGE_WATCHER_FINDING_RETENTION_DAYS=30`
- `BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE=critical`
- `BRIDGE_ALERT_MIN_SEVERITY=high`
- `BRIDGE_ALERT_DRY_RUN=true`

Set secrets only in the host dashboard:

- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_ALERT_WEBHOOK_URL`, optional

Never commit token or webhook values.

## 4. Enable Hosted Dry-Run

1. Configure `BRIDGE_OPERATOR_API_TOKEN` as a secret.
2. Keep `BRIDGE_WATCHER_DRY_RUN=true`.
3. Keep `BRIDGE_WATCHER_AUTO_FREEZE=false`.
4. Set `BRIDGE_WATCHER_ENABLED=true`.
5. Deploy the relayer service through the normal host process.
6. Check `/health`.
7. Check watcher status with the operator token.

## 5. Webhook Alerts

Webhook alerts are optional. When configured:

- keep `BRIDGE_ALERT_DRY_RUN=true` during initial rollout
- use `BRIDGE_ALERT_MIN_SEVERITY=high` or `critical`
- verify payloads are sanitized before connecting a shared operations channel
- failed webhook sends must not stop watcher ticks

Alert payloads include finding metadata, chain/route, severity, action, dry-run marker, and a sanitized evidence summary. They do not include secrets, RPC URLs, wallet files, keys, or proof witness data.

## 6. Check Status

Use:

```bash
curl -fsS \
  -H "Authorization: Bearer $BRIDGE_OPERATOR_API_TOKEN" \
  https://<relayer-host>/bridge/watcher/status
```

Expected safe fields:

- `enabled`
- `running`
- `dryRun`
- `autoFreeze`
- `intervalMs`
- `findingsBySeverity`
- `findingsByStatus`
- `lastTickAt`
- `lastTickDurationMs`
- `alerting.enabled`
- `alerting.minSeverity`
- `alerting.sink`

The response must not include the operator token or webhook URL.

## 7. List Findings

Use:

```bash
curl -fsS \
  -H "Authorization: Bearer $BRIDGE_OPERATOR_API_TOKEN" \
  "https://<relayer-host>/bridge/watcher/findings?limit=50"
```

Useful filters:

- `status=open`
- `severity=critical`
- `severity=high`

## 8. Acknowledge Findings

Use acknowledgement only after the finding has been reviewed:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $BRIDGE_OPERATOR_API_TOKEN" \
  https://<relayer-host>/bridge/watcher/findings/<findingId>/ack
```

Use ignore only for confirmed false positives in testnet:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $BRIDGE_OPERATOR_API_TOKEN" \
  https://<relayer-host>/bridge/watcher/findings/<findingId>/ignore
```

## 9. Smoke Test

Run locally or in a one-off hosted job:

```bash
cd relayer
npm run watcher:smoke
```

The smoke test:

- injects deterministic synthetic observations
- persists findings to a local temp directory, or `BRIDGE_WATCHER_SMOKE_STATE_DIR`
- verifies common risk codes are produced
- builds a dry-run freeze preview
- verifies `dryRun=true`
- verifies no freeze submissions are produced
- requires no live RPC and sends no webhook by default

## 10. Common Findings

| Code | Meaning | Default response |
| --- | --- | --- |
| `unsafe_solana_init_bridge_v1_out` | Test-only Solana message-level event observed | Do not sign; investigate source event; freeze recommendation |
| `amount_over_max_message_amount` | Message exceeds configured cap | Do not sign; review caps and route config |
| `expired_deadline` | Message deadline is stale | Do not sign; ignore or resolve after review |
| `unsupported_asset` | Canonical asset not configured for route | Do not sign; review asset policy |
| `source_not_final` | Source confirmations below policy | Delay until finality, then re-evaluate |
| `cross_decimal_mismatch` | Destination amount does not match exact-decimal normalization | Do not sign; investigate relayer transform |

## 11. What Not To Do

- Do not set `BRIDGE_WATCHER_AUTO_FREEZE=true`.
- Do not set `BRIDGE_WATCHER_DRY_RUN=false`.
- Do not submit live freeze transactions.
- Do not put `BRIDGE_OPERATOR_API_TOKEN` in URLs, logs, screenshots, docs, or git.
- Do not commit webhook URLs.
- Do not treat watcher clean status as a mainnet readiness signal.

## 12. Emergency Checklist

If a critical finding appears:

1. Stop signing for the affected route if there is evidence of unsafe source event handling.
2. Save the finding JSON and source transaction hash.
3. Check whether destination consumed state changed.
4. Verify the event kind and source address/program ID.
5. Notify bridge operators.
6. Use `freeze-dry-run` to inspect the intended freeze call or instruction.
7. Do not submit live freeze until a follow-up PR enables and tests that path.

## 13. Known Limitations

- Testnet dry-run only.
- No live freeze transaction submission.
- No production signer custody.
- No HSM/KMS/MPC custody.
- No mainnet finality model.
- `public_data_hash` remains weak/dummy-constrained in-circuit.
- Solana -> EVM economic amount normalization remains a follow-up.

## 14. Mainnet Readiness Blockers

- Harden `public_data_hash` in-circuit.
- Add production signer custody.
- Add redundant RPC/finality sources.
- Complete live freeze submission tests.
- Add operator approval workflow for freeze execution.
- Add liquidity/risk dashboards.
- Complete route-specific economic normalization policy.
