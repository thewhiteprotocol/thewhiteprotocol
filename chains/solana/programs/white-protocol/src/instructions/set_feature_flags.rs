//! Set Feature Flags Instruction
//!
//! Allows pool authority to enable/disable feature flags on the pool.
//! This includes FEATURE_YIELD_ENFORCEMENT for LST yield fee enforcement.

use crate::error::WhiteProtocolError;
use crate::state::PoolConfig;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetFeatureFlags<'info> {
    /// Pool authority - must be signer
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Pool config - validated via has_one (no PDA seeds constraint)
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::InvalidAuthority,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Enable a feature flag
pub fn enable_feature(ctx: Context<SetFeatureFlags>, feature: u8) -> Result<()> {
    // Validate feature bit is a single valid flag
    require!(
        feature.count_ones() == 1 && feature <= PoolConfig::FEATURE_YIELD_ENFORCEMENT,
        WhiteProtocolError::InvalidFeatureFlag
    );

    ctx.accounts.pool_config.enable_feature(feature);

    msg!(
        "Feature {} enabled. New flags: {}",
        feature,
        ctx.accounts.pool_config.feature_flags
    );
    Ok(())
}

/// Disable a feature flag
pub fn disable_feature(ctx: Context<SetFeatureFlags>, feature: u8) -> Result<()> {
    // Validate feature bit is a single valid flag
    require!(
        feature.count_ones() == 1 && feature <= PoolConfig::FEATURE_YIELD_ENFORCEMENT,
        WhiteProtocolError::InvalidFeatureFlag
    );

    // Don't allow disabling MASP (core functionality)
    require!(
        feature != PoolConfig::FEATURE_MASP,
        WhiteProtocolError::CannotDisableCoreFeature
    );

    ctx.accounts.pool_config.disable_feature(feature);

    msg!(
        "Feature {} disabled. New flags: {}",
        feature,
        ctx.accounts.pool_config.feature_flags
    );
    Ok(())
}
