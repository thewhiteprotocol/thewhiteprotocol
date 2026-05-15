# Bridge Watcher, Challenge, and Freeze Model

**Date:** 2026-05-09
**Status:** Hosted testnet dry-run ready; dry-run by default

## 1. Summary

PR-011A added deterministic watcher foundations in `relayer/src/bridge/watcher.ts`.

PR-011B adds:

- `relayer/src/bridge/watcher-daemon.ts`
- `relayer/src/bridge/watcher-store.ts`
- `relayer/src/bridge/freeze-actions.ts`
- authenticated `/bridge/watcher/*` operator APIs

PR-011C adds:

- hosted dry-run config knobs
- optional alert webhook hook
- alert severity thresholds
- alert deduplication
- finding retention cleanup
- richer watcher status response

PR-011D adds:

- offline watcher smoke command: `npm run watcher:smoke`
- deterministic synthetic bridge-risk fixtures
- alert failure retry/no-crash behavior
- hosted dry-run operator runbook

PR-011E adds:

- hosted observation-window summaries in `relayer/src/bridge/observation.ts`
- offline report command: `npm run watcher:report`
- escalation policy helpers and tests
- freeze execution design doc
- observation window runbook

PR-011G adds:

- daemonized bridge relayer paper/live-testnet mode in `relayer/src/bridge/daemon.ts`
- bridge daemon status/message/operator tick APIs
- EVM `acceptBridgeMint` submit previews
- Solana `accept_bridge_v1_mint` submit previews
- watcher-critical-finding blocks before signing/submission
- live-testnet submission gates, with mainnet blocked and live submission disabled by default

The watcher does not replace on-chain checks. It is a pre-signing and post-observation safety layer that classifies bridge messages, produces findings, and recommends whether the relayer should accept, delay, alert, require manual review, or freeze.

## 2. Inputs

The watcher evaluates:

- source event observation
- decoded `BridgeMessageV1`
- source chain key
- destination chain key
- route and asset policy
- finality policy
- optional destination message after normalization
- optional destination consumed state
- signer set version match

No private keys or secrets are required.

## 3. Findings

The watcher can detect:

- unsafe Solana `init_bridge_v1_out` source event
- unsafe/direct EVM outbox event
- unknown source event kind
- wrong source or destination domain
- wrong source or destination chain ID
- unsupported asset
- amount over cap
- expired deadline
- duplicate message hash in relayer state
- source finality not reached
- source transaction reverted or missing
- destination message already consumed
- missing Solana source-bound proof marker
- cross-decimal mismatch after normalization
- signer set mismatch
- high-value amount requiring manual review
- amount above fast-path threshold

Persisted finding fields:

- `findingId`
- `messageHash`
- `route`
- `sourceChain`
- `destinationChain`
- `severity`
- `code`
- `reason`
- `recommendedAction`
- `status`
- `createdAt`
- `updatedAt`
- `evidence`
- `dryRun`
- optional `txHash`
- optional `lastAlertedAt`
- optional `lastAlertEvidenceHash`

Statuses:

- `open`
- `acknowledged`
- `ignored`
- `freeze_requested`
- `freeze_submitted`
- `resolved`

## 4. Recommendations

Watcher recommendations:

| Recommendation | Meaning |
| --- | --- |
| `accept` | Message is policy-clean and eligible for signing. |
| `delay` | Message should not be signed yet, usually due to finality. |
| `alert` | Message can be surfaced to operators but is not automatically fatal. |
| `manual_review` | Message is valid enough to inspect but should not use fast-path signing. |
| `freeze` | Message is suspicious enough to recommend freeze/challenge handling. |
| `ignore` | Message is intentionally ignored, such as disabled watcher mode. |

Critical findings and unsafe source events are mapped to `freeze`.

## 5. Freeze and Challenge Policy

V1 behavior:

- Small valid messages use the fast path.
- Not-final messages are delayed.
- Unsupported, expired, wrong-domain, or unsafe-source messages are not signed.
- High-value messages require manual review.
- Already-signed suspicious messages should alert operators and recommend freeze where supported.
- Watcher output can be used by a future daemon to submit on-chain freeze transactions.

PR-011B does not submit freeze transactions by default. It builds dry-run previews:

- EVM: `BridgeInbox.freezeMessage(bytes32 messageHash)` calldata.
- Solana: `freeze_bridge_v1_message` instruction preview with BridgeV1Config and FrozenBridgeMessage PDAs.

Live submission requires:

- `BRIDGE_WATCHER_ENABLED=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=true`
- `BRIDGE_WATCHER_DRY_RUN=false`
- configured operator key implementation injected into the freeze executor
- severity at or above `BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE`

The default executor only builds previews.

Alerts do not submit freeze transactions. They only notify operators about persisted findings.

## 6. Configuration

Supported non-secret environment names:

- `BRIDGE_WATCHER_ENABLED`
- `BRIDGE_WATCHER_DRY_RUN`
- `BRIDGE_WATCHER_INTERVAL_MS`
- `BRIDGE_WATCHER_MAX_FINDINGS_PER_TICK`
- `BRIDGE_WATCHER_FINDINGS_PATH`
- `BRIDGE_WATCHER_FINDING_RETENTION_DAYS`
- `BRIDGE_WATCHER_AUTO_FREEZE`
- `BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE`
- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_ALERT_WEBHOOK_URL`
- `BRIDGE_ALERT_MIN_SEVERITY`
- `BRIDGE_ALERT_DRY_RUN`
- `BRIDGE_ALERT_LOG`
- `BRIDGE_WATCHER_SMOKE_STATE_DIR`, optional local smoke output path
- `BRIDGE_MAX_FAST_PATH_AMOUNT`
- `BRIDGE_MANUAL_REVIEW_AMOUNT`
- `BRIDGE_FINALITY_OVERRIDES`

Defaults:

- `BRIDGE_WATCHER_ENABLED=false`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_WATCHER_INTERVAL_MS=30000`
- `BRIDGE_WATCHER_MAX_FINDINGS_PER_TICK=100`
- `BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE=critical`
- `BRIDGE_WATCHER_FINDING_RETENTION_DAYS=30`
- `BRIDGE_ALERT_MIN_SEVERITY=high`
- `BRIDGE_ALERT_DRY_RUN=true`
- `BRIDGE_ALERT_LOG=false`

`BRIDGE_FINALITY_OVERRIDES` is parsed as JSON. Values can be either a confirmation number or a partial finality config object.

Example:

```json
{
  "base-sepolia": 5,
  "solana-devnet": {
    "confirmations": 40,
    "maxAgeSeconds": 86400
  }
}
```

## 7. Smoke Mode

PR-011D adds an offline smoke path:

```bash
cd relayer
npm run watcher:smoke
```

The smoke command:

- requires no live RPC
- submits no freeze transactions
- sends no real webhook by default
- injects deterministic synthetic observations
- persists findings to a temp directory, or `BRIDGE_WATCHER_SMOKE_STATE_DIR`
- verifies common risk codes
- builds a freeze dry-run preview
- verifies `dryRun=true` and `autoFreeze=false`

Synthetic fixture coverage:

- unsafe Solana `init_bridge_v1_out`
- amount over cap
- expired deadline
- unsupported asset
- not-final source event
- cross-decimal mismatch

## 7.1 Observation Window Reporting

PR-011E adds an offline report command:

```bash
cd relayer
npm run watcher:report
```

The report reads persisted watcher findings and writes sanitized JSON and Markdown summaries. It tracks:

- observation label and time range
- watcher mode, `dryRun`, and `autoFreeze`
- chains and routes monitored
- findings by severity, status, route, and code
- repeated findings and top codes
- alert counts
- freeze preview counts
- live freeze transaction count

During hosted dry-run, `liveFreezeTxCount` must remain `0`.

Escalation policy:

| Severity | Default action |
| --- | --- |
| low | Log only. |
| medium | Alert if repeated. |
| high | Alert immediately and require manual review. |
| critical | Alert immediately, generate freeze preview, require operator review. |
| critical repeated | Freeze recommended, still dry-run unless a later PR enables live freeze. |

## 8. Finality Rules

Default testnet policy:

- Base Sepolia: 3 confirmations
- Ethereum Sepolia: 12 confirmations
- BNB Chain Testnet: 15 confirmations
- Polygon Amoy: 64 confirmations
- Solana Devnet: 32 confirmations / finalized source observation

These are testnet defaults. Mainnet policy must include chain-specific finality and reorg modeling.

## 9. Route and Asset Caps

The watcher uses the same route metadata as relayer policy:

- route enabled/status
- signer set version
- supported canonical asset IDs
- source/destination decimals
- exact-decimal normalization
- max message amount
- daily cap
- fast-path/manual-review thresholds

For cross-decimal routes, destination-local cap checks must be applied after normalization.

## 10. Operator APIs

All operator APIs require `BRIDGE_OPERATOR_API_TOKEN` via either:

- `Authorization: Bearer <token>`
- `x-bridge-operator-token: <token>`

Routes:

- `GET /bridge/watcher/status`
- `GET /bridge/watcher/findings`
- `GET /bridge/watcher/findings/:id`
- `POST /bridge/watcher/findings/:id/ack`
- `POST /bridge/watcher/findings/:id/ignore`
- `POST /bridge/watcher/findings/:id/freeze-dry-run`
- `POST /bridge/watcher/tick`
- `GET /bridge/daemon/status`
- `GET /bridge/daemon/messages`
- `GET /bridge/daemon/messages/:hash`
- `POST /bridge/daemon/tick`
- `POST /bridge/daemon/messages/:hash/retry`

Errors use the standard `{ success: false, error: { code, message, details } }` shape.

Status output includes:

- enabled/running/dry-run/auto-freeze flags
- interval and max findings per tick
- retention days
- counts by severity and status
- last tick timestamp and duration
- safe last error text
- alerting enabled/dry-run/min-severity/sink

It does not include `BRIDGE_OPERATOR_API_TOKEN` or `BRIDGE_ALERT_WEBHOOK_URL`.

Daemon status output includes mode, running state, route testnet-only classification, message counts by status, signer adapter type, and signer threshold. It does not include signer private keys, key file contents, operator tokens, webhook URLs, or RPC secrets.

## 10.1 Bridge Daemon Paper Mode

PR-011G paper mode is the recommended next operational posture:

```bash
BRIDGE_DAEMON_MODE=paper
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false
```

Paper mode can produce signatures and submit previews when policy allows, but it records `submitTxHash=null` and never calls the destination submit adapter. Live-testnet mode must not be enabled until paper-mode output has been reviewed over a hosted observation window.

Live-testnet submission requires:

- `BRIDGE_DAEMON_MODE=live-testnet`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`
- known testnet-only routes
- no open critical watcher findings
- signer mode permitted for live-testnet
- destination adapter configured

Solana live submission is not implemented in PR-011G; Solana output is preview-only.

## 11. Alert Payload

Alert payloads are intentionally small:

- `findingId`
- `severity`
- `code`
- `messageHash`
- `sourceChain`
- `destinationChain`
- `recommendedAction`
- `dryRun`
- `createdAt`
- sanitized `evidenceSummary`

The evidence summary can include source event type, tx hash, block number, confirmation count, source/destination domains, canonical asset ID, amount, nonce, and policy reasons.

It does not include private keys, RPC URLs, webhook URLs, proof witness data, wallet files, or environment contents.

Alert deduplication uses the finding evidence hash. The same finding/evidence is not alerted repeatedly on every tick.

If a webhook send fails, the watcher records an `alert_failed` result for that tick and continues running. Because the finding is not marked alerted, the next tick retries the same finding/evidence.

## 12. Retention

Retention cleanup uses `BRIDGE_WATCHER_FINDING_RETENTION_DAYS` and defaults to 30 days.

Only old `resolved` and `ignored` findings are automatically removed. Open critical findings are never removed automatically.

## 13. Remaining Work

Recommended next work:

- test daemon on hosted testnet relayer with watcher enabled and dry-run
- add durable alert webhook integration
- add operator key custody for explicit freeze submission
- submit on-chain freeze transactions only after dry-run review
- integrate alert webhooks
- add redundant RPC/source transaction verification
- add signer custody checks
- formalize Solana -> EVM amount normalization
