//! Reset Merkle Tree Instruction
//!
//! Admin function to reset merkle tree state to empty.
use crate::error::WhiteProtocolError;
use crate::state::{MerkleTree, PoolConfig};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ResetMerkleTree<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Merkle tree account
    #[account(
        mut,
        constraint = pool_config.merkle_tree == merkle_tree.key() @ WhiteProtocolError::InvalidMerkleTreePool,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,
}

pub fn handler(ctx: Context<ResetMerkleTree>) -> Result<()> {
    let merkle = &mut ctx.accounts.merkle_tree;

    // Reset to empty tree state
    merkle.next_leaf_index = 0;
    merkle.current_root = merkle.zeros[merkle.depth as usize];
    merkle.filled_subtrees = merkle.zeros[..merkle.depth as usize].to_vec();
    merkle.root_history_index = 0;

    // Clear root history
    for i in 0..merkle.root_history.len() {
        merkle.root_history[i] = [0u8; 32];
    }

    msg!("Merkle tree reset to empty state");
    Ok(())
}
