# PR-011Q — Solana Destination Transaction Assembly Dry-Run

## Summary

PR-011Q adds a dry-run transaction assembly path for Solana `accept_bridge_v1_mint`.

The relayer can now build a local unsigned Solana transaction preview with compute budget instructions and the `accept_bridge_v1_mint` instruction, validate account metas against the Rust/Anchor account order, and serialize the transaction bytes locally without sending.

No Solana transaction was submitted.

## What PR-011P Completed

PR-011P corrected the Base Sepolia -> Solana Devnet submit preview:

- source BridgeOut hash is preserved as `sourceMessageHash`
- destination BridgeMint hash is used as `messageHash` / `destinationMessageHash`
- consumed/frozen PDAs derive from the destination BridgeMint hash
- signer set version is `2`
- signer set PDA is `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`
- deployed Solana Devnet accounts replaced placeholder accounts
- read-only pre-submit checks exist
- `liveSubmissionImplemented=false`

## Transaction Assembly Design

The new dry-run helper builds:

- `ComputeBudgetProgram.setComputeUnitLimit`
- `ComputeBudgetProgram.setComputeUnitPrice`
- `accept_bridge_v1_mint`

The transaction uses:

- destination `BridgeMint` message
- destination BridgeMint hash
- source BridgeOut hash as separate audit metadata
- threshold signatures already produced by paper mode
- signer set version `2`
- deployed Base -> Solana route account config
- dry-run recent blockhash
- dry-run caller PDA when no real payer is configured

The helper serializes with `requireAllSignatures=false` and `verifySignatures=false`. This allows local unsigned transaction inspection without requiring a payer private key.

## Account Metas

Account meta validation follows the Rust `AcceptBridgeV1Mint` account order:

1. `caller`
2. `bridgeV1Config`
3. `signerSet`
4. `consumedMessage`
5. `routeConfig`
6. `assetConfig`
7. `frozenMessage`
8. `poolConfig`
9. `merkleTree`
10. `pendingBuffer`
11. `assetVault`
12. `commitmentIndex`
13. `systemProgram`

Validation checks:

- account order
- signer/writable flags
- no placeholder accounts where deployed accounts are required
- no invalid duplicate account metas
- destination hash is used for destination instruction
- signer set version matches route destination config

## Compute Budget

The dry-run transaction includes compute budget instructions:

- compute unit limit: `400000`
- compute unit price: `0` micro-lamports by default

These values are dry-run defaults and can be tuned before live-testnet execution.

## Message And Hash Handling

The assembled instruction uses the destination BridgeMint message and destination BridgeMint hash.

The source BridgeOut hash remains present as `sourceMessageHash` for operator audit, but is not used for destination consumed/frozen PDA derivation.

## Signer Set And Signature Handling

The instruction data includes:

- destination `BridgeMessageV1`
- `Vec<[u8; 65]>` threshold signatures
- signer set version `2`

The preview reports signature count only. It does not print private keys or signer key files.

## Serialization Result

The dry-run helper returns:

- `transactionAssemblyImplemented=true`
- `willSubmit=false`
- `serializedLength`
- instruction summary
- account meta summary
- validation result

The serialized transaction bytes are not written to docs or committed.

## Simulation Result

Simulation was not attempted in PR-011Q.

Reason: transaction assembly and serialization do not require live RPC, and this PR intentionally avoids any live submit path. Future simulation can use `simulateTransaction` with `sigVerify=false` after a safe RPC and payer policy is finalized.

## Why Destination Tx Was Not Submitted

Destination submission remains disabled because:

- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- daemon paper mode remains non-submitting
- `liveSubmissionImplemented=false`
- the Solana adapter still throws on `submitAcceptBridgeMint`
- this PR only assembles and serializes locally

## Tests Added

Added coverage for:

- transaction preview assembly
- compute budget instruction inclusion
- destination BridgeMint hash usage
- source BridgeOut hash preservation
- signer set version `2`
- real deployed Solana account config
- account meta order/count/flags
- no transaction submit in preview mode
- nonzero serialized transaction length
- simulation skipped safely without RPC

## Commands Run

- `cd relayer && npm run test` — passed
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed
- `cd relayer && npm run watcher:smoke` — passed
- `cd relayer && npm run watcher:report` — passed

## Remaining Limitations

- No transaction is sent.
- The transaction preview is unsigned by the fee payer.
- Simulation is skipped.
- `liveSubmissionImplemented=false`.
- Live submit still needs final payer policy, fresh blockhash handling, pre-submit account re-checks, and explicit operator approval.
- Mainnet remains unsupported.
- Not production-ready.

## Next Recommended PR

PR-011R — Solana destination simulation and final approval gate:

- simulate the assembled transaction with safe RPC and `sigVerify=false` where supported
- keep live submit disabled
- require exact operator-approved message hash
- re-run consumed/frozen/idempotency checks immediately before any future submit
