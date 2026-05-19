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
   - The decoded destination `BridgeV1Config.signer_set_version` matches the decoded `BridgeSignerSet.version`.
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
    - Hosted simulation command is run with `npm run bridge:daemon:solana:simulate` after `BRIDGE_APPROVED_MESSAGE_HASHES` is configured.
    - Simulation output records sanitized logs and compute units when available.
    - Hosted `/bridge/daemon/messages` contains the approved destination message before simulation is attempted.
    - Hosted state path is persistent and shared by paper scan, daemon API, and simulation command.
    - Preview has `dryRun=true`.
    - Preview has `liveSubmissionImplemented=true` only after the live submit adapter exists.

13. Live submit flag still false before approval
    - `BRIDGE_DAEMON_MODE=paper` during review.
    - `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` during review.
    - `submitTxHash=null` before approval.

14. Guarded live-testnet submit window
    - `BRIDGE_DAEMON_MODE=live-testnet` is set only for the approved submit window.
    - `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true` is set only for the approved submit window.
    - `BRIDGE_DAEMON_ROUTES` includes only the intended testnet route, for example `base-sepolia:solana-devnet:3`.
    - `BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH` is the approved source BridgeOut hash.
    - `BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH` is the approved destination BridgeMint hash.
    - `BRIDGE_APPROVED_MESSAGE_HASHES` includes the route-scoped destination hash.
    - `npm run bridge:daemon:solana:submit-approved` is the only submit command used.
    - `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` is restored immediately after the submit attempt.
    - A duplicate submit command is run or reviewed to confirm it does not send a second transaction.

15. Destination note-state backup
    - The destination note-state file exists before any live destination submit.
    - `BRIDGE_NOTE_STATE_BACKUP_DIR` points to a durable operator-controlled path such as `/data/white-bridge-note-state`.
    - `BRIDGE_REQUIRE_DURABLE_NOTE_STATE=true`.
    - `BRIDGE_ALLOW_TMP_NOTE_STATE=false` for hosted live submit.
    - The backup path is outside git and not under `/tmp`.
    - `npm run bridge:validate-note-state` passes for the exact source BridgeOut hash and destination BridgeMint hash.
    - `npm run bridge:note-state:readback-check` passes from a fresh shell before the submit window.
    - The operator records the backup location outside git.
    - No note secret, nullifier, witness, or private field is printed in logs.

16. Hosted settlement/withdraw proving artifacts
    - Required zkey files are present on durable operator-controlled storage, not `/tmp`.
    - `merkle_batch_update.zkey` SHA256 is `107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9`.
    - `withdraw.zkey` SHA256 is `cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0`.
    - The zkeys are symlinked or copied into the circuit build paths expected by hosted settlement/withdraw scripts.
    - Any temporary public transfer URLs are deleted after the persistent-disk copy is verified.

17. Hosted settlement/withdraw preflight
    - `cd chains/solana && npm run bridge:preflight:settle-withdraw` has been run with the exact source hash, destination hash, destination commitment, and destination amount.
    - The preflight report was written to `/data/bridge-results`.
    - `readiness` is `ready`, or `blocked_fifo` is explicitly acknowledged before enabling FIFO prefix settlement in the mutating script.
    - The report shows `transactionsSubmitted=false` and `secretsPrinted=false`.

18. Hosted settlement/withdraw job wrapper
    - `npm run bridge:job:settle-withdraw` dry-run succeeds before execute mode is considered.
    - `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` is set only for the approved mutating settlement/withdraw window.
    - The wrapper uses a fresh preflight report for the exact destination BridgeMint hash.
    - `BRIDGE_EXPECTED_PREFLIGHT_SHA256` is set when the operator has reviewed and pinned a specific preflight report.
    - `/data/bridge-results/operator-job-index.json` records a dry-run job entry before execute mode is considered.
    - `npm run bridge:job:index` or `npm run bridge:job:show` shows only non-secret job summaries.
    - The wrapper report shows `BRIDGE_DAEMON_MODE=paper` and `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.

19. Hosted settlement/withdraw resume/recovery
    - `BRIDGE_SETTLE_WITHDRAW_RESUME=true` is used only for an existing partial/interrupted job.
    - `cd chains/solana && npm run bridge:recovery:snapshot` has been run before resume execution.
    - The snapshot report is written to `/data/bridge-results/recovery-snapshot-<destinationHash>.json`.
    - The snapshot report shows `transactionsSubmitted=false`, `proofsGenerated=false`, and `secretsPrinted=false`.
    - The snapshot report is fresh; default max age is 900 seconds unless `BRIDGE_RECOVERY_SNAPSHOT_MAX_AGE_SECONDS` is explicitly set.
    - The snapshot derives the expected spent-nullifier PDA from validated destination note-state or blocks with a safe readiness code.
    - The snapshot does not print `destSecret`, `destNullifier`, witness data, or raw nullifier hash.
    - `BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256` is set when the operator has reviewed and pinned a specific snapshot report.
    - The wrapper job index records the snapshot path, SHA256, readiness, and recommended action before execute/resume mode.
    - `no_action_already_complete` is treated as a safe no-op, not permission to submit another transaction.
    - Resume mode is run first without `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true`.
    - The recovery report is written to `/data/bridge-results/recovery-<destinationHash>.json`.
    - The recovery report phase matches the job index phase and the latest read-only state.
    - Ambiguous recovery state is treated as a stop condition, not as permission to retry.

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
- Hosted simulation env/state is missing.
- Hosted daemon message list is empty or missing the approved message hash.
- Hosted replay cannot write to the same persistent daemon state path.
- Hosted bounded replay was not run with `BRIDGE_DAEMON_MODE=paper` and `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.
- Hosted bounded replay was run without explicit expected source and destination message hashes for the approved message.
- Fresh low-value source-event generation was not explicitly approved by the operator.
- Source wallet funding is insufficient for the fresh event and gas; request funds before retrying.
- Source event, policy, finality, watcher, signer, or route evidence is missing.
- Any private key, RPC secret, operator token, note secret, witness, or wallet file appears in the approval artifact.
- Watcher has an open critical finding.
- The message is already consumed or frozen on destination.
- Live submit flags were enabled before approval was recorded.
- The submit command target hash differs from the latest successful hosted simulation destination hash.
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true` is left enabled after the submit attempt.
- The message already has `submitTxHash` in daemon state.
- Destination note-state backup is missing or fails validation for the exact destination BridgeMint hash.
- The destination note-state file is only present in an ephemeral shell path with no operator backup.
- `BRIDGE_NOTE_STATE_BACKUP_DIR` is unset, inside git, under `/tmp`, unreadable, or unwritable.
- `npm run bridge:note-state:readback-check` has not passed after a fresh shell/container change.
- Hosted settlement/withdraw is attempted before the required zkey files are present and checksum-verified on durable storage.
- Hosted settlement/withdraw is attempted before a non-secret preflight report is exported for the exact destination BridgeMint hash.
- Hosted settlement/withdraw is attempted directly without a successful `bridge:job:settle-withdraw` dry-run for the exact destination BridgeMint hash.
- `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` is set before the operator has reviewed the fresh preflight report.
- The preflight report SHA256 differs from the reviewed hash or from `BRIDGE_EXPECTED_PREFLIGHT_SHA256`.
- The preflight report changes after the job binds to it.
- A prior successful settlement/withdraw job already exists in the operator job index for the same destination BridgeMint hash.
- A partial settlement/withdraw job exists and `BRIDGE_SETTLE_WITHDRAW_RESUME=true` was not set.
- Resume mode reports `recovery_required`, unknown tx status, inconsistent pending/FIFO state, or conflicting spent-nullifier state.
- `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` is set before a fresh recovery snapshot exists for the exact destination BridgeMint hash.
- The recovery snapshot SHA256 differs from the reviewed hash or from `BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256`.
- The recovery snapshot changes after the job binds to it.
- The recovery snapshot recommended action does not match the requested execute/resume phase.
- The recovery snapshot reports `no_action_already_complete`; no further settlement/withdraw transaction should be submitted.
- The recovery snapshot reports `blocked_note_state_invalid` or `blocked_spent_nullifier_unknown`.
- The live recovery snapshot reports `tx_failed`, `tx_unknown`, `blocked_ambiguous_state`, or a destination hash mismatch.
- The live recovery snapshot cannot validate destination note-state for the exact destination hash.

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
- Submit command:
- Submit tx hash:
- Submit confirmation status:
- Destination note-state backup reference:
- Note-state validation command:
- Note-state readback command:
- Notes:
