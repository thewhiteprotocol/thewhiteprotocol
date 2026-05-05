use anchor_lang::prelude::*;

/// Per-route configuration and cap tracking.
/// PDA seeds: `["bridge_route", source_domain (be), destination_domain (be)]`.
#[account]
pub struct BridgeRouteConfig {
    pub source_domain: u32,
    pub destination_domain: u32,
    /// Route is enabled for bridging.
    pub enabled: bool,
    /// Route is paused (emergency stop).
    pub paused: bool,
    /// Maximum amount allowed in a single message.
    pub max_message_amount: u128,
    /// Daily inflow cap for this route.
    pub daily_inflow_cap: u128,
    /// Daily outflow cap for this route.
    pub daily_outflow_cap: u128,
    /// Daily inflow used (current window).
    pub daily_inflow_used: u128,
    /// Daily outflow used (current window).
    pub daily_outflow_used: u128,
    /// Start of current daily window (unix_timestamp / 86400).
    pub daily_window_start: i64,
    /// PDA bump seed.
    pub bump: u8,
}

impl BridgeRouteConfig {
    pub const SEED_PREFIX: &'static [u8] = b"bridge_route";
    /// 8 + 4 + 4 + 1 + 1 + 16 + 16 + 16 + 16 + 16 + 8 + 1 = 107 bytes
    pub const LEN: usize = 8 + 4 + 4 + 1 + 1 + 16 + 16 + 16 + 16 + 16 + 8 + 1;

    /// Reset daily counters if we've crossed a day boundary.
    pub fn maybe_reset_daily_window(&mut self, now: i64) {
        let current_day = now / 86400;
        if current_day != self.daily_window_start {
            self.daily_window_start = current_day;
            self.daily_inflow_used = 0;
            self.daily_outflow_used = 0;
        }
    }

    /// Record inflow amount, checking cap.
    pub fn record_inflow(&mut self, amount: u128, now: i64) -> Result<()> {
        use crate::error::WhiteProtocolError;
        self.maybe_reset_daily_window(now);
        self.daily_inflow_used = self
            .daily_inflow_used
            .checked_add(amount)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;
        if self.daily_inflow_used > self.daily_inflow_cap {
            return Err(WhiteProtocolError::BridgeDailyCapExceeded.into());
        }
        Ok(())
    }

    /// Record outflow amount, checking cap.
    pub fn record_outflow(&mut self, amount: u128, now: i64) -> Result<()> {
        use crate::error::WhiteProtocolError;
        self.maybe_reset_daily_window(now);
        self.daily_outflow_used = self
            .daily_outflow_used
            .checked_add(amount)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;
        if self.daily_outflow_used > self.daily_outflow_cap {
            return Err(WhiteProtocolError::BridgeDailyCapExceeded.into());
        }
        Ok(())
    }
}
