# PR-011B - Watcher Daemon and Operator API

**Date:** 2026-05-09
**Status:** Complete for testnet operational scaffolding

## 1. Summary

PR-011B turns the PR-011A watcher/policy modules into a daemon-capable service with persistent findings, authenticated operator APIs, and dry-run freeze previews.

No contracts, Solana programs, circuits, deployment artifacts, live routes, or runtime deployments were changed.

## 2. Daemon Config

Added:

- `relayer/src/bridge/watcher-daemon.ts`

Environment defaults:

- `BRIDGE_WATCHER_ENABLED=false`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_INTERVAL_MS=30000`
- `BRIDGE_WATCHER_MAX_FINDINGS_PER_TICK=100`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE=critical`

The relayer only starts the daemon when `BRIDGE_WATCHER_ENABLED=true` and `STATE_DIR` is configured.

## 3. Dry-Run Default

Dry-run is the default. The daemon can evaluate messages, persist findings, and build freeze previews without sending transactions.

Live freeze submission is not available from the default executor. A submitter must be explicitly injected and dry-run must be disabled.

## 4. Finding Model

Added:

- `relayer/src/bridge/watcher-store.ts`

Findings are stored atomically in:

- `bridge-watcher-findings.json`

Fields:

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
- `evidenceHash`
- `dryRun`
- optional `txHash`

Statuses:

- `open`
- `acknowledged`
- `ignored`
- `freeze_requested`
- `freeze_submitted`
- `resolved`

Duplicate findings are idempotent by message hash and code. Acknowledged, ignored, and resolved findings are not reopened unless evidence changes.

## 5. Freeze Action Model

Added:

- `relayer/src/bridge/freeze-actions.ts`

Dry-run previews:

- EVM: builds `BridgeInbox.freezeMessage(bytes32)` calldata.
- Solana: builds a `freeze_bridge_v1_message` instruction preview with BridgeV1Config and FrozenBridgeMessage PDAs.

Auto-freeze defaults to false. If enabled later, the daemon still requires dry-run to be false and a submit-capable executor to be injected.

## 6. Operator API Routes

Added authenticated watcher routes to the bridge status router:

- `GET /bridge/watcher/status`
- `GET /bridge/watcher/findings`
- `GET /bridge/watcher/findings/:id`
- `POST /bridge/watcher/findings/:id/ack`
- `POST /bridge/watcher/findings/:id/ignore`
- `POST /bridge/watcher/findings/:id/freeze-dry-run`
- `POST /bridge/watcher/tick`

## 7. Auth Model

Operator APIs require `BRIDGE_OPERATOR_API_TOKEN`.

Accepted auth formats:

- `Authorization: Bearer <token>`
- `x-bridge-operator-token: <token>`

If the token is missing from config, watcher APIs fail closed with `OPERATOR_AUTH_NOT_CONFIGURED`.

Unauthenticated requests return the standard API error shape:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Operator API token is required."
  }
}
```

## 8. Auto-Freeze Behavior

Auto-freeze does not run by default.

If explicitly enabled:

- only findings at or above `BRIDGE_WATCHER_MIN_SEVERITY_TO_FREEZE` are considered.
- only findings with `recommendedAction = freeze` are considered.
- dry-run mode produces a `freeze_requested` finding update and no transaction.
- live submission requires a submit-capable freeze executor.
- already submitted findings are not submitted repeatedly.

## 9. Tests Added

Added:

- `relayer/src/bridge/__tests__/watcher-daemon.test.ts`

Coverage:

- daemon disabled by default
- disabled tick no-op
- tick evaluates messages and persists findings
- dry-run freeze does not submit tx
- auto-freeze false prevents tx submission
- critical finding produces freeze recommendation
- duplicate finding idempotency
- acknowledged finding is not reopened for same evidence
- unsafe Solana `init_bridge_v1_out` creates finding
- valid Solana `bridge_out_v1_with_proof` creates no finding
- valid EVM `bridgeOutV1` creates no finding
- over-cap message creates finding
- finality-not-met message creates delay finding
- cross-decimal mismatch creates finding
- operator API requires auth
- operator API lists findings
- operator API ack works
- operator API freeze dry-run returns preview
- operator API manual tick works

## 10. Commands Run

```text
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
```

Results:

- Relayer tests: 18 suites passed, 251 tests passed
- Typecheck: passed
- Build: passed

## 11. Remaining Limitations

- Testnet operational scaffolding only.
- No runtime deployment was changed.
- No live freeze transaction submission by default.
- No production signer custody.
- No HSM/KMS/MPC operator custody.
- No external alert webhook integration yet.
- `public_data_hash` remains weak/dummy-constrained in-circuit.
- Solana -> EVM economic amount normalization remains a follow-up.

## 12. Next Recommended PR

PR-011C - run the watcher daemon in hosted testnet dry-run mode, collect findings, add alert webhook integration, and define operator freeze custody before enabling any live freeze submission.
