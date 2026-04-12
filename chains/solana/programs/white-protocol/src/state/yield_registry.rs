//! Yield Registry - Tracks which mints require yield-gated exits
//!
//! Separate PDA to avoid PoolConfig migration

use anchor_lang::prelude::*;

/// Registry of LST mints requiring yield-gated withdrawals
#[account]
pub struct YieldRegistry {
    /// Parent pool configuration
    pub pool_config: Pubkey,

    /// Authority that can modify yield mints
    pub authority: Pubkey,

    /// LST mints requiring yield exit (JitoSOL, mSOL, etc.)
    pub mints: [Pubkey; 8],

    /// Number of active yield mints
    pub mint_count: u8,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl YieldRegistry {
    /// Account size: 8 (discriminator) + 32 + 32 + 256 + 1 + 1 + 32 = 362 bytes
    pub const LEN: usize = 8 + 32 + 32 + (32 * 8) + 1 + 1 + 32;

    /// Seed prefix for PDA derivation
    pub const SEED_PREFIX: &'static [u8] = b"yield_registry";

    /// Maximum number of yield mints
    pub const MAX_YIELD_MINTS: usize = 8;

    /// Initialize the registry
    pub fn initialize(&mut self, pool_config: Pubkey, authority: Pubkey, bump: u8) {
        self.pool_config = pool_config;
        self.authority = authority;
        self.mints = [Pubkey::default(); 8];
        self.mint_count = 0;
        self.bump = bump;
        self._reserved = [0u8; 32];
    }

    /// Check if a mint is a yield asset
    pub fn is_yield_mint(&self, mint: &Pubkey) -> bool {
        for i in 0..(self.mint_count as usize) {
            if self.mints[i] == *mint {
                return true;
            }
        }
        false
    }

    /// Check if an asset_id corresponds to a yield mint
    pub fn is_yield_asset(&self, asset_id: &[u8; 32]) -> bool {
        use crate::state::asset_vault::compute_asset_id;

        for i in 0..(self.mint_count as usize) {
            let yield_asset_id = compute_asset_id(&self.mints[i]);
            if yield_asset_id == *asset_id {
                return true;
            }
        }
        false
    }

    /// Add a yield mint
    pub fn add_mint(&mut self, mint: Pubkey) -> Result<()> {
        let count = self.mint_count as usize;
        require!(
            count < Self::MAX_YIELD_MINTS,
            crate::error::WhiteProtocolError::YieldMintsExceeded
        );

        // Check if already exists
        require!(
            !self.is_yield_mint(&mint),
            crate::error::WhiteProtocolError::YieldMintAlreadyExists
        );

        self.mints[count] = mint;
        self.mint_count += 1;

        Ok(())
    }

    /// Remove a yield mint
    pub fn remove_mint(&mut self, mint: &Pubkey) -> Result<()> {
        let count = self.mint_count as usize;

        // Find the mint
        let mut found_index = None;
        for i in 0..count {
            if self.mints[i] == *mint {
                found_index = Some(i);
                break;
            }
        }

        let index = found_index.ok_or(crate::error::WhiteProtocolError::YieldMintNotFound)?;

        // Shift elements left
        for i in index..(count - 1) {
            self.mints[i] = self.mints[i + 1];
        }

        // Clear last element
        self.mints[count - 1] = Pubkey::default();
        self.mint_count -= 1;

        Ok(())
    }

    /// Find PDA address
    pub fn find_pda(program_id: &Pubkey, pool_config: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[Self::SEED_PREFIX, pool_config.as_ref()], program_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    #[test]
    fn test_yield_registry() {
        let mut registry = YieldRegistry {
            pool_config: Pubkey::new_unique(),
            authority: Pubkey::new_unique(),
            mints: [Pubkey::default(); 8],
            mint_count: 0,
            bump: 0,
            _reserved: [0u8; 32],
        };

        // Test add mint
        let jitosol = Pubkey::new_unique();
        registry.add_mint(jitosol).unwrap();
        assert_eq!(registry.mint_count, 1);
        assert!(registry.is_yield_mint(&jitosol));

        // Test duplicate
        assert!(registry.add_mint(jitosol).is_err());

        // Test remove
        registry.remove_mint(&jitosol).unwrap();
        assert_eq!(registry.mint_count, 0);
        assert!(!registry.is_yield_mint(&jitosol));
    }
}
