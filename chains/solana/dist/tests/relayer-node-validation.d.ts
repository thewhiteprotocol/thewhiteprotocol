/**
 * RelayerNode PDA Validation Tests
 *
 * Tests that ensure RelayerNode accounts passed to withdraw instruction are
 * correctly derived from the expected RelayerRegistry.
 *
 * Issue: #10 - RelayerNode PDA not validated against registry
 *
 * Test Cases:
 * 1. Success: Withdraw with correctly derived RelayerNode from same registry
 * 2. Failure: Withdraw with RelayerNode from a different registry (wrong pool)
 */
export {};
/**
 * Summary of validation implemented in withdraw_masp.rs:
 *
 * When relayer_node is Some (optional account provided):
 *
 * 1. Registry Mismatch Check:
 *    require!(
 *        relayer_node.registry == ctx.accounts.relayer_registry.key(),
 *        PrivacyErrorV2::RelayerNodeRegistryMismatch
 *    );
 *
 * 2. PDA Derivation Check:
 *    let (expected_pda, _bump) = RelayerNode::find_pda(
 *        ctx.program_id,
 *        &ctx.accounts.relayer_registry.key(),
 *        &relayer_node.operator,
 *    );
 *    require!(
 *        relayer_node.key() == expected_pda,
 *        PrivacyErrorV2::InvalidRelayerNodePda
 *    );
 *
 * PDA Seeds:
 *    [b"relayer", registry.key().as_ref(), operator.key().as_ref()]
 *
 * This ensures:
 * - The RelayerNode was created for this specific registry (not another pool's registry)
 * - The RelayerNode PDA matches the canonical derivation
 * - An attacker cannot use a RelayerNode from a different pool
 */
//# sourceMappingURL=relayer-node-validation.d.ts.map