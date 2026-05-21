# PR-013M - Fresh Solana to Base Check-Ready

## Summary

PR-013M generated a fresh Solana Devnet -> Base Sepolia source event from Codespace, exported the exact Base destination note-state to an outside-repo operator directory, replayed the source fixture into durable paper state, reran Base approval/simulation, and ran guarded submit in check-only mode until it returned `check_ready`.

No Base destination transaction was submitted.

## PR-013L Gate Status

PR-013L added `BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true` for `bridge:solana-to-base:submit-approved`.

Check-only mode:

- Runs approval, Base read-only checks, simulation, and the durable Base destination note-state gate.
- Requires `BRIDGE_DAEMON_MODE=paper`.
- Requires `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.
- Does not load a submitter account.
- Does not call `writeContract`.
- Returns `check_ready` only after the backup gate passes.

## Fresh Source Event Evidence

Execution environment: Codespace using `/workspaces/thewhiteprotocol/thewhiteprotocol.env`.

Operator data directory:

```text
/workspaces/thewhiteprotocol-operator-data
```

Fresh usable source event:

- Solana deposit tx: `3eQHcgwXygwpBuo4i3976oArtW3g5LxoGZHB7TFjM2NzLKcLbz8GDKwm1thnABVnRYgQ29z8ks6Wh2wXbDLfaWGc`
- Solana settlement tx: `5SGqmQVM94Bz2sd2DKtyrnrDD4e2D5kC5c1VfuLwMcvSahHtbi2uMiR4u9bARcToTq7vYouVLiYBrGaQm7qGGf9Y`
- Solana `bridge_out_v1_with_proof` tx: `54ErMCoDAw5Ed9vy5w1QyUzqCEpQB2bMmT1XuNmfZcQrby7kUinF3of59WK8Yk6nqQMrH1y6N3Wp53xSzHnAhvcr`
- Source slot: `463875732`
- Source hash: `0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3`
- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`
- Source amount: `1000000`
- Normalized Base destination amount: `1000000000000000`
- Deadline: `1779363691`
- Source nullifier spent: `true`
- Source value locked: `true`
- Destination tx submitted: `false`

The run first cleared one pre-existing Solana pending deposit with settlement tx `4XXSfs8ZG5KUQvamf4JVDnTNNRdkYW8oH8iNUGh9iAChMV77PUsKo7Xa4kM1XLHbZ2tp9zYGNCCqSGo1MbRdBstd`.

An earlier source-only attempt produced `bridge_out_v1_with_proof` tx `61dC3aHSoqxUfB1Ysy3ZZuZ3ZQ9AZVbu6ePcLLaPrhbN2g7ijGHMGfpVZhsWCjcRFB1YerxweJ22zmGzqvYHHGWt` but failed at the new backup gate because the local backup path was inside the git repo. No Base transaction was submitted for that attempt.

## Durable Fixture Evidence

- Source fixture path: `/workspaces/thewhiteprotocol-operator-data/bridge-results/solana-to-base-source-fixture-0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3.json`
- Durable paper state path: `/workspaces/thewhiteprotocol-operator-data/bridge-results/solana-to-base-paper-state`
- Base destination note-state path: `/workspaces/thewhiteprotocol-operator-data/base-destination-note-state/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`

The note-state backup path is outside the git repo and not under `/tmp`.

## Note-State Validation and Readback

Validation result:

- Status: `note_state_valid`
- Source hash matches: `true`
- Destination hash matches: `true`
- Destination commitment matches: `true`
- Amount matches: `true`
- Asset matches: `true`
- Has destination secret: `true`
- Has destination nullifier: `true`
- Durable path: `true`
- Secrets printed: `false`

Readback result:

- Status: `readback_valid`
- Destination note-state found: `true`
- Durable note-state path: `/workspaces/thewhiteprotocol-operator-data/base-destination-note-state/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`
- Secrets printed: `false`

## Paper Replay Result

- Route: `solana-devnet -> base-sepolia`
- Source event parsed: `true`
- Policy passed: `true`
- Expired deadline: `false`
- Finality satisfied: `true`
- Signatures produced: `2`
- Submit preview created: `true`
- Message persisted: `true`
- Status: `paper_ready_to_submit`
- Destination tx submitted: `false`
- Submit tx hash: `null`

## Approval and Simulation Result

- Approval rerun: `approval_ready`
- Base BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Signer set version: `1`
- Signature count: `2`
- Route enabled: `true`
- Route paused: `false`
- Asset supported: `true`
- Message consumed: `false`
- Message frozen: `false`
- Amount cap passed: `true`
- Simulation attempted: `true`
- Simulation result: passed
- Gas estimate: `969049`
- Destination tx submitted: `false`

## Check-Only Submit Result

`bridge:solana-to-base:submit-approved` was run with:

- `BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`

Result:

- Status: `check_ready`
- Final checks: `true`
- Simulation rerun: `true`
- Simulation ok: `true`
- Base destination note-state valid: `true`
- Submit attempted: `false`
- Submit tx: `null`
- Destination tx submitted: `false`
- Secrets printed: `false`

## No-Submit Proof

- Live submit stayed disabled.
- Check-only mode was used.
- `writeContract` was not called.
- No Base `acceptBridgeMint` transaction was submitted.
- `destinationTxSubmitted=false`.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- The final guarded Base live submit is intentionally not performed in this PR.
- One earlier source-only attempt exists with no Base destination submit because the first local note-state backup path was rejected as repo-local.
- The Base destination note-state backup must be preserved until the eventual destination withdraw/recovery flow completes.

## Next Recommended PR

PR-013N should perform the separately approved guarded one-shot Base `acceptBridgeMint` submit for destination hash `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`, then verify confirmation, consumed status, duplicate-submit rejection, and live-submit disabled after the window.
