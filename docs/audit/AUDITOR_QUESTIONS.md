# Auditor Questions

This list is intended to focus external review. It is not a substitute for full source review.

## BridgeMessageV1 Domain Separation And Replay Protection

- Are source and destination domains sufficiently separated across EVM and Solana routes?
- Does the message hash include all fields required to prevent cross-chain, cross-route, cross-asset, and cross-version replay?
- Are `sourceMessageHash` and destination `BridgeMint` hash derivations unambiguous?
- Are nonce, deadline, root, leaf index, nullifier, commitment, memo, metadata, and reserved fields encoded consistently across languages?
- Are golden vectors sufficient for Base/EVM routes and Solana routes?

## EVM BridgeInbox / BridgeOutbox

- Are consumed-message checks complete and impossible to bypass?
- Are frozen-message checks enforced in every destination accept path?
- Are route enable/pause, asset support, and amount cap checks correctly ordered before state mutation?
- Is signer-set versioning safe during signer rotation?
- Are emitted events sufficient for off-chain recovery and Merkle path reconstruction?

## Solana `bridge_out_v1_with_proof` / `accept_bridge_v1_mint`

- Does `bridge_out_v1_with_proof` bind the source proof to the bridge message strongly enough?
- Can unsafe `init_bridge_v1_out` events be mistaken for trusted source evidence?
- Are PDA derivations collision-resistant and authority checks complete?
- Are frozen-message and already-consumed states enforced on Solana destination paths?
- Are source nullifier spend and value-lock semantics sufficient for Solana source messages?

## Threshold Signature Verification

- Does signer recovery match EVM address derivation and deployed signer sets?
- Are duplicate, unsorted, unknown, zero, and insufficient signatures rejected everywhere?
- Can a signer-set update race with message approval or destination submit?
- Are threshold values and signer-set versions auditable from deployment artifacts?

## Note-State Custody Assumptions

- Is it acceptable that destination note-state custody is operator responsibility?
- What encryption, backup, restore, and access-control process is required before mainnet?
- Does missing note-state create any risk beyond unrecoverable withdrawal?
- Are redaction and no-log guarantees sufficient for operator commands?

## Circuit Public Input Binding

- Does the current `public_data_hash` approach bind all bridge-specific data needed for mainnet security?
- Should bridge-specific fields be first-class circuit public inputs?
- Are deposit, withdraw, and batch update public inputs consistent with contract/program verification?
- Are zkey provenance and artifact checks adequate for production?

## Watcher / Freeze Model

- Is dry-run watcher evidence sufficient before mainnet, or is live freeze required?
- What finding severities should trigger pause/freeze automatically versus manual review?
- Are alerting, retention, and escalation requirements complete?
- Can watcher freeze actions be abused or bypassed?

## Route Caps / Deadlines / Finality

- Are deadline windows long enough for operation but short enough to limit stale approvals?
- Are finality rules appropriate for Solana Devnet/mainnet and each EVM chain?
- Are route caps enforced on normalized destination amounts?
- Are pause and cap governance controls sufficient?

## Amount Normalization

- Is exact decimal normalization safe across all supported source/destination asset pairs?
- Are rounding, overflow, underflow, and dust cases handled correctly?
- Are watcher findings and policy blockers sufficient for cross-decimal mismatch cases?

## Duplicate Submit / Withdraw Protections

- Are duplicate submit checks complete before and after destination state mutation?
- Are duplicate withdraw checks complete through nullifier-spent state?
- Are no-op statuses (`already_submitted`, `already_withdrawn`, `no_action_already_complete`) safe and operator-clear?
- Are duplicate rejection paths covered by tests and operational runbooks?
