# PR-014F - No-Secret Baseline Cleanup And CI Gate Hardening

## Summary

PR-014F triaged the pre-existing no-secret/artifact scan baseline from PR-014E and hardened the scanner gate with unit tests. No bridge flows were run, no transactions were submitted, and no contract, program, circuit, or BridgeMessageV1 files were modified for this PR.

The current repository scan is clean for new findings when the explicit baseline is applied. The baseline is not a production acceptance: it records cleanup and rotation work that must be completed before mainnet.

## Original 19 Findings

The initial scanner baseline contained 19 pre-existing findings:

- 18 `rpc_url_with_key` indicators in tracked scripts/tests/backups.
- 1 `witness_artifact` tracked under a circuit build path.
- 0 documentation-only false positives.
- 0 allowed public placeholders.

Scanner output and this report intentionally list only file paths and issue types. Matched values are not printed.

## Triage Table

| Finding ID | Path | Issue Type | Classification | Action | Status |
| --- | --- | --- | --- | --- | --- |
| NSB-001 | `chains/solana/scripts/check-withdraw-balance.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-002 | `chains/solana/scripts/extract-commitment-from-ix.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-003 | `chains/solana/scripts/find-deposit-tx.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-004 | `chains/solana/scripts/helius-historical-query.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-005 | `chains/solana/scripts/init-fresh-pool.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-006 | `chains/solana/scripts/init-pool-minimal.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-007 | `chains/solana/scripts/init-pool-production.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-008 | `chains/solana/scripts/init-pool-raw.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-009 | `chains/solana/scripts/init-relayer-registry.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-010 | `chains/solana/scripts/parse-deposit-event.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-011 | `chains/solana/scripts/parse-historical-buffer.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-012 | `chains/solana/scripts/register-relayer-e5jr.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-013 | `chains/solana/scripts/update-note-leaf-index.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-014 | `chains/solana/scripts/upload-deposit-vk.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-015 | `chains/solana/tests/create-test-deposit.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-016 | `chains/solana/tests/execute-test-deposit.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-017 | `chains/solana/tests/test-withdraw-e2e-fixed.ts` | `rpc_url_with_key` | Real secret indicator | Replace with env-based RPC placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |
| NSB-018 | `circuits/deposit/build/deposit_witness.wtns` | `witness_artifact` | Forbidden artifact | Remove tracked witness artifact in a dedicated cleanup PR outside PR-014F scope | Documented removal required |
| NSB-019 | `frontend/client/src/components/WalletContextProvider.tsx.backup-audit2` | `rpc_url_with_key` | Real secret indicator | Remove backup file or replace with env-based placeholder outside PR-014F scope; rotate referenced RPC credential if still active | Documented rotation required |

## Fixes Applied

- Added scanner unit test script: `npm run security:no-secret-scan:test`.
- Added a configurable scanner root for isolated tests via `NO_SECRET_SCAN_ROOT`.
- Added tests for `.env`, private-key patterns, signer-key filenames, note-state JSON, `.zkey`, witness/proof artifacts, `/data` result paths, redacted output, exact allowlist behavior, and nonzero-finding behavior.
- Updated `.github/workflows/security.yml` so CI runs scanner self-test, scanner unit tests, and the no-secret/artifact scan.
- Expanded `docs/security/no-secret-scan-baseline.json` from path/type entries into explicit path/type/classification/action/status metadata.
- Updated the secret/artifact policy, production security baseline review, dependency risk register, and mainnet blocker register.

## Allowlist Rationale

The baseline is exact `path + issue` only. It does not broad-ignore docs, source folders, generated folders, or file extensions. Any new forbidden artifact or new secret-like content outside those exact entries fails the scan.

The baseline entries are not false positives. They remain tracked remediation work:

- 18 entries require credential rotation if the referenced RPC credentials are still active.
- 1 entry requires forbidden artifact removal.

## Real Secret Exposure Status

Real secret indicators were found for RPC URLs with embedded key-like query parameters. Values were not printed in scanner output, docs, or this report.

No private keys, signer keys, wallet files, note secrets, nullifier secrets, witnesses, operator tokens, or private env contents were printed by PR-014F tooling.

## Rotation Requirements

If any RPC credential referenced by the 18 `rpc_url_with_key` findings is still active, rotate it before public beta/mainnet. Treat the affected source files as previously exposed because they are tracked in git.

The tracked witness artifact must be removed in a dedicated cleanup PR because `circuits/**` is outside PR-014F allowed edit scope.

## CI Behavior

The `Security Guards` workflow now runs:

1. `npm run security:no-secret-scan:self-test`
2. `npm run security:no-secret-scan:test`
3. `npm run security:no-secret-scan`
4. non-gating production dependency audit

The no-secret scan fails on unapproved forbidden artifacts and prints only file path plus issue type. CI does not upload private artifacts.

## Tests Run

Validation commands for PR-014F:

```bash
npm run security:no-secret-scan:test
npm run security:no-secret-scan:self-test
npm run security:no-secret-scan
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
cd relayer && npm run watcher:report
cd chains/solana && npm run test:rust
```

## Remaining Limitations

- The 19 baseline entries still exist in tracked files outside PR-014F scope.
- Credential rotation remains required for active RPC credentials referenced by baseline findings.
- The tracked witness artifact still needs removal in a dedicated circuits cleanup PR.
- Dependency vulnerabilities remain tracked in `docs/security/DEPENDENCY_RISK_REGISTER.md`; PR-014F did not remediate dependencies.
- Mainnet remains blocked on audit, custody, dependency remediation, shared rate limiting, zkey provenance, circuit binding decisions, monitoring, and incident response.

## Next Recommended PR

PR-014G should remove the baseline findings in a scope that allows editing the affected Solana/frontend/circuit paths, rotate any active RPC credentials, and retire `docs/security/no-secret-scan-baseline.json` once the scan passes without baseline entries.
