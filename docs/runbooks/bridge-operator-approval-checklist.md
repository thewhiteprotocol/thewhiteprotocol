# Bridge Operator Approval Checklist

**Status:** Testnet-only checklist. Not production-ready.

Use this checklist before approving any bridge daemon message for a future live-testnet destination submission. Approval must be message-specific. Do not use one approval for a range of messages.

## Message Under Review

- Approver:
- Timestamp:
- Route:
- Source transaction:
- Source block:
- Source BridgeOut hash:
- Destination BridgeMint hash:
- Approved action:
- Approval expires at:

## Required Checks

1. Source event verification
   - The source transaction is on the expected source testnet.
   - The event came from the production source-bound path.
   - The source message hash matches the emitted BridgeOut hash.

2. Source nullifier spent check
   - The source nullifier hash is recorded as spent on the source chain.
   - Duplicate source spend attempts are rejected or already blocked.

3. Policy accepted
   - Bridge policy accepted the message.
   - The route is enabled.
   - The asset is supported.
   - The amount is within route and asset caps.
   - The deadline is still valid at observation time.

4. Finality satisfied
   - The source event has reached the configured finality threshold.
   - The finality evidence records source block, current block, confirmations, and threshold.

5. Watcher no critical findings
   - There is no open critical watcher finding for the message.
   - There is no global open critical finding that blocks bridge signing or submission.
   - Watcher dry-run/freeze report shows no unexpected live freeze transaction.

6. Amount normalization check
   - Source amount, source decimals, destination decimals, destination amount, and normalization mode are recorded.
   - Cross-decimal conversion is exact.
   - No manual message edit was used.

7. Signer set check
   - The signer set version in the daemon state matches the deployed destination signer set version intended for submission.
   - The threshold is recorded.
   - The recovered signer addresses are members of the destination signer set.

8. Signatures check
   - The expected number of signatures is present.
   - Signatures are sorted by recovered signer address.
   - No private keys, signer files, or raw env values are present in logs, docs, or approval artifacts.

9. Solana PDA/account check
   - Program ID matches the deployed Solana Devnet program.
   - BridgeV1Config PDA exists.
   - BridgeSignerSet PDA exists and matches the signer set version.
   - ConsumedBridgeMessage PDA for the destination BridgeMint hash is not already initialized.
   - FrozenBridgeMessage PDA for the destination BridgeMint hash is not already initialized.
   - BridgeRouteConfig PDA exists.
   - BridgeAssetConfig PDA exists.
   - PendingDepositsBuffer PDA exists.
   - PoolConfig, MerkleTree, AssetVault, and CommitmentIndex inputs are real live-submit accounts, not placeholders.

10. Route, asset, and cap check
    - Route is enabled and not paused.
    - Asset config is enabled and not paused.
    - Caps are sufficient for the destination amount.
    - Destination vault/account state is sufficient for the follow-on settlement/withdraw workflow.

11. Destination not already consumed
    - The destination consumed-message PDA does not exist immediately before submission.
    - The destination frozen-message PDA does not indicate a freeze.

12. Dry-run preview reviewed
    - Submit preview method and target are correct.
    - Preview message hash is the destination BridgeMint hash intended for live submit.
    - Source BridgeOut hash is preserved separately as source evidence.
    - Preview signer set version matches the destination signer set.
    - Preview contains real destination accounts, not `11111111111111111111111111111111` placeholders.
    - Preview readiness does not report `blocked_hash_mismatch`, `blocked_signer_set_mismatch`, or `blocked_placeholder_accounts`.
    - Transaction assembly dry-run is present.
    - Account metas match the expected `accept_bridge_v1_mint` order and signer/writable flags.
    - Compute budget instructions are present.
    - Serialized transaction length is nonzero, or an exact serialization blocker is documented.
    - Destination BridgeMint hash is explicitly approved through the operator approval gate.
    - Source BridgeOut hash alone is not accepted as approval.
    - Pre-submit idempotency checks are run immediately before simulation.
    - Simulation uses `sigVerify=false` and does not call send APIs.
    - Preview has `dryRun=true`.
    - Preview has `liveSubmissionImplemented=true` only after the live submit adapter exists.

13. Live submit flag still false before approval
    - `BRIDGE_DAEMON_MODE=paper` during review.
    - `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` during review.
    - `submitTxHash=null` before approval.

## Stop Conditions

Do not approve live submission if any of these are true:

- Destination submission adapter is preview-only.
- Preview message hash differs from the destination BridgeMint hash.
- Preview signer set version differs from the deployed destination signer set intended for submission.
- Preview contains placeholder system accounts where live accounts are required.
- Read-only pre-submit checks cannot confirm required account existence/absence.
- Account meta validation fails.
- Transaction assembly dry-run is missing or cannot serialize.
- Destination BridgeMint hash is not explicitly approved.
- Approval uses only the source BridgeOut hash.
- Consumed message, frozen message, or commitment-index idempotency checks fail.
- Simulation fails or returns unsafe/unknown status.
- Source event, policy, finality, watcher, signer, or route evidence is missing.
- Any private key, RPC secret, operator token, note secret, witness, or wallet file appears in the approval artifact.
- Watcher has an open critical finding.
- The message is already consumed or frozen on destination.
- Live submit flags were enabled before approval was recorded.

## Future Live-Testnet Approval Fields

Record these outside git before enabling any future live-testnet destination submit:

- Approver:
- Approval timestamp:
- Approval channel:
- Route:
- Source transaction:
- Source BridgeOut hash:
- Destination BridgeMint hash:
- Exact daemon message hash selected:
- Approved destination action:
- Approval expiration:
- Notes:
