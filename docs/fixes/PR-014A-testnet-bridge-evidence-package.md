# PR-014A - Testnet Bridge Evidence Package

## Summary

PR-014A creates a non-secret evidence package for external review, audit preparation, investor/technical diligence, and internal QA. No transactions were submitted and no bridge flow was rerun.

## What PR-014A Adds

- Evidence index: `docs/evidence/TESTNET_BRIDGE_EVIDENCE_INDEX.md`
- Security assumptions: `docs/audit/TESTNET_SECURITY_ASSUMPTIONS.md`
- External audit checklist: `docs/audit/EXTERNAL_AUDIT_CHECKLIST.md`
- Updated Solana/EVM route matrix.
- Updated implementation plan and operator checklist.

## Completed Route Evidence

Completed testnet route evidence now includes:

- Base Sepolia -> Solana Devnet
- Solana Devnet -> Base Sepolia
- Base Sepolia -> Ethereum Sepolia
- Ethereum Sepolia -> Base Sepolia
- Base Sepolia -> BSC Testnet
- BSC Testnet -> Base Sepolia
- Base Sepolia -> Polygon Amoy
- Polygon Amoy -> Base Sepolia
- Ethereum Sepolia -> BSC Testnet
- Ethereum Sepolia -> Polygon Amoy
- BSC Testnet -> Ethereum Sepolia
- Polygon Amoy -> Ethereum Sepolia

Remaining future routes are the Solana <-> Ethereum, Solana <-> BNB, and Solana <-> Polygon pairs.

## Base -> Solana Lifecycle Evidence

Primary evidence:

- `docs/fixes/PR-012W-base-to-solana-hosted-flow-finalized.md`
- `docs/runbooks/base-to-solana-settlement-withdraw.md`

The hosted operator flow includes durable zkeys, durable note-state, guarded submit, settlement, withdraw, duplicate-withdraw rejection, and final no-op status.

## Solana -> Base Lifecycle Evidence

Primary evidence:

- `docs/fixes/PR-013T-solana-to-base-lifecycle-final-evidence.md`
- `docs/runbooks/solana-to-base-destination-withdraw.md`

Final lifecycle:

- Solana deposit: `3eQHcgwXygwpBuo4i3976oArt6oArtW3g5LxoGZHB7TFjM2NzLKcLbz8GDKwm1thnABVnRYgQ29z8ks6Wh2wXbDLfaWGc`
- Solana settlement: `5SGqmQVM94Bz2sd2DKtyrnrDD4e2D5kC5c1VfuLwMcvSahHtbi2uMiR4u9bARcToTq7vYouVLiYBrGaQm7qGGf9Y`
- Solana bridge out: `54ErMCoDAw5Ed9vy5w1QyUzqCEpQB2bMmT1XuNmfZcQrby7kUinF3of59WK8Yk6nqQMrH1y6N3Wp53xSzHnAhvcr`
- Base acceptBridgeMint: `0x18b0d4a25ea9087630b0eed09d2399a33d16c8788290cad2d379619aedc96556`
- Base withdraw: `0x62e8047f599dacc5d4e8945336d5f134e3e3e438cd2a5f5119b545995ffe0095`
- Recipient: `0xC520f5545dc9Af65FF91470721Ee986e94a717d0`
- Final operator status: `no_action_already_complete`

## EVM <-> EVM Evidence

Primary evidence:

- `docs/fixes/PR-010I-base-to-ethereum-full-bridge-e2e.md`
- `docs/fixes/PR-010K-ethereum-to-base-full-bridge-e2e.md`
- `docs/fixes/PR-010O-bnb-polygon-to-base-bridge-e2e.md`
- `docs/fixes/PR-010P-ethereum-to-bnb-polygon-bridge-e2e.md`
- `docs/fixes/PR-010Q-bnb-polygon-to-ethereum-bridge-e2e.md`

## Duplicate Protection Evidence

- Destination `acceptBridgeMint` duplicate protection: consumed-message checks and guarded submit duplicate rejection.
- Destination withdraw duplicate protection: spent-nullifier checks and guarded withdraw no-op status.
- Operator already-complete classification: `no_action_already_complete`, `alreadyWithdrawn=true`, `withdrawAllowed=false`.

## No-Secret / Redaction Posture

This package references durable operator artifacts by path only. It does not commit note-state, zkeys, witnesses, generated proof files, private env files, wallet files, signer keys, private keys, RPC URLs with keys, or operator tokens.

## Known Limitations

- Testnet evidence only.
- No production signer custody yet.
- No mainnet readiness claim.
- Watcher/freeze live execution is not enabled as production control.
- `public_data_hash` / bridge-specific circuit binding remains a known limitation.
- Solana <-> Ethereum, Solana <-> BNB, and Solana <-> Polygon routes remain future work.

## Next Recommended PR

PR-014B - external audit handoff bundle review, including deployment artifact verification and a mainnet-blocker remediation plan.
