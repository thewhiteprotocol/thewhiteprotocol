# PR-011S — Hosted Solana Simulation For Approved PR-011N Message

## Summary

PR-011S adds a safe hosted simulation command for the approved PR-011N Base Sepolia -> Solana Devnet destination BridgeMint message.

The command checks hosted env readiness by name only, verifies that `BRIDGE_APPROVED_MESSAGE_HASHES` contains the destination BridgeMint hash, loads the persisted daemon message, re-runs read-only Solana idempotency checks, and simulates the assembled `accept_bridge_v1_mint` transaction with `sigVerify=false`.

In the local shell, hosted simulation was blocked because the required hosted env/state were not present. No RPC call was made and no transaction was submitted.

## Approved Message Hash

- Route: `base-sepolia->solana-devnet`
- Source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- Destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`
- Signer set version: `2`
- Solana program: `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`

## Hosted Env And Approval Status

Command added:

```bash
cd relayer && npm run bridge:daemon:solana:simulate
```

Required env names:

- `SOLANA_DEVNET_RPC_URL` or `RPC_ENDPOINT`
- `BRIDGE_DAEMON_STATE_PATH` or `STATE_DIR`
- `BRIDGE_APPROVED_MESSAGE_HASHES`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` or unset
- `BRIDGE_DAEMON_MODE=paper` or another non-submitting safe mode

Required approval value:

```text
base-sepolia->solana-devnet|0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56
```

The command does not print RPC values, signer keys, operator tokens, or private env contents.

## Read-Only Idempotency Checks

When env and state are present, the command checks:

- program executable
- BridgeV1Config exists
- signer set v2 exists
- route config exists
- asset config exists
- pending buffer exists
- pool config exists
- Merkle tree exists
- asset vault exists
- consumed message PDA absent
- frozen message PDA absent
- commitment index PDA absent

If any check fails, simulation is blocked and no transaction is sent.

## Simulation Request

The command assembles:

- compute budget instructions
- `accept_bridge_v1_mint`
- destination BridgeMint message
- 2 threshold signatures from persisted paper daemon state
- signer set version `2`
- real deployed Solana Devnet accounts

Then it calls simulation only:

- `simulateTransaction`
- `sigVerify=false`
- no `sendTransaction`
- no `sendRawTransaction`

## Simulation Result

Local result:

- simulation attempted: no
- reason: hosted env/state missing locally
- missing names:
  - `SOLANA_DEVNET_RPC_URL or RPC_ENDPOINT`
  - `BRIDGE_DAEMON_STATE_PATH or STATE_DIR`
  - `BRIDGE_APPROVED_MESSAGE_HASHES`
  - `BRIDGE_APPROVED_MESSAGE_HASHES(destination BridgeMint hash)`
- destination transaction submitted: no
- submit tx hash: `null`

Hosted result:

- not run from this local shell
- ready to run after hosted env includes the approval hash and daemon state path

## Logs And Compute Units

No live simulation logs or compute units were produced locally because the command stopped before RPC access.

When run on hosted env, the command records:

- sanitized logs preview
- compute units if available
- slot if available
- simulation status
- `readyForLiveSubmit`

## Proof No Transaction Was Sent

- command uses simulation helper only
- send APIs are not called
- local run stopped before RPC access
- output included `destinationTxSubmitted=false`
- output included `submitTxHash=null`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT` remained unset/false in the local command environment

## Operator API And Status Result

Operator API was not queried in the local shell for PR-011S.

Reason: the hosted daemon message state and operator token are hosted secrets. The command validates persisted daemon state directly when run in the hosted environment.

## Commands Run

- `cd relayer && npm run bridge:daemon:solana:simulate` — safely blocked before RPC due missing local hosted env/state
- `cd relayer && npm run test` — passed
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed
- `cd relayer && npm run watcher:smoke` — passed
- `cd relayer && npm run watcher:report` — passed

## Passing And Failing Results

Passing:

- env checker reports names only
- source BridgeOut hash-only approval remains rejected
- destination BridgeMint approval is accepted
- live submit flag is blocked
- relayer tests/typecheck/build pass
- watcher smoke/report pass

Blocked:

- hosted live simulation was not attempted locally because required hosted env/state were absent

## Remaining Limitations

- Hosted Solana RPC simulation still needs to be run on Render or an equivalent environment with the real state path and approval env configured.
- No transaction submit path exists.
- `liveSubmissionImplemented=false`.
- `readyForLiveSubmit` must not be treated as permission to submit until a future live-submit PR adds explicit send-path controls.
- Mainnet remains unsupported.
- Not production-ready.

## Next Recommended PR

PR-011T — run hosted approved-message Solana simulation on Render and capture result:

- configure `BRIDGE_APPROVED_MESSAGE_HASHES` with the destination BridgeMint hash
- run `npm run bridge:daemon:solana:simulate` on hosted env
- record read-only idempotency checks
- record simulation logs and compute units
- keep live submit disabled
