# Dependency Risk Register

## Summary

PR-014E reran dependency audit triage.

Commands:

```bash
npm audit --json --omit=dev
npm audit --json
npm audit fix --omit=dev --package-lock-only --dry-run
```

Production audit result:

- Total vulnerabilities: 30
- High vulnerabilities: 6
- Critical vulnerabilities: 0
- Safe automatic remediation applied: none

Full workspace audit result:

- Total vulnerabilities: 102
- Critical vulnerabilities: 5
- High vulnerabilities: 30
- Safe automatic remediation applied: none

`npm audit fix --omit=dev --package-lock-only --dry-run` failed before proposing a safe lockfile-only remediation because the workspace has an existing React 18 vs LayerZero devtools React 17 peer conflict. `npm audit fix --force` was not used.

## Production High Vulnerability Triage

| ID | Package | Severity | Direct / Transitive | Runtime / Dev | Current Version | Fixed Version If Known | Risk Summary | Remediation | Status | Owner | Recommended PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEP-001 | `bigint-buffer` | High | Transitive through `@solana/buffer-layout-utils` / `@solana/spl-token` | Runtime Solana paths | `1.1.5` | None available through current Solana stack; npm suggests breaking `@solana/spl-token@0.1.8` downgrade | Buffer overflow advisory in a Solana dependency used by token/account helpers | Do not force downgrade; test upstream Solana package remediation in a dedicated dependency PR | Blocked by upstream / requires targeted Solana stack review | TBD | PR-014F |
| DEP-002 | `@solana/spl-token` audit group | High | Direct workspace dependency, high inherited from transitive deps | Runtime Solana paths | `0.4.14` | npm suggests `0.1.8`, a breaking downgrade | Current audit resolver treats the package as affected because of `bigint-buffer` and web3 transitive findings | Keep current version; wait for compatible Solana ecosystem fix or controlled migration | Deferred, force fix rejected | TBD | PR-014F |
| DEP-003 | `bfj` | High | Transitive through `snarkjs` | Runtime proof/artifact parsing paths | `7.1.0` nested under `snarkjs` | `9.1.3` | Depends on vulnerable `jsonpath` / `underscore`; used in proof tooling path | Do not override under `snarkjs` without proof-generation compatibility tests; evaluate `snarkjs` upgrade or override in dedicated PR | Deferred, requires proof compatibility validation | TBD | PR-014F |
| DEP-004 | `jsonpath` | High | Transitive through `snarkjs` -> `bfj` | Runtime proof/artifact parsing paths | `1.3.0` | No direct replacement in current tree | Pulls vulnerable `underscore` | Remediate through `bfj` / `snarkjs` path only after proof tooling tests | Deferred, tied to DEP-003 | TBD | PR-014F |
| DEP-005 | `underscore` | High | Transitive through `jsonpath` | Runtime proof/artifact parsing paths | `1.13.6` nested under `jsonpath` | `1.13.8` | DoS advisory in recursive helpers | Remediate through upstream path or controlled override with proof tests | Deferred, tied to DEP-003 | TBD | PR-014F |
| DEP-006 | `@solana/buffer-layout-utils` audit group | High | Transitive through `@solana/spl-token` | Runtime Solana paths | `0.2.0` | None available through current Solana stack | Inherits `bigint-buffer` / web3 advisories | Track upstream and test targeted Solana dependency branch | Blocked by upstream / requires targeted Solana stack review | TBD | PR-014F |

## Moderate Findings To Track

| Package | Current Version | Runtime / Dev | Notes |
| --- | --- | --- | --- |
| `@solana/web3.js` | `1.98.4` | Runtime | Moderate through `jayson` / `uuid`; npm force path is not acceptable because it downgrades SPL token |
| `uuid` | `8.3.2` in Solana/RPC paths | Runtime | Moderate; upstream dependency migration required |
| `ws` | `8.18.0` / `8.18.3` in EVM/RPC paths | Runtime | Moderate in production audit, high in full workspace audit due older dev/EVM tooling nodes |
| `viem` | `2.48.0` | Runtime | Moderate via `ws`; update should be tested separately with EVM bridge adapter tests |
| `elliptic` | `6.6.1` | Runtime through ethers v5 / circomlibjs | Low in production audit, critical in full workspace audit due dev/EVM tooling paths |

## Full Workspace Critical / High Dev-Tooling Notes

The full audit includes critical/high findings in EVM dev tooling and LayerZero/Hardhat dependency trees. These are not part of the hosted relayer runtime, but they remain supply-chain blockers before mainnet:

- `@ethersproject/signing-key` / `elliptic` through ethers v5 tooling;
- LayerZero devtool package families;
- older OpenZeppelin / Hardhat / web3 / zksync-ethers transitive paths;
- `undici` through Hardhat;
- `ws` through dev/provider packages.

These should be remediated in a dedicated EVM tooling dependency PR with Forge/Hardhat validation.

## Remediation Decision

No dependency was remediated in PR-014E because the safe non-forced path is blocked by peer dependency conflicts, and the suggested force fixes include breaking downgrades or broad toolchain changes. Applying those changes inside this API/security PR would create avoidable protocol-tooling risk.

## Required Follow-Up

1. Create a dedicated dependency remediation branch.
2. Split relayer runtime, Solana runtime, proof tooling, and EVM dev-tooling updates.
3. Avoid `npm audit fix --force` unless every resulting dependency change is reviewed.
4. Add SBOM generation and audit review to CI.
5. Run full validation after each dependency group update.
