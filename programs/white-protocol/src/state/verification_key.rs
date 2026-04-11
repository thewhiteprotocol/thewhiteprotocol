//! Verification Key storage for Groth16 proofs - The White Protocol v2

use crate::ProofType;
use anchor_lang::prelude::*;

#[account]
pub struct VerificationKeyAccount {
    pub pool: Pubkey,
    pub proof_type: u8,
    pub vk_alpha_g1: [u8; 64],
    pub vk_beta_g2: [u8; 128],
    pub vk_gamma_g2: [u8; 128],
    pub vk_delta_g2: [u8; 128],
    pub vk_ic_len: u8,
    pub vk_ic: Vec<[u8; 64]>,
    pub is_initialized: bool,
    pub is_locked: bool,
    pub bump: u8,
    pub set_at: i64,
    pub locked_at: i64,
    pub vk_hash: [u8; 32],
    pub _reserved: [u8; 32],
}

impl VerificationKeyAccount {
    pub fn space(max_ic_points: u8) -> usize {
        8 + 32
            + 1
            + 64
            + 128
            + 128
            + 128
            + 1
            + 4
            + (64 * max_ic_points as usize)
            + 1
            + 1
            + 1
            + 8
            + 8
            + 32
            + 32
    }

    pub fn expected_ic_points(proof_type: ProofType) -> u8 {
        match proof_type {
            ProofType::Deposit => 4,
            ProofType::Withdraw => 9,
            ProofType::JoinSplit => 10,
            ProofType::Membership => 5,
            ProofType::MerkleBatchUpdate => 6,
            ProofType::WithdrawV2 => 13,
        }
    }

    pub fn expected_public_inputs_for_type(proof_type: ProofType) -> u8 {
        Self::expected_ic_points(proof_type) - 1
    }

    pub const DEFAULT_MAX_IC_POINTS: u8 = 15;
    pub const SEED_PREFIX: &'static [u8] = b"vk_v2";

    pub fn initialize(&mut self, pool: Pubkey, proof_type: ProofType, bump: u8) {
        self.pool = pool;
        self.proof_type = proof_type as u8;
        self.vk_alpha_g1 = [0u8; 64];
        self.vk_beta_g2 = [0u8; 128];
        self.vk_gamma_g2 = [0u8; 128];
        self.vk_delta_g2 = [0u8; 128];
        self.vk_ic_len = 0;
        self.vk_ic = Vec::new();
        self.is_initialized = false;
        self.is_locked = false;
        self.bump = bump;
        self.set_at = 0;
        self.locked_at = 0;
        self.vk_hash = [0u8; 32];
        self._reserved = [0u8; 32];
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_vk(
        &mut self,
        alpha_g1: [u8; 64],
        beta_g2: [u8; 128],
        gamma_g2: [u8; 128],
        delta_g2: [u8; 128],
        ic: Vec<[u8; 64]>,
        timestamp: i64,
    ) {
        self.vk_alpha_g1 = alpha_g1;
        self.vk_beta_g2 = beta_g2;
        self.vk_gamma_g2 = gamma_g2;
        self.vk_delta_g2 = delta_g2;
        self.vk_ic_len = ic.len() as u8;
        self.vk_ic = ic;
        self.is_initialized = true;
        self.set_at = timestamp;
        self.vk_hash = self.compute_vk_hash();
    }

    pub fn lock(&mut self, timestamp: i64) {
        self.is_locked = true;
        self.locked_at = timestamp;
    }

    pub fn is_valid(&self) -> bool {
        self.is_initialized && self.vk_ic_len > 0 && self.vk_ic.len() == self.vk_ic_len as usize
    }

    pub fn expected_public_inputs(&self) -> u8 {
        if self.vk_ic_len > 0 {
            self.vk_ic_len - 1
        } else {
            0
        }
    }

    pub fn validate_ic_length(&self) -> bool {
        if let Some(proof_type) = self.get_proof_type() {
            self.vk_ic_len == Self::expected_ic_points(proof_type)
        } else {
            false
        }
    }

    pub fn validate_ic_length_for_type(proof_type: ProofType, ic_len: u8) -> bool {
        ic_len == Self::expected_ic_points(proof_type)
    }

    pub fn get_proof_type(&self) -> Option<ProofType> {
        match self.proof_type {
            0 => Some(ProofType::Deposit),
            1 => Some(ProofType::Withdraw),
            2 => Some(ProofType::JoinSplit),
            3 => Some(ProofType::Membership),
            4 => Some(ProofType::MerkleBatchUpdate),
            5 => Some(ProofType::WithdrawV2),
            _ => None,
        }
    }

    /// Compute VK hash using Keccak256 (sha3 crate) for cryptographic security.
    /// Compute VK hash (public version for chunked upload)
    pub fn compute_vk_hash_internal(&self) -> [u8; 32] {
        let mut data = Vec::with_capacity(512 + self.vk_ic.len() * 64);
        data.extend_from_slice(&self.vk_alpha_g1);
        data.extend_from_slice(&self.vk_beta_g2);
        data.extend_from_slice(&self.vk_gamma_g2);
        data.extend_from_slice(&self.vk_delta_g2);
        for ic in &self.vk_ic {
            data.extend_from_slice(ic);
        }
        crate::crypto::keccak::keccak256(&data)
    }

    fn compute_vk_hash(&self) -> [u8; 32] {
        let mut data = Vec::with_capacity(512 + self.vk_ic.len() * 64);
        data.extend_from_slice(&self.vk_alpha_g1);
        data.extend_from_slice(&self.vk_beta_g2);
        data.extend_from_slice(&self.vk_gamma_g2);
        data.extend_from_slice(&self.vk_delta_g2);
        for ic in &self.vk_ic {
            data.extend_from_slice(ic);
        }

        crate::crypto::keccak::keccak256(&data)
    }

    pub fn verify_integrity(&self) -> bool {
        self.compute_vk_hash() == self.vk_hash
    }

    pub fn to_vk(&self) -> VerificationKeyV2 {
        VerificationKeyV2::from(self)
    }

    pub fn find_pda(program_id: &Pubkey, pool: &Pubkey, proof_type: ProofType) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[proof_type.as_seed(), pool.as_ref()], program_id)
    }

    pub fn seeds<'a>(
        proof_type: &'a ProofType,
        pool: &'a Pubkey,
        bump: &'a [u8; 1],
    ) -> [&'a [u8]; 3] {
        [proof_type.as_seed(), pool.as_ref(), bump]
    }
}

#[derive(Clone, Debug)]
pub struct VerificationKeyV2 {
    pub alpha_g1: [u8; 64],
    pub beta_g2: [u8; 128],
    pub gamma_g2: [u8; 128],
    pub delta_g2: [u8; 128],
    pub ic: Vec<[u8; 64]>,
}

impl From<&VerificationKeyAccount> for VerificationKeyV2 {
    fn from(account: &VerificationKeyAccount) -> Self {
        VerificationKeyV2 {
            alpha_g1: account.vk_alpha_g1,
            beta_g2: account.vk_beta_g2,
            gamma_g2: account.vk_gamma_g2,
            delta_g2: account.vk_delta_g2,
            ic: account.vk_ic.clone(),
        }
    }
}

impl VerificationKeyV2 {
    pub fn num_public_inputs(&self) -> usize {
        if self.ic.is_empty() {
            0
        } else {
            self.ic.len() - 1
        }
    }
}
