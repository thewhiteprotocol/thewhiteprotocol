use anchor_lang::prelude::*;

/// Maximum number of signers in a signer set.
/// Chosen to keep compute units manageable (7 sigs ≈ 210k CU).
pub const MAX_SIGNERS: usize = 11;

/// Signer set for a specific version.
/// PDA seeds: `["bridge_signer_set", version]`.
#[account]
pub struct BridgeSignerSet {
    /// Version number (monotonically increasing).
    pub version: u32,
    /// Minimum signatures required.
    pub threshold: u8,
    /// Actual number of signers in the set.
    pub signer_count: u8,
    /// Fixed-size array of 20-byte Ethereum addresses.
    pub signers: [[u8; 20]; MAX_SIGNERS],
    /// PDA bump seed.
    pub bump: u8,
}

impl BridgeSignerSet {
    pub const SEED_PREFIX: &'static [u8] = b"bridge_signer_set";
    /// 8 (discriminator) + 4 + 1 + 1 + 11*20 + 1 = 235 bytes
    pub const LEN: usize = 8 + 4 + 1 + 1 + MAX_SIGNERS * 20 + 1;

    /// Check if an Ethereum address is in the signer set.
    pub fn contains(&self, addr: &[u8; 20]) -> bool {
        for i in 0..self.signer_count as usize {
            if self.signers[i] == *addr {
                return true;
            }
        }
        false
    }

    /// Validate the signer set invariants.
    pub fn validate(&self) -> Result<()> {
        use crate::error::WhiteProtocolError;

        if self.threshold == 0 {
            return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
        }

        if self.signer_count == 0 {
            return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
        }

        if self.threshold > self.signer_count {
            return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
        }

        if self.signer_count as usize > MAX_SIGNERS {
            return Err(WhiteProtocolError::SignerSetTooLarge.into());
        }

        // No zero signers
        for i in 0..self.signer_count as usize {
            if self.signers[i] == [0u8; 20] {
                return Err(WhiteProtocolError::ZeroSigner.into());
            }
        }

        // No duplicates, sorted ascending
        for i in 1..self.signer_count as usize {
            if self.signers[i] == self.signers[i - 1] {
                return Err(WhiteProtocolError::DuplicateSignerInSet.into());
            }
            if self.signers[i] < self.signers[i - 1] {
                return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
            }
        }

        Ok(())
    }
}
