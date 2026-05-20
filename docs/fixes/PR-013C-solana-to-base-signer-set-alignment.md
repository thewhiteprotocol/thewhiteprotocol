# PR-013C - Solana to Base Signer Set Alignment

## Summary

PR-013C resolves the PR-013B `InvalidSigner` blocker for the fresh Solana Devnet -> Base Sepolia paper message. The paper state was re-signed with keys matching the deployed Base Sepolia BridgeInbox signer set, then the guarded approval simulation was rerun without submitting a destination transaction.

Result: approval-ready simulation passed. Destination submission remains disabled.

## PR-013B InvalidSigner Blocker

PR-013B reviewed destination BridgeMint hash:

`0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`

Base read-only checks passed, but `BridgeInbox.acceptBridgeMint` simulation reverted with `InvalidSigner`. The recovered paper signer addresses were local-dev signers, not members of the deployed Base signer set.

## Deployed Base Signer Set Audit

Base Sepolia BridgeInbox:

`0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`

Deployed signer set:

- Version: `1`
- Threshold: `2`
- Signers:
  - `0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820`
  - `0xbd7d34e42352BCe888394263A84CF21c85608beC`
  - `0xEa4A68F39630C5145f1840D754B470a9fa5F2c19`

The deployed contract reports current signer set version `1`. The contract verifies raw `BridgeMessageV1` hashes through `BridgeAttestationLib.verifyThresholdSignatures`; no EIP-191 prefixing is used.

## Paper Signature Audit

Before re-sign:

- Signer mode: `local-dev`
- Recovered signers:
  - `0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF`
  - `0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69`
- Match deployed signer set: no

After re-sign:

- Signer mode: `env-file`
- Recovered signers:
  - `0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820`
  - `0xbd7d34e42352BCe888394263A84CF21c85608beC`
- Match deployed signer set: yes
- Signature count: `2`
- Signer set version: `1`

No private keys or signer file contents were printed.

## Root Cause

The PR-013A paper replay produced a valid destination BridgeMint message, but it used local-dev signatures. Base Sepolia requires threshold signatures from its deployed BridgeInbox signer set, so simulation correctly failed closed with `InvalidSigner`.

## Fix Path

Added a guarded re-sign approval command:

```bash
cd relayer
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SIGNER_MODE=env-file \
BRIDGE_SIGNER_KEY_FILE=/path/to/operator/signers.env \
BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH=/tmp/pr013a-solana-to-base-paper-state \
npm run bridge:solana-to-base:resign-approval
```

The command:

- Loads the exact paper state.
- Requires the destination BridgeMint hash, not the source hash.
- Loads deployed Base signer metadata.
- Signs the destination BridgeMint hash with configured signer keys.
- Keeps the source hash as separate audit evidence.
- Updates only paper-state signatures and metadata.
- Runs Base read-only checks and simulation.
- Sends no transaction.

## Simulation Result

- Simulation attempted: yes
- Simulation result: success
- Gas estimate: `986309`
- `InvalidSigner` resolved: yes
- Destination tx submitted: false

Base read-only checks remained safe:

- Route enabled: `true`
- Asset supported: `true`
- Message consumed: `false`
- Message frozen: `false`
- Amount cap: pass
- Global pause: `false`
- Live submit enabled: `false`

## Proof No Destination Transaction Was Submitted

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- Simulation used read-only contract simulation and gas estimation only.
- `destinationTxSubmitted=false`
- `submitTxHash=null`

## Tests Run

- `cd relayer && npm run test -- solana-to-base-approval`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- This is approval readiness only; no Base destination transaction was submitted.
- The approval-ready paper state is under `/tmp`; a live submit window should use an explicit operator-reviewed persistent approval artifact or rerun the guarded checks immediately before submit.
- Base submit must still require a separate explicit live-testnet approval window.

## Next Recommended PR

PR-013D should create the explicit live-submit approval window for this exact destination BridgeMint hash, rerun the guarded approval immediately before submit, execute one Base destination submit only if all gates still pass, and restore live-submit disabled afterwards.
