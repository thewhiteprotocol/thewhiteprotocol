use anchor_lang::prelude::*;

/// Per-asset configuration and cap tracking.
/// PDA seeds: `["bridge_asset", canonical_asset_id]`.
#[account]
pub struct BridgeAssetConfig {
    /// Canonical asset identifier (bytes32).
    pub canonical_asset_id: [u8; 32],
    /// Asset is supported for bridging.
    pub supported: bool,
    /// Maximum amount allowed in a single message.
    pub max_message_amount: u128,
    /// Daily cap for this asset (inflow + outflow combined tracking).
    pub daily_cap: u128,
    /// Daily usage (current window).
    pub daily_used: u128,
    /// Start of current daily window (unix_timestamp / 86400).
    pub daily_window_start: i64,
    /// PDA bump seed.
    pub bump: u8,
}

impl BridgeAssetConfig {
    pub const SEED_PREFIX: &'static [u8] = b"bridge_asset";
    /// 8 + 32 + 1 + 16 + 16 + 16 + 8 + 1 = 98 bytes
    pub const LEN: usize = 8 + 32 + 1 + 16 + 16 + 16 + 8 + 1;

    /// Reset daily counter if we've crossed a day boundary.
    pub fn maybe_reset_daily_window(&mut self, now: i64) {
        let current_day = now / 86400;
        if current_day != self.daily_window_start {
            self.daily_window_start = current_day;
            self.daily_used = 0;
        }
    }

    /// Record usage amount, checking cap.
    pub fn record_usage(&mut self, amount: u128, now: i64) -> Result<()> {
        use crate::error::WhiteProtocolError;
        self.maybe_reset_daily_window(now);
        self.daily_used = self
            .daily_used
            .checked_add(amount)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;
        if self.daily_used > self.daily_cap {
            return Err(WhiteProtocolError::BridgeDailyCapExceeded.into());
        }
        Ok(())
    }
}
