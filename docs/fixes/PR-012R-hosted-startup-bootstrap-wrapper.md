# PR-012R - Hosted Startup Bootstrap Wrapper

## Summary

PR-012R adds a fail-closed hosted relayer startup wrapper that can automatically run the non-mutating zkey bootstrap before the relayer process starts. The wrapper is intended for Render deploys where repo-local zkey symlinks are ephemeral but persistent zkeys live under `/data/circuit-artifacts`.

No bridge accept, settlement, withdraw, proof generation, or circuit/program/contract change is performed by this PR.

## Why PR-012R Follows PR-012Q

PR-012Q added a read-only operator status summary for persistent bootstrap, preflight, recovery snapshot, leaf-index evidence, and job readiness. That still required operators to remember to run `npm run bridge:bootstrap:zkeys` manually after Render redeploys. PR-012R moves the zkey symlink repair into hosted startup when explicitly enabled.

## Startup Wrapper Command

Root package command:

```bash
npm run relayer:start:hosted
```

Direct command:

```bash
bash scripts/hosted-relayer-start.sh
```

The wrapper:

- detects the repository root with `git rev-parse --show-toplevel`;
- runs `cd chains/solana && npm run bridge:bootstrap:zkeys` when hosted bootstrap is enabled;
- optionally runs `npm run bridge:operator:prereq`;
- optionally runs `npm run bridge:operator:status` when a destination hash is configured;
- starts the existing relayer start command only after required checks pass.

## Render Start Command

`render.yaml` now uses:

```yaml
startCommand: bash scripts/hosted-relayer-start.sh
```

No secret values are hardcoded in Render config. Persistent disk paths remain:

```text
/data/circuit-artifacts
/data/white-bridge-note-state
/data/bridge-results
```

## Hosted Env Flags

```text
BRIDGE_HOSTED_STARTUP_BOOTSTRAP=true
BRIDGE_HOSTED_REQUIRE_ZKEYS=true
BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ=false
BRIDGE_HOSTED_FAIL_CLOSED=true
BRIDGE_CIRCUIT_ARTIFACT_DIR=/data/circuit-artifacts
BRIDGE_RESULTS_DIR=/data/bridge-results
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state
```

`BRIDGE_RELAYER_START_COMMAND` can override the final relayer command. The default remains `npm run relayer:start`.

## Fail-Closed Behavior

If hosted bootstrap is enabled and zkey bootstrap fails:

- `BRIDGE_HOSTED_FAIL_CLOSED=true`: startup exits nonzero and the relayer does not start.
- `BRIDGE_HOSTED_FAIL_CLOSED=false`: startup forces `BRIDGE_DAEMON_MODE=disabled` and `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` before starting the relayer.

If `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true` and required bootstrap/prereq checks fail, startup exits nonzero regardless of `BRIDGE_HOSTED_FAIL_CLOSED`.

## Local/Dev Behavior

`BRIDGE_HOSTED_STARTUP_BOOTSTRAP` defaults to disabled. Local development can continue to use:

```bash
npm run relayer:start
```

or the hosted wrapper with bootstrap disabled. In that mode, missing `/data` paths do not block startup.

## Zkey Persistent Disk Requirements

The startup bootstrap verifies and recreates symlinks for:

```text
/data/circuit-artifacts/merkle_batch_update/merkle_batch_update.zkey
/data/circuit-artifacts/withdraw/withdraw.zkey
```

Expected hashes:

```text
merkle_batch_update.zkey = 107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9
withdraw.zkey            = cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0
```

Repo-local symlinks recreated at startup:

```text
circuits/merkle_batch_update/build/merkle_batch_update.zkey
circuits/withdraw/build/withdraw.zkey
```

## Operator Prerequisite/Status Checks

`BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ=true` makes startup require:

```bash
cd chains/solana && npm run bridge:operator:prereq
```

When prereq is not required but a destination hash is configured, startup runs status as best-effort:

```bash
cd chains/solana && npm run bridge:operator:status
```

Status failures do not block unless prereq is explicitly required.

## Tests Run

Implemented:

```bash
npm run test:hosted-start
```

The test covers disabled hosted bootstrap, missing zkeys, valid zkeys, live-submit startup guard, fail-closed false safe-mode fallback, required operator prereq blocking, secret redaction, and Render start-command wiring.

Full repository validation was run in Codespace where supported and documented in the terminal summary.

## Remaining Limitations

- The wrapper repairs zkey symlinks automatically, but operators still need fresh preflight and recovery snapshot reports for settle/withdraw execution windows.
- `BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ` is disabled by default because the main hosted relayer can run without a single active destination hash.
- Live PDA/RPC recovery observations still come from `npm run bridge:recovery:snapshot`.

## Next Recommended PR

PR-012S should add a hosted non-secret startup/readiness endpoint or health detail that exposes the latest startup bootstrap result and operator status summary without leaking env values or secrets.
