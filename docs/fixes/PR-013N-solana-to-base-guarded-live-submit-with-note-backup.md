# PR-013N - Solana to Base Guarded Live Submit With Note Backup

## Summary

PR-013N performed the guarded one-shot Base Sepolia `BridgeInbox.acceptBridgeMint` submit for the PR-013M approved Solana Devnet -> Base Sepolia message.

Exactly one Base destination transaction was submitted for destination BridgeMint hash:

```text
0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d
```

No other destination message was submitted.

## PR-013M Check-Ready Evidence

- Source tx: `54ErMCoDAw5Ed9vy5w1QyUzqCEpQB2bMmT1XuNmfZcQrby7kUinF3of59WK8Yk6nqQMrH1y6N3Wp53xSzHnAhvcr`
- Source slot: `463875732`
- Source hash: `0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3`
- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`
- Durable fixture: `/workspaces/thewhiteprotocol-operator-data/bridge-results/solana-to-base-source-fixture-0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3.json`
- Durable Base note-state: `/workspaces/thewhiteprotocol-operator-data/base-destination-note-state/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`
- Paper replay: `paper_ready_to_submit`
- Signatures produced: `2`
- Approval rerun: `approval_ready`
- Simulation result: passed
- Pre-submit gas estimate: `969049`
- Check-only submit: `check_ready`
- Destination tx submitted before PR-013N: `false`

## Final Check-Only Result

Immediately before the live submit window, `bridge:solana-to-base:submit-approved` was rerun with:

- `BRIDGE_SUBMIT_APPROVED_CHECK_ONLY=true`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`

Result:

- Status: `check_ready`
- Final checks: `true`
- Simulation rerun: `true`
- Simulation ok: `true`
- Base note-state valid: `true`
- Submit attempted: `false`
- Destination tx submitted: `false`

## Base Note-State Gate Result

Final note-state validation and readback passed:

- Source hash match: `true`
- Destination hash match: `true`
- Destination commitment match: `true`
- Amount match: `true`
- Asset match: `true`
- Has destination secret: `true`
- Has destination nullifier: `true`
- Durable path: `true`
- Outside repo: `true`
- Secrets printed: `false`

## Guarded Submit Result

The live submit command was scoped to:

- `BRIDGE_DAEMON_MODE=live-testnet`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`
- `BRIDGE_DAEMON_ROUTES=solana-devnet:base-sepolia:1`
- route-scoped approved destination hash `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`

Result:

- Submit attempted: `true`
- Base submit tx: `0x18b0d4a25ea9087630b0eed09d2399a33d16c8788290cad2d379619aedc96556`
- Confirmation: `success`
- Block number: `41794491`
- Gas used: `957439`
- Message consumed: `true`
- Commitment inserted: `true`
- Destination tx submitted: `true`
- Secrets printed: `false`

## Duplicate Submit Result

After the successful submit, the guarded submit command was rerun in check-only mode.

Result:

- Status: `already_submitted`
- Error: `message_already_has_submit_tx_hash`
- Submit attempted: `false`
- Duplicate submit blocked: `true`
- No second Base tx was submitted.

Read-only approval after submit also reported:

- Base `messageConsumed=true`
- Simulation blocked with `MessageAlreadyConsumed`

## Safe-Mode Restoration

The live-submit settings were command-scoped only. After the submit window, the local default env remained:

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep` - passed
- `cd relayer && npm run test` - passed, 28 suites / 398 tests
- `cd relayer && npm run typecheck` - passed
- `cd relayer && npm run build` - passed
- `cd relayer && npm run watcher:smoke` - passed
- `cd relayer && npm run watcher:report` - passed
- `cd chains/solana && npm run test:rust` - passed, 115 tests

## Remaining Limitations

- Base destination withdraw was not attempted in this PR.
- The Base destination note-state backup must be preserved until destination withdraw/recovery is complete.
- One earlier source-only attempt remains source-side only because its first local backup path was rejected as repo-local; no Base destination tx was submitted for that attempt.

## Next Recommended PR

PR-013O should prepare Base destination withdraw/recovery for destination commitment `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`, using the preserved durable Base destination note-state backup.
