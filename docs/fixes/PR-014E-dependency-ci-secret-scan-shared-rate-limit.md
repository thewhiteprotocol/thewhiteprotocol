# PR-014E - Dependency Triage, CI Secret Scan, And Shared Rate-Limit Design

## Summary

PR-014E hardens the repository for public beta and audit readiness without changing protocol behavior. It adds a no-secret/artifact scanner, a GitHub Actions security workflow, expanded artifact ignore rules, a shared production rate-limit design, and updated dependency risk tracking.

No bridge flows were run, no transaction was submitted, and no EVM contract, Solana program, circuit, or BridgeMessageV1 layout was modified.

## Dependency Audit Result

Commands run:

```bash
npm audit --json --omit=dev
npm audit --json
npm audit fix --omit=dev --package-lock-only --dry-run
```

Production dependency audit:

- Total vulnerabilities: 30
- High vulnerabilities: 6
- Critical vulnerabilities: 0

Full workspace audit:

- Total vulnerabilities: 102
- High vulnerabilities: 30
- Critical vulnerabilities: 5

The non-forced audit-fix dry run failed on an existing React 18 vs LayerZero devtools React 17 peer conflict. No forced remediation was applied.

## High Vulnerability Triage

High production findings are tracked in `docs/security/DEPENDENCY_RISK_REGISTER.md`:

- `bigint-buffer` through Solana SPL token helpers;
- `@solana/spl-token` audit group;
- `@solana/buffer-layout-utils` audit group;
- `bfj` through `snarkjs`;
- `jsonpath` through `bfj`;
- `underscore` through `jsonpath`.

## Remediated Dependencies

None.

No dependency version was changed in PR-014E. The safe path is a dedicated dependency PR split by runtime area:

- Solana runtime stack;
- proof/snarkjs tooling;
- relayer/EVM runtime;
- EVM/Hardhat/LayerZero dev tooling.

## Unresolved Dependency Risks

Dependency and supply-chain hygiene remains a mainnet blocker. The current audit findings require targeted upgrade branches and full compatibility testing rather than `npm audit fix --force`.

## CI No-Secret Scan

Added:

- `scripts/no-secret-artifact-scan.js`
- `npm run security:no-secret-scan`
- `npm run security:no-secret-scan:self-test`
- `.github/workflows/security.yml`

The scanner:

- scans tracked files;
- reports only path and issue type;
- fails on new forbidden artifacts;
- redacts matched values by never printing them;
- includes a temporary baseline for pre-existing tracked findings outside this PR scope.

The baseline is path/type-only:

- `docs/security/no-secret-scan-baseline.json`

Baseline cleanup is required before mainnet.

## Gitignore And Artifact Controls

Updated `.gitignore` coverage for:

- bridge note-state and destination note-state JSON;
- operator-data paths;
- witness files;
- proof/public/input JSON;
- generated transaction JSON.

The scanner also blocks new zkey paths except explicitly allowlisted existing public circuit artifacts.

## Shared Rate-Limit Design

Created:

- `docs/security/SHARED_RATE_LIMIT_DESIGN.md`

The design covers:

- why in-process limits are insufficient for multi-instance production;
- Redis/Upstash or edge gateway options;
- keying by endpoint category, IP hash, operator token hash, route, and normalized route template;
- fail-open vs fail-closed behavior;
- observability;
- migration from memory to shared store.

No Redis package or startup requirement was added.

## Tests Run

```bash
npm run security:no-secret-scan:self-test
npm run security:no-secret-scan
```

Final validation commands are recorded in the PR terminal summary.

## Remaining Limitations

- Dependency vulnerabilities remain unresolved pending targeted remediation.
- Scanner baseline contains 19 pre-existing path/type findings that must be removed in cleanup PRs.
- Shared limiter is design-only; implementation is still required.
- Dependency audit is non-gating in CI until the current risk register is remediated or explicitly accepted.
- Production custody, audit, watcher/freeze policy, and mainnet governance remain open blockers.

## Next Recommended PR

PR-014F - targeted dependency remediation and scanner baseline cleanup, starting with pre-existing RPC-key markers and proof/snarkjs dependency review.
