# PR-011M — Hosted Paper Scan Around Known BridgeOut Range

## Summary

PR-011M targeted a known Base Sepolia -> Solana Devnet `BridgeOut` event range from PR-010W/PR-011H and verified the paper scanner can find and parse the event from live Base Sepolia RPC.

The known event was found, but it is now historical and the message deadline has expired. Current-time policy correctly rejected it before signing or submit-preview generation. No destination transaction was submitted.

No fresh low-value event was generated because that requires explicit operator approval.

## PR-011L Status And Limitation

PR-011L proved:

- hosted daemon mode is `paper`
- live testnet submit is disabled
- Base Sepolia scan ticks run
- the current 1000-block window returned a clean no-event result
- `/bridge/daemon/status` and `/bridge/daemon/messages` work

Remaining PR-011L limitation:

- no event in the current scan window reached policy/signing/preview

## JSON Artifact Fixes

The deployed relayer logged malformed JSON warnings for EVM deployment artifacts. The committed syntax issue was an extra closing brace in:

- `chains/evm/deployments/base-sepolia.json`
- `chains/evm/deployments/bsc-testnet.json`
- `chains/evm/deployments/polygon-amoy.json`

PR-011M stages a minimal syntax-only fix from `HEAD`:

- no contract addresses changed
- no deployment addresses changed
- JSON parse validation passes for the staged artifact versions

## Known Event Chosen

Chosen event:

- route: Base Sepolia -> Solana Devnet
- source tx: `0xc931d4989abc6fa8c6c85726575780d12370c2a26d38db063c837bd0491ac6d2`
- source block: `41275766`
- source BridgeOut hash: `0xa17dd855e9927eb508e5cea8abec4002c05d79f148a3f84237ae14781eb6edad`

This is the PR-010W / PR-011H historical Base -> Solana source event.

## Scan Range

Known-range scan:

- fromBlock: `41275746`
- toBlock: `41275786`
- lookbackBlocks default: `1000`

## Event Source

The local paper scanner was run with public Base Sepolia RPC and the gitignored local testnet signer file. The command did not print private keys or RPC URLs with keys.

Result:

- `ok=true`
- `mode=paper`
- observed events: `1`
- source tx parsed: `0xc931d4989abc6fa8c6c85726575780d12370c2a26d38db063c837bd0491ac6d2`
- source block parsed: `41275766`
- message hash parsed: `0xa17dd855e9927eb508e5cea8abec4002c05d79f148a3f84237ae14781eb6edad`

## Policy Result

Policy rejected the event because the historical message deadline is expired at current time:

- status: `rejected`
- reason: `expired_deadline`
- severity: `high`

This is expected for an old event replayed through the live/current-time scanner.

## Finality Result

The event is historical and far beyond finality, but policy rejected on deadline before the message could proceed to signing/preview.

## Watcher Result

No watcher critical finding blocked the event. The event was rejected by bridge policy for `expired_deadline`.

Watcher report remained safe:

- dryRun: `true`
- autoFreeze: `false`
- liveFreezeTxCount: `0`

## Signing Result

No signatures were produced because policy rejected the event before signing.

## Submit Preview Result

No submit preview was created because policy rejected the event before signing/preview.

## Proof No Destination Tx Submitted

Evidence:

- mode: `paper`
- live submit enabled: `false`
- scanner result: `destinationTxSubmitted=false`
- tick submitted count: `0`
- persisted message view: `submitTxHash=null`
- watcher report: `liveFreezeTxCount=0`

## Operator API Result

Hosted read endpoints from PR-011L remained the verification surface:

- `/bridge/daemon/status` works
- `/bridge/daemon/messages` works

Hosted scan-range mutation was not performed because no operator token was passed through this transcript.

## Optional Fresh Event Generation Result

Fresh event generation was not performed.

Reason:

- known-range scan found the historical event but it is expired
- generating a new low-value source `BridgeOut` requires explicit operator approval
- no destination submission was enabled

## Commands Run

- `node -e "<deployment JSON parse validation>"`
- `git show :chains/evm/deployments/base-sepolia.json | node -e "<JSON.parse>"`
- `git show :chains/evm/deployments/bsc-testnet.json | node -e "<JSON.parse>"`
- `git show :chains/evm/deployments/polygon-amoy.json | node -e "<JSON.parse>"`
- `cd relayer && BRIDGE_DAEMON_MODE=paper ... BRIDGE_DAEMON_SCAN_FROM_BLOCK=41275746 BRIDGE_DAEMON_SCAN_TO_BLOCK=41275786 npm run bridge:daemon:paper:scan`

## Tests Run

- `cd relayer && npm run test` — passed, 22 suites / 320 tests
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed
- `cd relayer && npm run watcher:smoke` — passed, 6 deterministic findings, 0 freeze submissions
- `cd relayer && STATE_DIR=/tmp/white-bridge-watcher-smoke-w8KOwE npm run watcher:report` — passed, `liveFreezeTxCount=0`

## Remaining Limitations

- The known PR-010W event is now expired under current-time policy.
- No fresh event has been generated.
- No fresh event reached signing or submit preview.
- Hosted scan range cannot be changed through public read-only endpoints.
- Live-testnet submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011N — generate one low-value Base Sepolia -> Solana Devnet source event with explicit operator approval, then run hosted paper scan around that fresh block range:

- keep `BRIDGE_DAEMON_MODE=paper`
- keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- use `WhiteProtocol.bridgeOutV1`
- do not submit destination transaction
- verify policy, finality, watcher allowance, 2 signatures, Solana submit preview, persisted state, and no-submit proof
