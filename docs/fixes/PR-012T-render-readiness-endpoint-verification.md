# PR-012T - Render Readiness Endpoint Verification

## Summary

PR-012T verified the public hosted readiness/status endpoints after PR-012S. The relayer is serving the new `GET /bridge/operator/readiness` endpoint, `/health`, `/bridge/status`, and `/bridge/daemon/status`.

The verification is blocked from full acceptance because the running service reports:

```text
startupStatusPresent=false
readiness=unknown_startup_status
hostedBootstrapEnabled=false
```

That means the PR-012S endpoint code is live, but the Render process did not produce `/data/bridge-results/hosted-startup-status.json`. The likely operational blocker is that the running Render service start command has not invoked `bash scripts/hosted-relayer-start.sh`, or it was started before the wrapper/status-file path was active.

No transaction was submitted, no proof was generated, and no secrets were printed.

## Render Deployed Commit

Render shell git confirmation was not available from this workspace. Public endpoint evidence shows the PR-012S readiness endpoint is deployed, but the startup status file that would include `gitCommit` is absent.

Required Render shell confirmation remains:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
git rev-parse --short HEAD
```

Expected: `ac46566` or newer.

## Startup Status File Result

Endpoint-reported path:

```text
/data/bridge-results/hosted-startup-status.json
```

Endpoint result:

```text
startupStatusPresent=false
readiness=unknown_startup_status
hostedBootstrapEnabled=false
```

Required Render shell check remains:

```bash
ls -lh /data/bridge-results/hosted-startup-status.json
cat /data/bridge-results/hosted-startup-status.json
```

Expected after wrapper startup:

```text
zkeyBootstrapOk=true
merkleZkeyHashOk=true
withdrawZkeyHashOk=true
merkleSymlinkOk=true
withdrawSymlinkOk=true
daemonMode=paper
liveSubmitEnabled=false
```

## `/health` Result

Command:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/health
```

Result:

```text
status=ok
proofVerificationEnabled=true
pendingNullifiers=0
withdrawal circuit breaker=CLOSED
sequencer.running=true
evmSequencers.base-sepolia.running=true
```

No secret fields were observed.

## `/bridge/status` Result

Command:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/bridge/status
```

Result:

```text
status=ok
totalTracked=0
messageCounts all zero
```

No secret fields were observed.

## `/bridge/daemon/status` Result

Command:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status
```

Result:

```text
mode=paper
enabled=true
running=true
allowLiveTestnetSubmit=false
route=base-sepolia->solana-devnet
signer.adapterType=env-file
signer.threshold=2
```

No private signer material, token, RPC URL, or wallet file was exposed.

## `/bridge/operator/readiness` Result

Command:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/bridge/operator/readiness
```

Result:

```text
ok=false
startupStatusPath=/data/bridge-results/hosted-startup-status.json
startupStatusPresent=false
readiness=unknown_startup_status
hostedBootstrapEnabled=false
safeMode.daemonMode=paper
safeMode.liveSubmitEnabled=false
safeMode.ok=true
liveSubmitGuard.ok=true
liveSubmitGuard.status=disabled
paths.circuitArtifactDir.present=true
paths.noteStateDir.present=true
paths.bridgeResultsDir.present=true
latestJobIndex.present=true
latestJobIndex.jobCount=3
latestJobIndex.latestStatus=dry_run_ready
transactionsSubmitted=false
proofsGenerated=false
secretsPrinted=false
```

The endpoint is live and redacted, but readiness is blocked because startup status evidence is missing.

## Safe Mode Verification

Safe mode was confirmed from public endpoint output:

```text
BRIDGE_DAEMON_MODE equivalent: paper
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT equivalent: false
live submit enabled: false
```

The readiness endpoint also reports `liveSubmitGuard.status=disabled`.

## Secret Redaction Verification

The checked endpoint outputs did not expose:

- RPC URLs
- operator tokens
- private keys
- signer keys
- wallet file paths
- destination note secrets
- destination nullifier secrets
- witnesses
- raw env values

## Commands Run

Hosted/public:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/health
curl -fsS https://relayer.thewhiteprotocol.com/bridge/status
curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status
curl -fsS https://relayer.thewhiteprotocol.com/bridge/operator/readiness
```

Local validation:

```bash
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
cd relayer && npm run watcher:report
```

## Tests Run

```text
relayer tests: 26 suites / 361 tests passed
typecheck: passed
build: passed
watcher smoke: passed
watcher report: passed
```

Solana Rust/SBF validation was already completed in Codespace for PR-012S.

## Remaining Limitations

- Render shell commit confirmation still needs to be run by an operator.
- `/data/bridge-results/hosted-startup-status.json` is missing on the running service.
- Render start command must be confirmed to use `bash scripts/hosted-relayer-start.sh`.
- After correcting startup, the operator should redeploy and rerun this verification.

## Next Recommended PR

PR-012U should update the Render service start command or dashboard configuration if needed, redeploy, and verify that `/data/bridge-results/hosted-startup-status.json` is created and that `/bridge/operator/readiness` reports zkey bootstrap and symlink success.
