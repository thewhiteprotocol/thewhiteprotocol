# Bridge Signer Custody Runbook

**Date:** 2026-05-15
**Status:** Testnet adapter interface; not production custody

## 1. Summary

PR-011F introduces a bridge signer custody adapter interface and a signing policy gate. It keeps current testnet signing behavior available, adds explicit unsafe-mode blocks for production, and defines placeholders for future KMS, HSM, and MPC custody.

This does not make bridge signing production-ready.

## 2. Current Testnet Signer Mode

Current bridge signing uses secp256k1 private keys to sign canonical `BridgeMessageV1` hashes. Signatures are recovered with `viem`, sorted by recovered signer address ascending, and sliced to the configured threshold.

Private keys may come from:

- deterministic local-dev test keys
- `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`
- a gitignored `BRIDGE_SIGNER_KEY_FILE`
- legacy `.bridge-signers.env` style keys such as `BRIDGE_SIGNER_1_PRIVATE_KEY`

Do not commit signer files or raw key values.

## 3. Adapter Interface

The adapter interface exposes:

- `getSignerAddresses()`
- `signMessageHash(messageHash, context)`
- `healthCheck()`
- `canSign(context)`

Signing context includes route, domains, asset, amount, risk level, dry-run state, signer set version, purpose, and policy-gate booleans.

## 4. Supported Modes

| Mode | Status | Purpose |
| --- | --- | --- |
| `local-dev` | implemented | deterministic local/test signing only |
| `env-file` | implemented | testnet raw-key signing from env or gitignored file |
| `kms` | placeholder | future managed-key integration |
| `hsm` | placeholder | future hardware-backed integration |
| `mpc` | placeholder | future distributed signing integration |

## 5. Modes Blocked In Production

Production blocks by default:

- `local-dev`
- `env-file`

`env-file` can only pass production policy with the explicit override `BRIDGE_ALLOW_ENV_SIGNER_IN_PRODUCTION=true`. That override is for emergency/testnet-hosted use only and must not be treated as mainnet custody.

## 6. Future KMS/HSM/MPC Notes

Future adapters should:

- sign only canonical message hashes after policy acceptance
- expose public signer addresses without exposing private material
- provide health and key version metadata
- support key rotation and signer set version tracking
- return deterministic unavailable states when custody is unreachable
- never log request secrets or key material

## 7. Key Rotation Expectations

Rotation should be tied to signer set version:

1. Add new custody-backed signer addresses.
2. Update signer set on each destination chain.
3. Wait for configured timelock/finality.
4. Update relayer signer config.
5. Verify threshold signatures against the new signer set.
6. Retire old keys after all in-flight messages settle or expire.

## 8. No-Secret Logging Policy

Allowed in logs:

- adapter type
- signer addresses
- threshold
- message hash
- policy decision and reason codes

Forbidden in logs:

- private keys
- env var values
- key file contents
- `.bridge-signers.env` contents
- RPC secrets
- operator tokens
- webhook URLs

## 9. Signing Policy Gate

Before bridge attestation signing, policy must require:

- source message accepted by bridge policy
- finality satisfied
- route allowed
- asset supported
- amount within cap
- no open critical watcher finding for the message
- dry-run not active for live attestation
- adapter mode allowed for current environment
- purpose is supported
- message format is `BridgeMessageV1`

Freeze signing remains design-only and should not be wired to live freeze execution in this PR.

## 10. Tests Added

PR-011F adds coverage for:

- local-dev signing and recovered addresses
- env-file parsing from a temp test file
- no private key exposure in signer errors
- signature sorting
- threshold enforcement
- production rejection of unsafe modes
- placeholder unavailable behavior
- route/finality/watcher critical policy blocks
- dry-run signing block
- raw non-`BridgeMessageV1` signing rejection

## 11. Remaining Limitations

- No real KMS/HSM/MPC integration.
- No production signer custody.
- No live freeze signing.
- Raw env/file signer remains testnet-only.
- Mainnet readiness still requires hardened circuit binding, custody, approvals, and audit logging.

## 12. Next Recommended PR

PR-011G - daemonized bridge relayer paper/live-testnet mode.

