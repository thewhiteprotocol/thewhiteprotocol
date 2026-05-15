# PR-011Y - Solana Signer Set Version Mismatch

## Summary

PR-011Y reconciles the signer set version mismatch exposed after PR-011X fixed the `frozen_message` lifecycle. The hosted Solana simulation no longer failed at account initialization and instead reached the program signer-set consistency check, where it failed with `SignerSetVersionMismatch`.

No destination transaction was submitted.

## PR-011X Result

PR-011X fixed normal `accept_bridge_v1_mint` behavior when the frozen-message PDA is absent. Hosted simulation then progressed deeper into the instruction and failed with:

- Error: `{"InstructionError":[2,{"Custom":6102}]}`
- Program log: `SignerSetVersionMismatch`
- Compute units: `224120`
- Destination tx submitted: `false`
- State mutation observed: `false`

## Root Cause

Read-only Solana Devnet account inspection showed:

- `BridgeV1Config`: `5ZiC1A8NTS1pc1Rp1mQEnPERzJA1viJZYqW7MX9QhH9s`
- `BridgeV1Config.signer_set_version`: not `2` before the fix
- Signer set v2 PDA existed: `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`
- Signer set v2 stored version: `2`
- Relayer preview/instruction version: `2`

The Solana program requires the instruction `signer_set_version` to equal `BridgeV1Config.signer_set_version`. The deployed config was not aligned with the relayer preview version.

## Program Check

`accept_bridge_v1_mint` derives the signer-set PDA from the instruction argument and then checks:

```rust
if signer_set_version != config.signer_set_version {
    return Err(WhiteProtocolError::SignerSetVersionMismatch.into());
}
```

The check is correct for active signer-set rotation safety.

## Fix Path Chosen

The existing admin instruction, `set_bridge_v1_signer_set`, creates a new signer-set PDA and sets `BridgeV1Config.signer_set_version` to that version. It cannot activate an already-created signer-set PDA.

To avoid weakening program safety, PR-011Y used the existing admin path to create a fresh current signer set version with the same public signers:

- New signer set version: `3`
- New signer set PDA: `BwtnXeqyZZFoLbjKxuYpzY61zNgmtEQoEqi4DnrdfQT8`
- Threshold: `2`
- Signer count: `3`
- Admin tx: `4M6tGEiz217bqDE2vj1z8JLb2aRMd9jqmK3SLC6bCE5NgcBcqxyRTWhfBpPnfAwKFTRuLQP59Yz82YyFPKVM5ofS`

After the admin tx, read-only verification showed:

- `BridgeV1Config.signer_set_version`: `3`
- Signer set v3 exists and stores version `3`

## Code Changes

- Updated non-secret Base Sepolia -> Solana Devnet relayer route metadata to signer set version `3`.
- Updated signer-set PDA to `BwtnXeqyZZFoLbjKxuYpzY61zNgmtEQoEqi4DnrdfQT8`.
- Added read-only pre-submit readiness decoding for:
  - `BridgeV1Config.signer_set_version`
  - `BridgeSignerSet.version`
- Readiness now blocks with signer-set mismatch before simulation if on-chain config and signer-set account versions differ.
- Updated tests to use route signer set metadata instead of hardcoded v2.

## Hosted Rerun

Hosted replay/simulation was not rerun from this local workspace. Render should rerun with the updated relayer code after deployment, or with an explicit route override before deployment:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/relayer"

BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon \
BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet:3 \
BRIDGE_DAEMON_REPLAY_ROUTE=base-sepolia:solana-devnet \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=41544820 \
BRIDGE_DAEMON_SCAN_TO_BLOCK=41544860 \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=0xf458b7b9008624410123e2484b299f841fff071c2f9525a0b082af4d8b5b74a7 \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf \
npm run bridge:daemon:paper:replay

BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon \
BRIDGE_APPROVED_MESSAGE_HASHES="base-sepolia->solana-devnet|0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf" \
npm run bridge:daemon:solana:simulate
```

Expected: simulation no longer fails with `SignerSetVersionMismatch`. It may succeed or reveal the next exact Solana execution blocker.

## Proof No Transaction Was Submitted

- Only the signer-set admin config transaction was sent on Solana Devnet.
- No destination `accept_bridge_v1_mint` transaction was sent.
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT` remains false.
- Live destination submission remains disabled.

## Tests Run

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

Results:

- Relayer tests: 24 suites / 344 tests passed.
- Typecheck: passed.
- Build: passed.
- Watcher smoke: passed.
- Watcher report: passed, `liveFreezeTxCount=0`.

## Remaining Limitations

- Hosted simulation still needs rerun on Render after relayer deployment or with the route version override.
- The admin path cannot currently activate an existing signer-set PDA; it creates a new current version.
- Live destination submission remains disabled and is not production-ready.

## Next Recommended PR

PR-011Z - Rerun hosted Solana simulation with signer set version 3 and address the next simulation result.
