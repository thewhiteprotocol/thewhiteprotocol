use crate::error::WhiteProtocolError;
use crate::events::BridgeRouteConfigured;
use crate::state::bridge_route_config::BridgeRouteConfig;
use crate::state::bridge_v1_config::BridgeV1Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(
    source_domain: u32,
    destination_domain: u32,
    enabled: bool,
    paused: bool,
    max_message_amount: u128,
    daily_inflow_cap: u128,
    daily_outflow_cap: u128,
)]
pub struct SetBridgeV1Route<'info> {
    #[account(mut, constraint = bridge_v1_config.authority == authority.key() @ WhiteProtocolError::Unauthorized)]
    pub authority: Signer<'info>,

    pub bridge_v1_config: Account<'info, BridgeV1Config>,

    #[account(
        init_if_needed,
        payer = authority,
        space = BridgeRouteConfig::LEN,
        seeds = [
            BridgeRouteConfig::SEED_PREFIX,
            &source_domain.to_le_bytes(),
            &destination_domain.to_le_bytes(),
        ],
        bump,
    )]
    pub route_config: Account<'info, BridgeRouteConfig>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<SetBridgeV1Route>,
    source_domain: u32,
    destination_domain: u32,
    enabled: bool,
    paused: bool,
    max_message_amount: u128,
    daily_inflow_cap: u128,
    daily_outflow_cap: u128,
) -> Result<()> {
    let route = &mut ctx.accounts.route_config;
    let clock = Clock::get()?;

    route.source_domain = source_domain;
    route.destination_domain = destination_domain;
    route.enabled = enabled;
    route.paused = paused;
    route.max_message_amount = max_message_amount;
    route.daily_inflow_cap = daily_inflow_cap;
    route.daily_outflow_cap = daily_outflow_cap;

    // Only reset counters on first init (bump == 0 means not yet initialized)
    if route.bump == 0 {
        route.daily_inflow_used = 0;
        route.daily_outflow_used = 0;
        route.daily_window_start = clock.unix_timestamp / 86400;
        route.bump = ctx.bumps.route_config;
    }

    emit!(BridgeRouteConfigured {
        source_domain,
        destination_domain,
        enabled,
        paused,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
