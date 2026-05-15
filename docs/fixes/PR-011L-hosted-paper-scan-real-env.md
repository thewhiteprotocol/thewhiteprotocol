# PR-011L — Hosted Paper Scan With Real Env

## Summary

PR-011L attempted to verify the hosted Render relayer after the operator configured hosted env values for bridge daemon paper mode.

The public relayer is live at `https://relayer.thewhiteprotocol.com/`, but the deployed commit reported by Render is `f92e77f3fbe2e07a604c3a4e79b172c6fa49b36e`. That commit does not include the PR-011G/PR-011I daemon paper-scan scripts or daemon status/message endpoints. The hosted service therefore cannot run the PR-011L paper scan until the daemon code is merged and deployed.

No destination transaction was submitted. No private env values, signer keys, RPC URLs with keys, operator token, or `.env` contents were printed.

## Hosted Env Readiness Result

The requested local command was run:

```bash
cd relayer
npm run bridge:daemon:env:check
```

This local shell is not the hosted Render shell and still has no hosted env configured. It reported:

- `ok=false`
- mode: `disabled`
- `liveSubmitEnabled=false`
- missing env names only

This result does not prove the Render env is missing; it only confirms the local shell cannot be used as the hosted env.

## Hosted Service Result

The public health endpoint is live:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/health
```

Result:

- `status=ok`
- live chains include Base Sepolia, BNB testnet, Ethereum Sepolia, Polygon Amoy, and Solana

The hosted bridge status endpoint is reachable:

```bash
curl -fsS https://relayer.thewhiteprotocol.com/bridge/status
```

Result:

- `status=ok`
- `routes=[]`
- `totalTracked=0`
- all bridge message counters were `0`

Daemon endpoints were not available on the hosted deployment:

- `GET /bridge/daemon/status` returned `404`
- `GET /bridge/daemon/messages` returned `404`

Watcher status was auth-gated:

- `GET /bridge/watcher/status` returned `401`

## Deployed Commit Check

Render logs show the service checked out:

- `f92e77f3fbe2e07a604c3a4e79b172c6fa49b36e`

Local inspection of that commit shows:

- `relayer/src/bridge/daemon-paper-scan.ts` is missing
- `relayer/package.json` does not contain `bridge:daemon:paper:scan`
- `relayer/src/bridge/status-api.ts` does not contain `/bridge/daemon/*` endpoints

This explains the hosted 404s and blocks the PR-011L hosted daemon paper scan.

## Exact Env Names Checked

Required hosted paper env names:

- `BASE_SEPOLIA_RPC_URL` or `BASE_RPC_URL`
- `SOLANA_DEVNET_RPC_URL` or `RPC_ENDPOINT`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_SIGNER_MODE`
- `BRIDGE_SIGNER_KEY_FILE` or `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`
- `BRIDGE_OPERATOR_API_TOKEN`
- `BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet`
- `BRIDGE_DAEMON_STATE_PATH`

No env values were printed.

## Route Tested

Intended route:

- Base Sepolia -> Solana Devnet

No hosted daemon route was scanned because the deployed commit does not include the daemon scanner.

## Fresh Live Scan

Requested command:

```bash
cd relayer
npm run bridge:daemon:paper:scan
```

Local result:

- skipped with `missing_or_unsafe_env`
- `destinationTxSubmitted=false`

Hosted result:

- not runnable from public HTTP
- deployed code does not include the scanner script or daemon endpoints

## Scan Range

No hosted scan range was produced.

- latest block: not queried by hosted scanner
- fromBlock: not available
- toBlock: not available
- source block: none
- confirmations: not evaluated

## Event Source

No fresh hosted source event was parsed.

No source event was fabricated.

## Policy Result

No fresh hosted event reached policy evaluation.

## Finality Result

Live finality was not evaluated by the hosted daemon scanner because the deployed code does not include the scanner.

## Watcher Result

Local watcher report command:

```bash
cd relayer
npm run watcher:report
```

Result:

- `ok=true`
- `dryRun=true`
- `autoFreeze=false`
- `totalFindings=0`
- `openFindings=0`
- `liveFreezeTxCount=0`
- `unexpectedLiveFreezeInDryRun=false`

Hosted watcher status is present but requires operator auth, returning `401` for unauthenticated reads.

## Signing Result

No fresh hosted message reached signing.

## Submit Preview Result

No fresh hosted submit preview was generated because no hosted source event was scanned by daemon paper mode.

## Proof No Destination Tx Submitted

Evidence:

- local paper scan skipped and reported `destinationTxSubmitted=false`
- hosted bridge status showed all message counters at `0`
- hosted daemon endpoints returned `404`, so no daemon submission path was exposed
- watcher report showed `liveFreezeTxCount=0`
- no submit transaction hash was produced

## Operator API Verification

Read-only public checks:

- `/health`: reachable
- `/bridge/status`: reachable, no tracked messages
- `/bridge/daemon/status`: `404`
- `/bridge/daemon/messages`: `404`
- `/bridge/watcher/status`: `401`

The hosted daemon operator API could not be verified because the deployed commit lacks `/bridge/daemon/*` endpoints.

## Commands Run

- `cd relayer && npm run bridge:daemon:env:check`
- `curl -fsS https://relayer.thewhiteprotocol.com/health`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/status`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/watcher/status`
- `git show f92e77f3fbe2e07a604c3a4e79b172c6fa49b36e:relayer/src/bridge/status-api.ts`
- `git show f92e77f3fbe2e07a604c3a4e79b172c6fa49b36e:relayer/package.json`
- `git show f92e77f3fbe2e07a604c3a4e79b172c6fa49b36e:relayer/src/bridge/daemon-paper-scan.ts`
- `cd relayer && npm run bridge:daemon:paper:scan`
- `cd relayer && npm run watcher:report`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`

## Passing / Failing Results

Passing:

- hosted `/health`: passed
- hosted `/bridge/status`: passed
- watcher report: passed with `liveFreezeTxCount=0`
- relayer tests: 22 suites / 320 tests
- typecheck: passed
- build: passed

Blocked:

- hosted daemon paper scan: deployed commit lacks scanner code
- hosted `/bridge/daemon/status`: `404`
- hosted `/bridge/daemon/messages`: `404`
- hosted operator daemon API: unavailable until daemon endpoint code is deployed
- fresh live finality/policy/signing/preview: not reached

## Remaining Limitations

- PR-011G/PR-011I daemon code is present in this workspace but is not deployed on Render commit `f92e77f`.
- No fresh Base Sepolia logs were scanned by hosted daemon paper mode.
- No live finality was evaluated by hosted daemon paper mode.
- No fresh message signatures or Solana submit preview were produced.
- Hosted watcher read endpoint is auth-gated.
- Solana destination submission remains preview-only.
- Live-testnet submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011M — merge and deploy the bridge daemon paper-scan code, then rerun hosted paper scan:

- deploy a commit that includes `bridge:daemon:paper:scan` and `/bridge/daemon/*`
- keep `BRIDGE_DAEMON_MODE=paper`
- keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- verify `/bridge/daemon/status` and `/bridge/daemon/messages`
- run the hosted scanner from Render shell/job or add a safe authenticated tick path
- record scan range, source event or clean no-event result, finality evidence, policy result, signing/preview result, and no-submit proof
