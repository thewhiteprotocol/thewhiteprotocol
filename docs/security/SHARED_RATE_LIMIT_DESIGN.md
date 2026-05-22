# Shared Production Rate-Limit Design

## Summary

PR-014D added in-process rate limits for public, operator, and expensive relayer endpoints. That is useful for single-instance testnet and public beta hardening, but it is not sufficient for multi-instance production. A shared limiter is required before mainnet or any horizontally scaled public deployment.

## Why In-Process Is Insufficient

In-process counters are local to one Node.js process. They do not coordinate across:

- multiple Render instances;
- rolling deploy overlap;
- future worker/API split processes;
- edge cache/API gateway traffic;
- failover instances.

An attacker or runaway script can multiply the effective quota by spreading traffic across instances.

## Recommended Backend

Preferred option: Redis-compatible managed service such as Upstash Redis or a project-managed Redis instance.

Acceptable alternatives:

- API gateway or Cloudflare-style edge rate limiting;
- managed rate-limit service with per-key counters;
- database-backed limiter only if Redis/edge is unavailable and write volume is acceptable.

The relayer should keep the in-process limiter as a local/test fallback.

## Proposed Configuration

```bash
RELAYER_RATE_LIMIT_ENABLED=true
RELAYER_RATE_LIMIT_STORE=memory
RELAYER_REDIS_URL=
RELAYER_RATE_LIMIT_FAIL_CLOSED=false
```

Production target:

```bash
RELAYER_RATE_LIMIT_STORE=redis
RELAYER_REDIS_URL=<secret managed outside git>
RELAYER_RATE_LIMIT_FAIL_CLOSED=true
```

`RELAYER_REDIS_URL` must be treated as a secret and must never be printed.

## Keying Strategy

Rate-limit keys should include:

- endpoint category: `public`, `operator`, `expensive`;
- normalized route template, not raw path with untrusted parameters;
- client IP or trusted proxy-derived IP;
- operator token hash for authenticated operator endpoints;
- optional bridge route for route-scoped expensive commands.

Examples:

```text
rl:public:/bridge/status:ip:<ip-hash>
rl:operator:/bridge/daemon/tick:token:<token-hash>
rl:expensive:/api/withdraw-proof:ip:<ip-hash>
```

Only hashes of tokens or IPs should appear in logs/metrics.

## Limit Policy

| Category | Starting Policy | Production Notes |
| --- | --- | --- |
| Public read endpoints | 300/min/IP | Add cache for `/quote`, `/assets`, `/bridge/status` where safe |
| Bridge status/message reads | 30-120/min/IP | Protect if operational metadata becomes sensitive |
| Operator endpoints | 30/min/operator token/IP | Require auth and audit logs |
| Expensive proof/simulation endpoints | 5/min/IP or token | Add concurrency caps and request queue limits |
| Replay/scan/tick endpoints | 1-5/min/operator token | Also enforce bounded block ranges |

## Fail-Open vs Fail-Closed

Recommended policy:

- Public read endpoints: fail open with warning during Redis outage if the API remains otherwise healthy.
- Operator mutation endpoints: fail closed when `RELAYER_RATE_LIMIT_FAIL_CLOSED=true`.
- Expensive endpoints: fail closed in production.

The implementation must emit a sanitized metric/event for limiter backend failures without printing Redis URLs or credentials.

## Privacy And Logging

The limiter must not log:

- raw IP addresses if avoidable;
- raw operator tokens;
- RPC URLs;
- request bodies containing proofs or note material.

Allowed logs:

- endpoint category;
- route template;
- hashed key prefix;
- allow/deny decision;
- remaining quota if non-sensitive.

## Observability

Expose aggregate metrics:

- requests allowed/blocked by category;
- limiter backend latency;
- Redis/backend error count;
- fail-open/fail-closed count;
- top route templates by blocked count.

Do not expose per-user or raw-token data.

## Migration Plan

1. Keep current in-memory limiter as default.
2. Add a `RateLimiterStore` abstraction with memory implementation.
3. Add a Redis implementation behind `RELAYER_RATE_LIMIT_STORE=redis`.
4. Add tests for equivalent memory/Redis decisions using a mock Redis client.
5. Deploy Redis-backed limiter to staging with `fail_closed=false`.
6. Enable `fail_closed=true` for operator and expensive categories.
7. Add alerting for limiter backend failures and blocked request spikes.

## Open Follow-Up

No Redis dependency or startup requirement was added in PR-014E. The next implementation PR should add the store abstraction first, then the Redis adapter behind an opt-in env flag.
