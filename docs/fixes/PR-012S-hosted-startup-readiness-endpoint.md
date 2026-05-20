# PR-012S - Hosted Startup Readiness Endpoint

## Summary

PR-012S exposes non-secret hosted startup readiness from the running relayer. The startup wrapper now writes a persistent startup status file, and the relayer exposes a read-only endpoint that summarizes zkey bootstrap, symlink, safe-mode, live-submit guard, operator prerequisite, path, watcher, job-index, and operator-status readiness.

No bridge accept, settlement, withdraw, proof generation, circuit, contract, or Solana program change is included.

## Why PR-012S Follows PR-012R

PR-012R made Render startup run zkey bootstrap before relayer launch. Operators still needed a simple way to verify that the currently running hosted service actually started with those checks. PR-012S adds that observable, non-secret proof.

## Startup Status File

Default path:

```text
/data/bridge-results/hosted-startup-status.json
```

Configurable:

```text
BRIDGE_HOSTED_STARTUP_STATUS_PATH
```

Fields include:

- `timestamp`
- `gitCommit`
- `hostedBootstrapEnabled`
- `failClosed`
- `zkeyBootstrapAttempted`
- `zkeyBootstrapOk`
- `merkleZkeyHashOk`
- `withdrawZkeyHashOk`
- `merkleSymlinkOk`
- `withdrawSymlinkOk`
- `operatorPrereqAttempted`
- `operatorPrereqOk`
- `daemonMode`
- `liveSubmitEnabled`
- `circuitArtifactDir`
- `noteStateDir`
- `bridgeResultsDir`
- `readiness`
- `transactionsSubmitted=false`
- `proofsGenerated=false`
- `secretsPrinted=false`

Readiness values include:

```text
ready
blocked_zkeys
blocked_operator_prereq
blocked_live_submit_guard
warning_operator_prereq_skipped
```

## Readiness Endpoint

Endpoint:

```text
GET /bridge/operator/readiness
```

This endpoint is read-only and has no mutation behavior. It returns:

- startup status file presence/path
- startup readiness
- hosted bootstrap flag
- zkey bootstrap status
- zkey hash status
- symlink status
- operator prerequisite status
- safe mode status
- live-submit guard status
- persistent path presence
- latest operator status summary if available
- latest watcher report summary if available
- latest operator job index summary if available
- no transaction/proof/secret flags

## Output Fields

Important top-level fields:

```text
ok
generatedAt
startupStatusPath
startupStatusPresent
readiness
hostedBootstrapEnabled
zkeys
operatorPrereq
safeMode
liveSubmitGuard
paths
latestOperatorStatus
latestWatcherReport
latestJobIndex
transactionsSubmitted
proofsGenerated
secretsPrinted
```

If the startup status file is missing, the endpoint returns:

```text
readiness=unknown_startup_status
ok=false
```

If live submit is enabled without valid startup bootstrap evidence, it returns:

```text
readiness=blocked_live_submit_guard
```

## Secret Redaction Policy

The endpoint and startup file must not expose:

- RPC URLs
- operator tokens
- private keys
- signer keys
- wallet files
- destination note secrets
- destination nullifier secrets
- witnesses
- raw proof data
- raw env values

Only non-secret paths, hashes, booleans, status strings, tx IDs already present in non-secret job summaries, and aggregate counts are exposed.

## Render Verification Commands

After Render deploy:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/health
curl -fsS https://relayer.thewhiteprotocol.com/bridge/operator/readiness
curl -fsS https://relayer.thewhiteprotocol.com/bridge/status
curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status
```

Expected for safe hosted startup:

```text
startupStatusPresent=true
zkeys.bootstrapOk=true
zkeys.merkleHashOk=true
zkeys.withdrawHashOk=true
zkeys.merkleSymlinkOk=true
zkeys.withdrawSymlinkOk=true
safeMode.daemonMode=paper
safeMode.liveSubmitEnabled=false
liveSubmitGuard.ok=true
transactionsSubmitted=false
proofsGenerated=false
secretsPrinted=false
```

## Tests Run

Focused tests:

```bash
npm run test:hosted-start
cd relayer && npx jest src/bridge/__tests__/operator-readiness.test.ts --runInBand
```

Full validation is recorded in the terminal summary.

## Remaining Limitations

- The endpoint reports startup/bootstrap evidence from the running service; live PDA/RPC recovery state still requires `npm run bridge:recovery:snapshot`.
- Local Codespace does not mount Render `/data` zkeys, so hosted zkey bootstrap remains a Render-side verification.
- Operator prerequisite is still optional at startup unless `BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ=true`.

## Next Recommended PR

PR-012T should verify the new readiness endpoint on Render after deploy and capture the hosted response alongside `/health`, `/bridge/status`, and `/bridge/daemon/status` without exposing secrets.
