# Production Security Baseline Review

## Summary

This review records the current backend, API, operator, and repository security posture before mainnet or public beta. It is based on code and documentation inspection only. No bridge flows, proof generation, or transactions were run for this review.

Mainnet remains blocked. The current system has meaningful testnet controls and PR-014D added low-risk API hardening for public beta readiness. PR-014E adds CI no-secret/artifact scanning and a shared rate-limit design, but production readiness still requires audit, custody, shared limiter implementation, dependency remediation, note-state custody, zkey ceremony, monitoring, and incident response.

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
| CORS policy | Implemented for beta, deployment review still required | `relayer/src/security.ts` centralizes `RELAYER_ALLOWED_ORIGINS` / `CORS_ORIGIN`; production defaults to no wildcard; local dev has explicit localhost origins | Production origin policy can still drift if hosted envs are changed outside review | Keep explicit local/staging/production origins and add deployment checks before mainnet |
| Rate limiting and quotas | Implemented in-process for beta, shared production design complete | Public, operator, and expensive endpoint limiters are configured in `relayer/src/index.ts` and `relayer/src/api-extensions.ts`; `docs/security/SHARED_RATE_LIMIT_DESIGN.md` defines Redis/edge migration | In-memory limits are per process and do not cover multi-instance or edge traffic alone | Implement shared Redis/edge limiter, concurrency caps, and staging load/cost tests |
| Repo structure / `.gitignore` | Hardened for future artifacts | Root `.gitignore` covers env files, note-state, keypairs, zkeys, data dirs, witnesses, proof JSON, and generated tx JSON; CI scanner is in `.github/workflows/security.yml` | Historical public circuit artifacts and pre-existing path/type baseline findings are allowlisted; future generated artifacts need CI enforcement | Keep artifact scan required in CI, remove baseline findings, and review allowlisted public artifacts before mainnet |
| Authentication middleware | Hardened for current operator mutations | Bridge watcher and daemon mutation endpoints require timing-safe `BRIDGE_OPERATOR_API_TOKEN`; API extension heavy/mutation routes use `SEQUENCER_AUTH_TOKEN` | Some read endpoints are intentionally public; production policy must decide if status/message endpoints leak operational data | Add protected/public endpoint policy review and deployment fail-closed checks |
| Authorization / RLS-style ownership | Missing / N/A today | No database-backed user accounts or RLS are present | File-backed operator state has coarse service-level trust only | Define state ownership model before adding user accounts or database-backed operator jobs |
| Input validation and sanitization | Partially implemented and hardened | Route names, chain params, addresses, note-state durability, proof inputs, bridge message hashes, status/severity enums, and pagination have targeted validators | Some CLI/env file-path inputs and block-range policies still need full production review | Add validation checklist and targeted tests for all path, range, route, and amount inputs |
| Error handling and logging | Partially implemented and hardened | Error handler hides generic unhandled errors; bridge code redacts known secret patterns; rate-limit/auth errors return safe generic shapes | Some API extension handlers return sanitized `error.message`; failed simulation strings need continuous redaction review | Centralize redaction and add CI checks for secret-like output |
| Secure env and secret management | Missing for production | `render.yaml` uses placeholders/comments for secrets; docs state env-file signers are testnet-only | Mainnet secret manager, rotation, and access logging are not formalized | Define secret classes, storage, rotation, and incident process |
| Frontend/backend boundary | Partially implemented | Operator submit/replay/freeze are backend commands or protected bridge endpoints | Future frontend integrations could accidentally expose operator endpoints or server secrets | Add frontend integration constraints and disallow `NEXT_PUBLIC` secrets |
| JWT/session/cookie/CSRF | Not applicable today | Operator auth is bearer/header token; no cookie/JWT session auth in relayer | If browser-authenticated operator UI is introduced, CSRF/session controls will be required | Add future JWT/cookie/CSRF requirements before browser operator UI |
| Security headers | Implemented for beta, production policy still required | `helmet()` plus explicit nosniff, no-referrer, and permissions-policy headers are installed in the relayer service | CSP/HSTS need deployment-specific validation to avoid breaking API clients | Define production CSP/HSTS policy and test deployed headers |
| Dependency and supply chain | Triage complete, remediation pending | Package manifests identify key dependencies; tests/typecheck/build run; production audit reports 30 vulnerabilities including 6 high; full audit reports 102 including dev-tooling criticals; `docs/security/DEPENDENCY_RISK_REGISTER.md` tracks follow-up | Targeted dependency upgrades require compatibility testing; force fixes are unsafe | Add SBOM/lockfile review and dedicated dependency remediation PRs |
| CI/CD and environment parity | Partially implemented and hardened | Existing workflows run tests; Render bootstrap documents zkey repair and fail-closed startup; `.github/workflows/security.yml` runs no-secret/artifact scan and non-gating audit | Dependency audit is non-gating until tracked findings are remediated or accepted | Add SBOM, hosted parity checks, and eventually make dependency policy gating |
| Cost controls | Partially implemented and design hardened | Endpoint-category rate limits, bounded daemon configs, explicit operator commands, and shared limiter design exist | Proof generation, replay scans, RPC-heavy endpoints, and watcher loops can still be costly under multi-instance/public traffic until shared limiter is implemented | Add shared quotas, block-range caps, concurrency controls, and public endpoint budgets |
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
| Public health/read | `/health`, `/status`, `/assets`, `/quote` | Default 300/min/IP through `RELAYER_PUBLIC_*`; cache where possible |
| Public bridge status | `/bridge/status`, `/bridge/routes` | 30-120/min/IP |
| Message/detail reads | `/bridge/messages`, `/bridge/daemon/messages` | Protect if operational data is sensitive; otherwise 30/min/IP with pagination bounds |
| Operator mutations | `/bridge/daemon/tick`, watcher ack/ignore/freeze/tick | Auth required; default 30/min/operator-token/IP through `RELAYER_OPERATOR_*` |
| Proof generation | `/api/deposit-proof`, `/api/withdraw-proof`, `/api/withdraw-v2-proof` | Auth required; default 5/min/IP through `RELAYER_EXPENSIVE_*`; add concurrency caps before mainnet |
| RPC-heavy reads | Merkle proof, note lookup, pool state | 10-60/min/IP and cache where safe |
| Submit/withdraw commands | CLI/operator only | No public HTTP access; one-shot approved hashes only |

## Evidence Links

- Endpoint matrix: `docs/security/API_OPERATOR_ENDPOINT_SECURITY_MATRIX.md`
- Secret/artifact policy: `docs/security/SECRET_AND_ARTIFACT_CONTROL_POLICY.md`
- Dependency risk register: `docs/security/DEPENDENCY_RISK_REGISTER.md`
- Shared rate-limit design: `docs/security/SHARED_RATE_LIMIT_DESIGN.md`
- Mainnet blocker register: `docs/audit/MAINNET_BLOCKER_REGISTER.md`
- Audit handoff package: `docs/audit/AUDIT_HANDOFF_PACKAGE.md`
- Operator checklist: `docs/runbooks/bridge-operator-approval-checklist.md`

## Recommended PRs

- PR-014D: production API policy and low-risk auth/rate-limit hardening completed for public beta readiness; shared production limiter and deployment gate follow-up remains.
- PR-014E: dependency remediation triage, CI no-secret/artifact scan, and shared production rate-limit design completed; dependency remediation and shared limiter implementation remain.
- PR-014F: production signer custody design.
- PR-014G: incident response and watcher/freeze production policy.
- PR-014H: circuit binding decision record.
