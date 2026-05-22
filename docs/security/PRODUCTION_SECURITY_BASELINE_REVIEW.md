# Production Security Baseline Review

## Summary

This review records the current backend, API, operator, and repository security posture before mainnet or public beta. It is based on code and documentation inspection only. No bridge flows, proof generation, or transactions were run for this review.

Mainnet remains blocked. The current system has meaningful testnet controls, but production readiness still requires audit, custody, rate-limit policy finalization, operator endpoint hardening review, note-state custody, zkey ceremony, monitoring, and incident response.

## Scope

Reviewed areas:

- relayer HTTP service;
- bridge status/operator router;
- API extension routes;
- watcher and daemon operator controls;
- CORS, rate limiting, helmet/security headers, auth, input validation, logging, and error handling;
- repository ignore policy and artifact handling;
- audit/evidence docs and mainnet blocker register.

Out of scope:

- EVM contract changes;
- Solana program changes;
- circuit changes;
- BridgeMessageV1 layout or golden vectors;
- live bridge flows or transaction submission.

## Security Baseline Checklist

| Area | Current Status | Evidence | Risk | Remediation |
| --- | --- | --- | --- | --- |
| CORS policy | Partially implemented | `relayer/src/index.ts` reads `CORS_ORIGIN`; `render.yaml` sets `https://app.thewhiteprotocol.com` | Production origin policy could drift without environment-specific review | Document local/staging/production origins and add deployment checks before public beta |
| Rate limiting and quotas | Partially implemented | Main app and API extensions use `express-rate-limit` with 500/min global and 30/min per key/IP | Expensive public reads and proof endpoints still need category-specific limits and cost budgets | Add endpoint-category rate limit policy and staging load tests |
| Repo structure / `.gitignore` | Partially implemented | Root and relayer `.gitignore` cover env files, note-state, keypairs, zkeys, data dirs | Historical tracked artifacts exist; future generated artifacts need stricter ignore coverage | Keep artifact scan in CI and expand ignore patterns for witness/proof/operator-token outputs |
| Authentication middleware | Partially implemented | Bridge watcher and daemon mutation endpoints require `BRIDGE_OPERATOR_API_TOKEN`; API extension heavy/mutation routes use `SEQUENCER_AUTH_TOKEN` | Some read endpoints are intentionally public; production policy must decide if status/message endpoints leak operational data | Add protected/public endpoint policy and require auth for any mutation or operator action |
| Authorization / RLS-style ownership | Missing / N/A today | No database-backed user accounts or RLS are present | File-backed operator state has coarse service-level trust only | Define state ownership model before adding user accounts or database-backed operator jobs |
| Input validation and sanitization | Partially implemented | Route names, chain params, addresses, note-state durability, and proof inputs have targeted validators | Some list/status query params and file-path env inputs require stricter bounded validation review | Add validation checklist and targeted tests for block ranges, paths, hashes, route names, and limits |
| Error handling and logging | Partially implemented | Error handler hides generic unhandled errors; bridge approval/submit code redacts known secret patterns | Some API extension handlers return `error.message`; failed simulation strings need continuous redaction review | Centralize redaction and define production error response policy |
| Secure env and secret management | Missing for production | `render.yaml` uses placeholders/comments for secrets; docs state env-file signers are testnet-only | Mainnet secret manager, rotation, and access logging are not formalized | Define secret classes, storage, rotation, and incident process |
| Frontend/backend boundary | Partially implemented | Operator submit/replay/freeze are backend commands or protected bridge endpoints | Future frontend integrations could accidentally expose operator endpoints or server secrets | Add frontend integration constraints and disallow `NEXT_PUBLIC` secrets |
| JWT/session/cookie/CSRF | Not applicable today | Operator auth is bearer/header token; no cookie/JWT session auth in relayer | If browser-authenticated operator UI is introduced, CSRF/session controls will be required | Add future JWT/cookie/CSRF requirements before browser operator UI |
| Security headers | Partially implemented | `helmet()` is enabled in the relayer service | CSP/HSTS/referrer/permissions policies are not environment-specific | Define production header policy and TLS/HSTS deployment assumptions |
| Dependency and supply chain | Partially implemented | Package manifests identify key dependencies; tests/typecheck/build run; `npm audit --audit-level=high --omit=dev` reports 30 vulnerabilities including 6 high | Formal audit/SBOM/dependency review is not yet integrated and targeted dependency upgrades require compatibility testing | Add npm audit/SBOM/lockfile review CI and targeted dependency upgrade policy |
| CI/CD and environment parity | Partially implemented | Existing workflows run tests; Render bootstrap documents zkey repair and fail-closed startup | CI no-secret scan and production security gates are not formalized | Add CI no-secret/artifact scan and hosted parity checks |
| Cost controls | Partially implemented | Rate limits, bounded daemon configs, and explicit operator commands exist | Proof generation, replay scans, RPC-heavy endpoints, and watcher loops can be costly | Add category quotas, block-range caps, and public endpoint budgets |
| Governance and operational guardrails | Partially implemented | Route matrix, approval checklist, blocker register, and roadmap exist | Owner assignments and production approval authority are TBD | Assign owners, approval authority, and launch gate criteria |

## CORS By Environment

| Environment | Allowed Origins | Status |
| --- | --- | --- |
| Local development | Explicit local app origins only, for example `http://localhost:3000` | Required before local browser testing |
| Staging/testnet | Staging app origin plus reviewed operator tooling origins | Required before public staging |
| Production | Production app origin only unless an endpoint is intentionally public and documented | Required before mainnet/public beta |

Wildcard CORS is not approved for production.

## Rate Limit Recommendations

| Category | Examples | Recommended Limit |
| --- | --- | --- |
| Public health/read | `/health`, `/status`, `/assets`, `/quote` | 60-300/min/IP, cache where possible |
| Public bridge status | `/bridge/status`, `/bridge/routes` | 30-120/min/IP |
| Message/detail reads | `/bridge/messages`, `/bridge/daemon/messages` | Protect if operational data is sensitive; otherwise 30/min/IP with pagination bounds |
| Operator mutations | `/bridge/daemon/tick`, watcher ack/ignore/freeze/tick | Auth required; 5-30/min/operator |
| Proof generation | `/api/deposit-proof`, `/api/withdraw-proof`, `/api/withdraw-v2-proof` | Auth required; low concurrency; 1-5/min/operator |
| RPC-heavy reads | Merkle proof, note lookup, pool state | 10-60/min/IP and cache where safe |
| Submit/withdraw commands | CLI/operator only | No public HTTP access; one-shot approved hashes only |

## Evidence Links

- Endpoint matrix: `docs/security/API_OPERATOR_ENDPOINT_SECURITY_MATRIX.md`
- Secret/artifact policy: `docs/security/SECRET_AND_ARTIFACT_CONTROL_POLICY.md`
- Mainnet blocker register: `docs/audit/MAINNET_BLOCKER_REGISTER.md`
- Audit handoff package: `docs/audit/AUDIT_HANDOFF_PACKAGE.md`
- Operator checklist: `docs/runbooks/bridge-operator-approval-checklist.md`

## Recommended PRs

- PR-014D: production API policy and auth/rate-limit hardening.
- PR-014E: dependency remediation plan, CI no-secret/artifact scan, and dependency audit gate.
- PR-014F: production signer custody design.
- PR-014G: incident response and watcher/freeze production policy.
- PR-014H: circuit binding decision record.
