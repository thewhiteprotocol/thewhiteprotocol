# PR-014C - Internal Security Production Readiness Review

## Summary

PR-014C performs an internal security and production-readiness review of the current testnet bridge repository and audit package. It adds documentation for backend/API/security controls and expands the mainnet blocker register with concrete production-readiness gaps.

No bridge flows, proof generation, transaction submission, contract changes, Solana program changes, circuit changes, or BridgeMessageV1 changes were performed.

## Security Baseline Items Reviewed

Reviewed:

- CORS policy;
- rate limiting and quotas;
- repo structure and artifact ignore rules;
- authentication middleware;
- authorization / RLS-style ownership boundaries;
- input validation and sanitization;
- error handling and log redaction;
- secure env and secret management;
- frontend/backend boundary;
- JWT/session/cookie/CSRF applicability;
- security headers;
- dependency and supply-chain hygiene;
- CI/CD and environment parity;
- cost controls;
- governance and operational guardrails.

Primary doc:

- `docs/security/PRODUCTION_SECURITY_BASELINE_REVIEW.md`

## Endpoint Matrix Result

Created:

- `docs/security/API_OPERATOR_ENDPOINT_SECURITY_MATRIX.md`

The matrix classifies relayer core endpoints, bridge status/operator endpoints, API extension endpoints, and operator CLI commands by auth requirement, rate-limit status, input validation status, mutation/read-only behavior, risk level, logging/redaction status, and required remediation.

Notable findings:

- CORS, helmet, and app-level rate limiting exist.
- Bridge daemon and watcher mutation endpoints require `BRIDGE_OPERATOR_API_TOKEN`.
- API extension heavy proof endpoints require `SEQUENCER_AUTH_TOKEN`.
- Some public status/message/read endpoints need explicit production exposure decisions.
- Some public API extension endpoints accept sensitive or RPC-heavy inputs and need production policy review.

## Secret / Artifact Policy Result

Created:

- `docs/security/SECRET_AND_ARTIFACT_CONTROL_POLICY.md`

The policy defines forbidden committed artifacts, allowed public artifacts, local-only artifacts, Render persistent disk artifacts, zkey handling, note-state handling, witness/proof handling, env var classification, log redaction rules, frontend boundary rules, and incident steps for accidental exposure.

The root `.gitignore` was hardened for generated witness/proof/input/public JSON, operator-token/private-key names, and bridge result/path artifact directories.

## Mainnet Blocker Updates

Updated:

- `docs/audit/MAINNET_BLOCKER_REGISTER.md`

Added blockers for:

- CORS policy;
- rate limiting and quotas;
- authentication middleware;
- authorization/state ownership;
- input validation and sanitization;
- error/log redaction;
- API cost controls;
- security headers;
- dependency/supply-chain hygiene;
- CI no-secret scan.

The register now tracks 25 blockers:

- Critical: 7
- High: 15
- Medium: 3

## Tests Added

No code tests were added in PR-014C. Existing test coverage already includes operator auth rejection, watcher auth, status redaction, submit check-only no-write behavior, note-state path rejection, duplicate submit/withdraw blocking, and secret redaction fixtures. This PR records the remaining production gaps as blockers rather than performing broad endpoint refactors.

## No-Secret Scan Result

PR-014C scoped files were scanned for forbidden artifact names and secret-like value patterns. No PR-014C-scoped secret/artifact issue was found.

The broader repository still contains historical tracked test artifacts and placeholder field names that broad scans flag. PR-014C did not add or stage those artifacts.

## Dependency Hygiene Result

`cd relayer && npm audit --audit-level=high --omit=dev` was run after requesting network access for the npm registry. It reported 30 vulnerabilities, including 6 high-severity findings, through dependency paths involving Solana/Anchor, ethers v5 transitive packages, snarkjs/jsonpath/underscore, viem/ws, and related packages.

No dependency upgrades were made in PR-014C because this PR is review/documentation focused and the audit output includes breaking or compatibility-sensitive dependency paths. The dependency hygiene blocker was updated for a targeted remediation PR.

## Commands Run

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`
- `cd relayer && npm audit --audit-level=high --omit=dev`

## Remaining Limitations

- Mainnet is not ready.
- External audit is not complete.
- Production signer custody and HSM/KMS/MPC are missing.
- Production auth/rate-limit policy needs implementation.
- Watcher live freeze/alerting posture is not production-approved.
- Secret manager and CI no-secret scan are not formalized.
- Zkey provenance and circuit binding decisions remain open.
- Remaining Solana <-> non-Base EVM routes are not proven or scoped out.

## Next Recommended PR

PR-014D - production API policy and low-risk auth/rate-limit hardening for public beta readiness.
