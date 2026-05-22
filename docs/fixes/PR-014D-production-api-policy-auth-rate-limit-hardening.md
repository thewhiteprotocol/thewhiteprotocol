# PR-014D - Production API Policy And Auth/Rate-Limit Hardening

## Summary

PR-014D adds low-risk relayer API hardening for public beta readiness without changing bridge protocol behavior. No bridge flow was run, no transaction was submitted, and no EVM contract, Solana program, circuit, or BridgeMessageV1 layout was modified.

The PR focuses on service-layer controls:

- centralized CORS allowlist policy;
- public, operator, and expensive endpoint rate limits;
- timing-safe operator/API token checks;
- stricter bridge status input validation;
- safe rate-limit/auth error responses;
- low-risk HTTP security headers;
- dependency audit tracking.

## CORS Changes

The relayer now centralizes CORS policy in `relayer/src/security.ts`.

- Preferred production allowlist: `RELAYER_ALLOWED_ORIGINS`.
- Legacy fallback: `CORS_ORIGIN`.
- Local development default: explicit localhost origins only.
- Production default: no wildcard and no reflected arbitrary origin.
- Credentials are not enabled by default.

`relayer/.env.example` and `render.yaml` document the new non-secret CORS settings.

## Rate Limit Changes

The relayer now has three endpoint-category limiters plus a global backstop:

| Category | Env Prefix | Default |
| --- | --- | --- |
| Public reads | `RELAYER_PUBLIC_*` | 300 requests / 60 seconds |
| Operator endpoints | `RELAYER_OPERATOR_*` | 30 requests / 60 seconds |
| Expensive endpoints | `RELAYER_EXPENSIVE_*` | 5 requests / 60 seconds |

The shared toggle is `RELAYER_RATE_LIMIT_ENABLED`. It should remain `true` for hosted/public beta deployments.

The implementation is in-memory and per process. Mainnet still requires shared edge or Redis-backed limits and proof-generation concurrency controls.

## Auth Middleware Changes

Bridge operator auth now uses timing-safe token comparison for `BRIDGE_OPERATOR_API_TOKEN`. API extension auth now uses the same timing-safe comparison for `SEQUENCER_AUTH_TOKEN`.

Mutation/operator endpoints remain protected. Missing or invalid token responses do not include expected token values.

## Input Validation Changes

PR-014D hardens bridge status API validation:

- message hashes must be 32-byte hex values;
- message status filters are enum-validated;
- watcher finding status and severity filters are enum-validated;
- list pagination is bounded.

Existing route, chain, proof, note-state durability, and address validators remain in place.

## Error And Log Redaction

Rate-limit and auth failures now return generic response bodies. New tests cover token non-disclosure and redaction-adjacent behavior. Centralized redaction across all API extension error strings remains a production follow-up.

## Security Headers

The relayer keeps `helmet()` and adds explicit low-risk headers:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

CSP and HSTS remain deployment-specific decisions for a future production header policy.

## Cost Controls

Expensive API paths such as proof generation and withdraw submission now receive stricter in-process rate limits. Public and operator paths receive separate quotas.

Remaining production work:

- shared rate limiting across instances;
- proof-generation concurrency caps;
- block-range and RPC-scan budget enforcement;
- staging load/cost tests.

## Dependency Audit Result

Command:

```bash
npm audit --audit-level=high --omit=dev
```

Result:

- Total vulnerabilities: 30
- High vulnerabilities: 6
- Automatic fix applied: no

The high findings are tracked in `docs/security/DEPENDENCY_RISK_REGISTER.md`. No force-fix was applied because npm reports breaking Solana dependency downgrades and other paths require compatibility testing.

## Tests Added

Added low-risk API security tests for:

- configured production CORS allow/deny behavior;
- no credentials wildcard;
- localhost-only local development CORS defaults;
- rate-limit 429 responses;
- explicit disabled rate-limit mode;
- security headers;
- timing-safe comparison;
- invalid operator token rejection without token disclosure;
- malformed bridge daemon message hash rejection.

## Commands Run

```bash
cd relayer && npm run test -- --runInBand
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
cd relayer && npm run watcher:report
cd chains/solana && npm run test:rust
npm audit --audit-level=high --omit=dev
```

Validation result:

- Relayer tests: 29 suites / 406 tests passed.
- Typecheck: passed.
- Build: passed.
- Watcher smoke: passed.
- Watcher report: passed.
- Solana Rust tests: 115 passed.

## Remaining Limitations

- Mainnet is still blocked on external audit and production custody.
- Rate limiting is in-process and must be replaced or augmented with shared production enforcement before mainnet.
- Dependency vulnerabilities remain open pending targeted remediation.
- API extension error redaction still needs a centralized production pass.
- Metrics/status exposure needs a final public-vs-protected policy decision.
- CI no-secret and artifact gates remain a mainnet blocker.

## Next Recommended PR

PR-014E - dependency remediation, CI no-secret/artifact scan, and shared production rate-limit design.
