# PR-012D - New Note-State Guarded Submit + Settle/Withdraw

## Summary

PR-012D generated a new low-value Base Sepolia -> Solana Devnet bridge message, exported and validated destination note state before live submit, replayed the source event into hosted paper state, simulated the Solana destination submit successfully, and submitted exactly one guarded Solana Devnet destination transaction.

Settlement and withdraw were blocked after Render moved to a new instance. Both the source bridge state file and the `/tmp` exported note-state file were unavailable, so the exact destination note witness for the submitted commitment could not be used.

No additional bridge accept submit was performed.

## PR-012C Not-Recovered Result

PR-012C showed the prior PR-012A destination note state was not recoverable from Render. PR-012D therefore generated a new low-value message only after adding note-state export and validation commands.

## Fresh Source Event Evidence

- Base deposit tx: `0xac101db14b291309323fb64c22dcf11fff229ab57534b8b19b7f437749a64eaa`
- Base settlement tx: `0x1b338b18ac95fa7ec3c0452cbf672e64729bf83f789460162efa81ed547a063c`
- Base bridgeOutV1 tx: `0x4a8b3d840f0fd40f2554fcb9a10f970d434253d75256535db85e7d14671f1eb2`
- Source block: `41557975`
- Source BridgeOut hash: `0x660311dc61370e6ba3ad9793ba1fecbdd4c57169679cdcd1f43527912b06e3c7`
- Destination BridgeMint hash: `0x8a93239d77c22498ce14ab49851d52dfbfe205a3844ea4eb7cab30ac329e44b0`
- Destination commitment: `0x159b9a11b3a6e01e2594ab2f76320c790b77466504fec55303d436bcb323da83`
- Source amount: `1000000000000000` wei
- Destination amount: `1000000` lamports
- Normalization: exact decimal, `18 -> 9`
- Source nullifier spent: `true`

## Note-State Export Evidence

The destination note state was exported before live submit:

- Export command: `cd chains/evm && npm run bridge:export-note-state`
- Export path: `/tmp/white-bridge-note-state/8a93239d77c22498ce14ab49851d52dfbfe205a3844ea4eb7cab30ac329e44b0.bridge-note-state.json`
- Source hash matched: `true`
- Destination hash matched: `true`
- Destination commitment matched: `true`
- `hasDestSecret=true`
- `hasDestNullifier=true`
- Secret values printed: `no`

## Note-State Validation Evidence

The exported note state validated before live submit:

- Validation command: `cd chains/evm && npm run bridge:validate-note-state`
- `valid=true`
- Source hash matched: `true`
- Destination hash matched: `true`
- Destination commitment matched: `true`
- Amount matched: `true`
- Asset matched: `true`
- `hasDestSecret=true`
- `hasDestNullifier=true`
- Secret values printed: `no`

## Replay Evidence

Hosted paper replay:

- State path: `/tmp/bridge-daemon-pr012d`
- Replay range: `41557955` to `41557995`
- Source event parsed: `true`
- Policy passed: `true`
- Expired deadline: `false`
- Finality satisfied: `true`
- Signatures produced: `2`
- Submit preview created: `true`
- Message persisted: `true`
- Destination tx submitted during replay: `false`

## Simulation Evidence

Hosted Solana simulation:

- Simulation attempted: `true`
- Simulation result: `ok`
- `sigVerify=false`
- Compute units: `316845`
- Slot: `462627996`
- `readyForLiveSubmit=true`
- Destination tx submitted during simulation: `false`
- State mutation observed during simulation: `false`

Watcher report before submit:

- Total findings: `1`
- Open findings: `1`
- Critical findings: `0`
- Finding code: `invalid_source_message_type`
- Severity: `high`
- `liveFreezeTxCount=0`

## Guarded Submit Evidence

Guarded live submit command was run for the exact approved message:

- `BRIDGE_DAEMON_MODE=live-testnet`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`
- Route allowlist: `base-sepolia:solana-devnet:3`
- Approved destination hash: `base-sepolia->solana-devnet|0x8a93239d77c22498ce14ab49851d52dfbfe205a3844ea4eb7cab30ac329e44b0`
- Source hash pinned: `0x660311dc61370e6ba3ad9793ba1fecbdd4c57169679cdcd1f43527912b06e3c7`
- Destination hash pinned: `0x8a93239d77c22498ce14ab49851d52dfbfe205a3844ea4eb7cab30ac329e44b0`

Result:

- Submit attempted: `true`
- Submit tx: `2pwYrgvFGzwhciZrwtcQnoYbCfuVdDiMoZLbxpmBwTtZc9uyo8T3BXgEUc9ZJgZqZLe6gUR5EK6n1Kwu89WzkAuG`
- Confirmation status: `confirmed`
- Consumed PDA created: `true`
- Pending buffer updated: `true`
- Destination tx submitted: `true`
- State mutation observed: `true`

Duplicate submit check:

- Status: `already_submitted`
- Submit attempted: `false`
- Duplicate submit blocked: `true`
- Destination tx submitted by duplicate check: `false`
- Error: `message_already_has_submit_tx`

## Live Submit Disabled After Window

After the submit and duplicate check, Render was returned to safe mode:

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `npm run bridge:daemon:env:check` returned `mode=paper` and `liveSubmitEnabled=false`

## Pending Buffer Evidence

Simulation and submit confirmed the Solana program queued the commitment:

- Simulation log: `BridgeV1Mint: commitment queued, pending_index=1, pending_count=2`
- Submit result: `pendingBufferUpdated=true`

The pending buffer was not settled in PR-012D because the exact note-state file became unavailable after Render moved instances.

## Settlement Proof Evidence

Settlement proof was not generated.

Blocker:

- `/tmp/white-bridge-note-state/8a93239d77c22498ce14ab49851d52dfbfe205a3844ea4eb7cab30ac329e44b0.bridge-note-state.json` missing after Render instance change
- `chains/evm/test/base-to-solana-bridge-state-v2.json` also missing on the new Render instance

## Withdraw Proof Evidence

Withdraw proof was not generated.

Blocker:

- The exact destination note witness for `0x8a93239d77c22498ce14ab49851d52dfbfe205a3844ea4eb7cab30ac329e44b0` is unavailable.
- A new note cannot be generated for an already-submitted commitment.

## Duplicate Withdraw Rejection

Duplicate withdraw was not attempted because the first withdraw could not be generated.

## Proof No Additional Bridge Accept Submit Occurred

After the successful guarded submit, the duplicate submit command returned:

- `status=already_submitted`
- `submitAttempted=false`
- `duplicateSubmitBlocked=true`
- `destinationTxSubmitted=false`

No additional bridge accept submit was performed.

## Commands Run

- `npm run bridge:daemon:env:check`
- `npx tsx test/e2e-bridge-base-to-solana.ts`
- `npm run bridge:export-note-state`
- `npm run bridge:validate-note-state`
- `npm run bridge:daemon:paper:replay`
- `npm run bridge:daemon:solana:simulate`
- `npm run watcher:report`
- `npm run bridge:daemon:solana:submit-approved`
- duplicate `npm run bridge:daemon:solana:submit-approved`
- `npx tsx scripts/verify-daemon-mint-settle-withdraw.ts`

## Tests Run

No new code was required for PR-012D. PR-012C validation/test commands were already in place and had passed before this run.

## Remaining Limitations

- The PR-012D destination commitment cannot be withdrawn unless the exact note-state file is recovered.
- `/tmp` is not durable across Render instance replacement.
- The export path must be changed to a persistent Render disk or operator secret-file restore path before any future live submit.
- A pending FIFO queue item was already present before PR-012D (`pending_index=1`), so future settlement automation must handle queue order.

## Next Recommended PR

PR-012E should add a durable Render disk or operator secret-file restore path for destination note state and block guarded live submit unless the note-state backup path is persistent and revalidated after a fresh shell/container restart.
