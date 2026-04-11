//! Register Asset Instruction
//!
//! Registers a new SPL token asset with the MASP pool.
//! Creates an AssetVault account to hold shielded tokens.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::WhiteProtocolError;
use crate::events::AssetRegistered;
use crate::state::{AssetVault, PoolConfig};

/// Accounts for registering a new asset with the pool
#[derive(Accounts)]
#[instruction(asset_id: [u8; 32])]
pub struct RegisterAsset<'info> {
    /// Pool authority (must be signer)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Token mint for the asset being registered
    pub mint: Account<'info, Mint>,

    /// Asset vault account (PDA)
    #[account(
        init,
        payer = authority,
        space = AssetVault::DEFAULT_SPACE,
        seeds = [
            AssetVault::SEED_PREFIX,
            pool_config.key().as_ref(),
            asset_id.as_ref(),
        ],
        // IMPORTANT: compute_asset_id is a free function in state::asset_vault, not a method on AssetVault
        constraint = asset_id == crate::state::asset_vault::compute_asset_id(&mint.key()) @ WhiteProtocolError::InvalidAssetId,
        bump,
    )]
    pub asset_vault: Account<'info, AssetVault>,

    /// Token account for the vault (PDA)
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = asset_vault,
        seeds = [
            b"vault_token",
            asset_vault.key().as_ref(),
        ],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for register_asset instruction
pub fn handler(ctx: Context<RegisterAsset>, asset_id: [u8; 32]) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    // Redundant with the account constraint, but keeps safety if constraint is edited later.
    let expected_asset_id = crate::state::asset_vault::compute_asset_id(&ctx.accounts.mint.key());
    require!(
        asset_id == expected_asset_id,
        WhiteProtocolError::InvalidAssetId
    );

    // Verify pool can register more assets
    require!(
        pool_config.can_register_asset(),
        WhiteProtocolError::TooManyAssets
    );

    let timestamp = Clock::get()?.unix_timestamp;
    let vault_bump = ctx.bumps.asset_vault;

    // AssetVault::initialize returns () (not Result), and it requires asset_type.
    ctx.accounts.asset_vault.initialize(
        pool_config.key(),
        asset_id,
        ctx.accounts.mint.key(),
        ctx.accounts.vault_token_account.key(),
        vault_bump,
        ctx.accounts.mint.decimals,
        AssetVault::ASSET_TYPE_SPL,
        timestamp,
    );

    pool_config.register_asset()?;
    pool_config.last_activity_at = timestamp;

    emit!(AssetRegistered {
        pool: pool_config.key(),
        asset_id,
        mint: ctx.accounts.mint.key(),
        vault: ctx.accounts.asset_vault.key(),
        decimals: ctx.accounts.mint.decimals,
        timestamp,
    });

    Ok(())
}
