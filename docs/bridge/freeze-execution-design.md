# Freeze Execution Design

**Date:** 2026-05-15
**Status:** Design only; PR-011E does not enable live freeze transactions

## 1. Summary

Bridge watcher freeze execution is the future path for turning a critical watcher finding into an on-chain message freeze. PR-011E only defines the design and dry-run checks. The current relayer continues to build previews only by default.

## 2. Preconditions For Live Freeze

Live freeze execution must not be enabled until all of these are true:

- hosted watcher dry-run has completed a stable observation window
- operator API auth is hardened and audited
- signer/admin custody is hardened
- `BRIDGE_WATCHER_AUTO_FREEZE=true` is explicitly set
- `BRIDGE_WATCHER_DRY_RUN=false` is explicitly set
- chain-specific freeze authority key is available through a custody adapter
- route-specific freeze allowlist exists
- severity threshold is `critical`
- observation reports show no dry-run live freeze submissions
- runbooks identify approval, rollback, and incident contacts

## 3. EVM Freeze Path

Target:

- destination `BridgeInbox` for the affected chain

Action:

- call `freezeMessage(bytes32 messageHash)`

Requirements:

- compute `messageHash` from the canonical `BridgeMessageV1`
- verify destination chain and configured BridgeInbox address
- check whether the message is already frozen or consumed
- check route allowlist and severity threshold
- generate calldata preview before submission
- submit with a chain-specific freeze authority
- track nonce, gas, tx hash, confirmation status, and final error
- treat already-frozen as idempotent success after verifying on-chain state

## 4. Solana Freeze Path

Target:

- `white_protocol::freeze_bridge_v1_message`

Required accounts:

- `BridgeV1Config` PDA
- `FrozenBridgeMessage` PDA derived from `messageHash`
- freeze authority signer
- system program when initialization is needed

Requirements:

- derive PDAs using the deployed white-protocol program ID
- verify local destination domain matches the finding route
- include compute budget instructions if needed
- preview instruction accounts and args before submission
- submit with chain-specific freeze authority from custody adapter
- track signature, confirmation status, slot, and final error
- treat already-frozen as idempotent success after verifying account state

## 5. Operator Approval Flow

1. Preview: watcher generates freeze calldata/instruction preview.
2. Review: operator validates finding evidence, route, message hash, and target chain.
3. Approve: operator records approval with actor, timestamp, finding ID, and preview hash.
4. Submit: freeze executor submits only if all live preconditions pass.
5. Confirm: executor waits for confirmation and stores tx/signature.
6. Resolve: operator resolves the finding after on-chain frozen state is verified.

## 6. Failure Modes

- transaction failed or reverted
- message already frozen
- message already consumed
- wrong chain or wrong target contract/program
- stale or resolved finding
- RPC outage or inconsistent RPC responses
- nonce collision or gas underpricing
- custody adapter unavailable
- freeze authority unavailable
- route not on live-freeze allowlist
- dry-run/live env mismatch

## 7. Audit Log Requirements

Every live freeze attempt must store:

- finding ID
- message hash
- source and destination chain
- severity and code
- preview JSON
- approval actor and timestamp
- submitter/custody adapter identifier
- tx hash or Solana signature
- final status
- final error, if any
- on-chain frozen-state verification result

Audit logs must never include private keys, raw signer secrets, wallet files, RPC secrets, operator tokens, or webhook URLs.

## 8. Why PR-011E Does Not Enable Live Freeze

PR-011E is an observation and design PR. It adds report generation, escalation policy tests, dry-run safeguards, and runbooks. It intentionally keeps:

- `BRIDGE_WATCHER_DRY_RUN=true` as the hosted default
- `BRIDGE_WATCHER_AUTO_FREEZE=false` as the hosted default
- no injected live freeze executor
- no contract, Solana program, circuit, or deployment changes

Live freeze execution belongs in a later PR after signer custody and operator approval paths are implemented and tested.

