# Dependency Risk Register

## Summary

PR-014D reran:

```bash
npm audit --audit-level=high --omit=dev
```

Result:

- Total vulnerabilities: 30
- High vulnerabilities: 6
- Moderate vulnerabilities: 12
- Low vulnerabilities: 12
- Transactions submitted: none
- Automatic fix applied: none

No dependency was upgraded in PR-014D. The audit output includes potentially breaking fixes, so remediation is tracked as a follow-up item instead of applying `npm audit fix --force` blindly.

## High-Risk Findings

| Package / Family | Severity | Dependency Path | Runtime Exposure | Audit Fix Posture | Required Action |
| --- | --- | --- | --- | --- | --- |
| `bigint-buffer` | High | `@solana/buffer-layout-utils` -> `@solana/spl-token` / `@solana/web3.js` | Solana runtime and test tooling paths | `npm audit fix --force` would install an old `@solana/spl-token@0.1.8`, which is breaking | Track upstream Solana package remediation, test a targeted Solana dependency upgrade branch, and avoid force downgrade |
| `elliptic` through `ethers` v5 packages | High | `ethers` -> `@ethersproject/*` -> `elliptic` | EVM tooling/runtime paths where ethers v5 remains used | `npm audit fix` may update transitive packages but requires compatibility testing | Inventory ethers v5 usage, prefer viem or ethers v6 where safe, and run EVM/relayer bridge tests before merge |
| `underscore` through `snarkjs` parsing stack | High | `snarkjs` -> `bfj` -> `jsonpath` -> `underscore` | Proof generation / artifact parsing paths | `npm audit fix` available but requires proof-generation compatibility testing | Evaluate `snarkjs` / parser dependency upgrade, test proof generation, and document zkey/proof artifact compatibility |

## Moderate Findings To Track

| Package / Family | Severity | Dependency Path | Required Action |
| --- | --- | --- | --- |
| `uuid` | Moderate | `@solana/web3.js` / `rpc-websockets` | Track upstream Solana dependency update; do not force downgrade `@solana/spl-token` |
| `ws` | Moderate | `viem`, `rpc-websockets`, `@ethersproject/providers` | Test targeted upgrades for viem, rpc-websockets, and ethers-provider paths |

## Remediation Plan

1. Create a dedicated dependency remediation PR that changes only package manifests and lockfiles.
2. Split runtime dependency updates from dev-only updates.
3. Avoid `npm audit fix --force` unless the resulting dependency graph is reviewed and tested.
4. Run full validation after any dependency change:
   - `cd relayer && npm run test`
   - `cd relayer && npm run typecheck`
   - `cd relayer && npm run build`
   - `cd relayer && npm run watcher:smoke`
   - `cd relayer && npm run watcher:report`
   - `cd chains/solana && npm run test:rust`
5. Add a CI audit/SBOM gate before mainnet readiness.

## Mainnet Status

Dependency and supply-chain hygiene remains a mainnet blocker in `docs/audit/MAINNET_BLOCKER_REGISTER.md`.
