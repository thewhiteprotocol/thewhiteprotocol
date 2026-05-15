# PR-011F - Bridge Signer Custody Adapters

**Date:** 2026-05-15
**Status:** Complete; local validation passed

## 1. Summary

PR-011F introduces a bridge signer adapter interface and signing policy gate. It preserves testnet signing, adds local-dev and env/file adapters, adds KMS/HSM/MPC placeholders, blocks unsafe production modes by default, and documents no-secret logging rules.

## 2. Current Testnet Signer Mode

Before PR-011F, `BridgeSignerService` directly accepted raw secp256k1 private keys, signed `hashBridgeMessageV1(message)`, recovered signer addresses, sorted signatures by recovered address, and sliced the configured threshold.

PR-011F keeps that test path through the `env-file` adapter while adding an explicit custody boundary.

## 3. Adapter Interface

Added in `relayer/src/bridge/signer.ts`:

- `BridgeSignerAdapter`
- `BridgeSigningContext`
- `SignerHealth`
- `SignerPolicyDecision`
- `SignatureResult`

Adapters implement:

- `getSignerAddresses`
- `signMessageHash`
- `healthCheck`
- `canSign`

## 4. Supported Modes

- `local-dev`: deterministic local/test keys.
- `env-file`: testnet raw keys from env or key file.
- `kms`: placeholder, unavailable.
- `hsm`: placeholder, unavailable.
- `mpc`: placeholder, unavailable.

## 5. Modes Blocked In Production

The signing policy blocks:

- `local-dev` in `NODE_ENV=production`
- `env-file` in `NODE_ENV=production` unless `BRIDGE_ALLOW_ENV_SIGNER_IN_PRODUCTION=true`

The override remains unsafe for mainnet and exists only to avoid breaking testnet hosted operations.

## 6. KMS/HSM/MPC Future Integration Notes

Placeholders return `not_implemented` health and throw safely on signing. Future adapters should wire managed custody without exposing private material to process logs or repo files.

## 7. Key Rotation Expectations

Signer rotation must coordinate signer set version updates, relayer config changes, in-flight message expiry, and chain-specific finality/timelock rules.

## 8. No-Secret Logging Policy

Signer code does not log private keys or env/file contents. Docs restrict logs to signer addresses, adapter type, threshold, message hash, and policy decisions.

## 9. Signing Policy Gate

The gate blocks signing when:

- bridge policy did not accept the message
- finality is not satisfied
- route is not allowed
- asset is unsupported
- amount is outside cap
- open critical watcher finding exists
- dry-run is active for non-test signing
- adapter mode is unsafe for environment
- purpose is unsupported
- non-test signing lacks `BridgeMessageV1` format

## 10. Tests Added

Added signer tests for local-dev, env-file, placeholders, production-mode blocks, policy gate failures, dry-run behavior, and raw-message rejection.

## 11. Commands Run

```bash
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
```

Additional targeted check:

```bash
cd relayer && npx jest src/bridge/__tests__/signer.test.ts
```

Results:

- Signer tests: 1 suite / 22 tests passed.
- Relayer tests: 20 suites / 293 tests passed.
- Typecheck: passed.
- Build: passed.

## 12. Remaining Limitations

- No real KMS/HSM/MPC integration.
- No production signer custody.
- No live freeze execution.
- Raw env/file signer remains testnet-only.
- `public_data_hash` remains weak/dummy-constrained in-circuit.

## 13. Next Recommended PR

PR-011G - daemonized bridge relayer paper/live-testnet mode.
