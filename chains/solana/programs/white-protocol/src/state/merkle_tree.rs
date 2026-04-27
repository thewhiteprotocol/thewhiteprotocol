//! Incremental Merkle Tree for MASP commitment storage - The White Protocol v2
//!
//! # Multi-Asset Shared Tree
//! Unlike v1, the v2 Merkle tree is shared across all assets.
//! Commitments include the asset_id to distinguish between assets
//! while maintaining a single anonymity set.
//!
//! # Commitment Format
//! commitment = Poseidon(secret, nullifier, amount, asset_id)
//!
//! # Performance
//! - O(log n) insertions using filled_subtrees pattern
//! - O(1) root history lookup for stale-proof tolerance
//!
//! # Zero Value Computation
//! Zero values at each level are precomputed during initialization:
//! - zeros[0] = 0 (empty leaf)
//! - zeros[i] = H(zeros[i-1], zeros[i-1])

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::utils::cu;

/// Maximum supported tree depth (2^24 = ~16M leaves)
pub const MAX_TREE_DEPTH: u8 = 24;

/// Minimum supported tree depth
pub const MIN_TREE_DEPTH: u8 = 4;

/// Minimum root history size
pub const MIN_ROOT_HISTORY_SIZE: u16 = 30;

/// Default root history size
pub const DEFAULT_ROOT_HISTORY_SIZE: u16 = 100;

/// Incremental Merkle tree state account for MASP v2
///
/// PDA Seeds: `[b"merkle_tree", pool_config.key().as_ref()]`
#[account]
pub struct MerkleTree {
    /// Reference to parent pool
    pub pool: Pubkey,

    /// Tree depth (immutable after init)
    pub depth: u8,

    /// Next leaf index to be filled (also = total leaves inserted)
    pub next_leaf_index: u32,

    /// Current root hash
    pub current_root: [u8; 32],

    /// Root history for withdrawal proofs (circular buffer)
    /// Allows users to prove against recent roots even if tree updated
    pub root_history: Vec<[u8; 32]>,

    /// Current position in circular root history buffer
    pub root_history_index: u16,

    /// Maximum root history size (set at init)
    pub root_history_size: u16,

    /// Filled subtrees for incremental updates
    /// Contains the rightmost non-zero hash at each level
    /// Length = depth
    pub filled_subtrees: Vec<[u8; 32]>,

    /// Precomputed zero values for each level
    /// zeros[0] = hash of empty leaf (0)
    /// zeros[i] = hash(zeros[i-1], zeros[i-1])
    /// Length = depth + 1
    pub zeros: Vec<[u8; 32]>,

    /// Total deposits by leaf count (for statistics)
    pub total_leaves: u64,

    /// Last insertion timestamp
    pub last_insertion_at: i64,

    /// Tree version (for potential upgrades)
    pub version: u8,
}

impl MerkleTree {
    /// Calculate space needed for merkle tree account
    pub fn space(depth: u8, root_history_size: u16) -> usize {
        let depth_usize = depth as usize;
        let history_usize = root_history_size as usize;

        8                                       // discriminator
            + 32                                // pool
            + 1                                 // depth
            + 4                                 // next_leaf_index
            + 32                                // current_root
            + 4 + (32 * history_usize)          // root_history (vec)
            + 2                                 // root_history_index
            + 2                                 // root_history_size
            + 4 + (32 * depth_usize)            // filled_subtrees (vec)
            + 4 + (32 * (depth_usize + 1))      // zeros (vec)
            + 8                                 // total_leaves
            + 8                                 // last_insertion_at
            + 1 // version
    }

    pub const VERSION: u8 = 2;

    /// Initialize the Merkle tree with empty state
    ///
    /// # Arguments
    /// * `pool` - Parent pool public key
    /// * `depth` - Tree depth (4-24)
    /// * `root_history_size` - Number of historical roots to maintain (min 30)
    ///
    /// # Errors
    /// - `InvalidTreeDepth` if depth is out of range
    /// - `InvalidRootHistorySize` if history size < 30
    /// - `CryptographyError` if Poseidon hash fails
    pub fn initialize(&mut self, pool: Pubkey, depth: u8, root_history_size: u16) -> Result<()> {
        // Validate parameters
        require!(
            depth >= MIN_TREE_DEPTH && depth <= MAX_TREE_DEPTH,
            WhiteProtocolError::InvalidTreeDepth
        );
        require!(
            root_history_size >= MIN_ROOT_HISTORY_SIZE,
            WhiteProtocolError::InvalidRootHistorySize
        );

        self.pool = pool;
        self.depth = depth;
        self.next_leaf_index = 0;
        self.root_history_index = 0;
        self.root_history_size = root_history_size;
        self.total_leaves = 0;
        self.last_insertion_at = 0;
        self.version = Self::VERSION;

        // Compute and store zero values for all levels
        self.zeros = crate::crypto::precomputed_zeros::get_precomputed_zeros(depth);

        // Initialize filled subtrees with zeros
        self.filled_subtrees = self.zeros[..depth as usize].to_vec();

        // Initialize root history buffer
        self.root_history = vec![[0u8; 32]; root_history_size as usize];

        // Set initial root (root of empty tree)
        self.current_root = self.zeros[depth as usize];

        // Store initial root in history
        self.root_history[0] = self.current_root;

        Ok(())
    }

    /// Compute zero hash values for each tree level
    ///
    /// Level 0 = leaf level (zero leaf = 0)
    /// Level depth = root level
    ///
    /// # Arguments
    /// * `depth` - Tree depth
    ///
    /// # Returns
    /// Vector of zero hashes for each level (length = depth + 1)
    #[allow(dead_code)]
    fn compute_zero_values(depth: u8) -> Result<Vec<[u8; 32]>> {
        let mut zeros = Vec::with_capacity((depth + 1) as usize);

        // Level 0: canonical zero leaf (all zeros)
        zeros.push([0u8; 32]);

        // Compute hash(zero[i-1], zero[i-1]) for each level
        for i in 1..=depth {
            let prev = &zeros[(i - 1) as usize];
            let zero_at_level = crate::crypto::hash_two_to_one(prev, prev)?;
            zeros.push(zero_at_level);
        }

        Ok(zeros)
    }

    /// Insert a new commitment leaf into the tree
    ///
    /// Uses the incremental Merkle tree algorithm with filled_subtrees
    /// for O(log n) insertion.
    ///
    /// # Arguments
    /// * `commitment` - 32-byte commitment hash (must be non-zero)
    /// * `timestamp` - Current timestamp for tracking
    ///
    /// # Returns
    /// The leaf index where commitment was inserted
    ///
    /// # Errors
    /// - `MerkleTreeFull` if tree capacity is exhausted
    /// - `InvalidCommitment` if commitment is zero
    /// - `ArithmeticOverflow` on counter overflow
    /// - `CryptographyError` if Poseidon hash fails
    pub fn insert_leaf(&mut self, commitment: [u8; 32], timestamp: i64) -> Result<u32> {
        cu("merkle: insert_leaf start");
        // Reject zero commitments (these are reserved for empty leaves)
        require!(
            !crate::crypto::is_zero_hash(&commitment),
            WhiteProtocolError::InvalidCommitment
        );

        // Check tree capacity
        let max_leaves = 1u32
            .checked_shl(self.depth as u32)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        require!(
            self.next_leaf_index < max_leaves,
            WhiteProtocolError::MerkleTreeFull
        );

        let leaf_index = self.next_leaf_index;
        let mut current_hash = commitment;
        let mut current_index = leaf_index;

        // Walk up the tree, updating hashes
        for level in 0..self.depth {
            let level_usize = level as usize;

            // Determine if this node is a left (0) or right (1) child
            let is_right_child = (current_index & 1) == 1;
            current_index >>= 1;

            if is_right_child {
                // Right child: hash with left sibling from filled_subtrees
                let left_sibling = self.filled_subtrees[level_usize];
                current_hash = crate::crypto::hash_two_to_one(&left_sibling, &current_hash)?;
            } else {
                // Left child: update filled_subtree, hash with zero
                self.filled_subtrees[level_usize] = current_hash;
                current_hash =
                    crate::crypto::hash_two_to_one(&current_hash, &self.zeros[level_usize])?;
            }
        }

        // Update current root
        self.current_root = current_hash;

        // Add to root history (circular buffer)
        // Store first, then increment to avoid off-by-one
        self.root_history[self.root_history_index as usize] = current_hash;
        self.root_history_index = (self.root_history_index + 1) % self.root_history_size;

        // Increment leaf counter
        self.next_leaf_index = self
            .next_leaf_index
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        // Update statistics
        self.total_leaves = self
            .total_leaves
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        self.last_insertion_at = timestamp;

        Ok(leaf_index)
    }

    /// Replay incremental insertions to update filled_subtrees without touching
    /// other state (root, counters, history). Used by settle_deposits_batch to
    /// keep the tree consistent after ZK-verified batch settlement.
    ///
    /// # Arguments
    /// * `commitments` - Slice of commitments to insert
    /// * `start_index` - Starting leaf index for the first commitment
    ///
    /// # Returns
    /// Computed root hash after all insertions
    ///
    /// # Errors
    /// - `CryptographyError` if Poseidon hash fails
    pub fn replay_insertions(&mut self, commitments: &[[u8; 32]], start_index: u32) -> Result<[u8; 32]> {
        let mut computed_root = [0u8; 32];
        for (i, commitment) in commitments.iter().enumerate() {
            let leaf_index = start_index + i as u32;
            let mut current_hash = *commitment;
            let mut current_index = leaf_index;

            for level in 0..self.depth {
                let level_usize = level as usize;
                let is_right_child = (current_index & 1) == 1;
                current_index >>= 1;

                if is_right_child {
                    let left_sibling = self.filled_subtrees[level_usize];
                    current_hash = crate::crypto::hash_two_to_one(&left_sibling, &current_hash)?;
                } else {
                    self.filled_subtrees[level_usize] = current_hash;
                    current_hash = crate::crypto::hash_two_to_one(
                        &current_hash,
                        &self.zeros[level_usize],
                    )?;
                }
            }
            computed_root = current_hash;
        }
        Ok(computed_root)
    }

    /// Check if a root exists in recent history
    ///
    /// This allows users to generate proofs against slightly stale roots,
    /// accommodating network latency and concurrent transactions.
    ///
    /// # Arguments
    /// * `root` - The Merkle root to check
    ///
    /// # Returns
    /// `true` if root is current or in recent history
    ///
    /// # Security
    /// Rejects all-zero root to prevent matching uninitialized history slots.
    /// This is critical: the history buffer is initialized with zeros, so
    /// without this check, an attacker could submit a withdrawal with root=[0;32]
    /// and bypass the merkle membership proof entirely.
    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        // SECURITY: Reject zero root to prevent matching uninitialized slots
        if root.iter().all(|&b| b == 0) {
            return false;
        }

        // Check current root first (most common case)
        if *root == self.current_root {
            return true;
        }

        // Check history buffer - only match non-zero entries
        self.root_history.iter().any(|r| {
            // Skip zero entries (uninitialized slots)
            !r.iter().all(|&b| b == 0) && r == root
        })
    }

    /// Get the current Merkle root
    #[inline]
    pub fn get_current_root(&self) -> [u8; 32] {
        self.current_root
    }

    /// Get the next leaf index
    #[inline]
    pub fn get_next_leaf_index(&self) -> u32 {
        self.next_leaf_index
    }

    /// Get tree capacity (2^depth)
    #[inline]
    pub fn capacity(&self) -> u32 {
        1u32.checked_shl(self.depth as u32).unwrap_or(u32::MAX)
    }

    /// Check if tree is full
    #[inline]
    pub fn is_full(&self) -> bool {
        self.next_leaf_index >= self.capacity()
    }

    /// Get available space in tree
    #[inline]
    pub fn available_space(&self) -> u32 {
        self.capacity().saturating_sub(self.next_leaf_index)
    }

    /// Get fill percentage (0-100)
    #[inline]
    pub fn fill_percentage(&self) -> u8 {
        let capacity = self.capacity() as u64;
        let used = self.next_leaf_index as u64;
        ((used * 100) / capacity) as u8
    }

    /// Get the zero hash for a specific level
    ///
    /// # Arguments
    /// * `level` - Tree level (0 = leaf level)
    ///
    /// # Returns
    /// Zero hash for that level, or None if level is out of range
    pub fn get_zero_at_level(&self, level: u8) -> Option<[u8; 32]> {
        self.zeros.get(level as usize).copied()
    }

    /// Compute a Merkle proof for a given leaf index
    ///
    /// # Arguments
    /// * `leaf_index` - Index of the leaf to prove
    ///
    /// # Returns
    /// Vector of sibling hashes from leaf to root
    ///
    /// # Note
    /// This requires knowing the current tree state.
    /// For a leaf that was inserted when tree had fewer leaves,
    /// some siblings may be zero hashes.
    pub fn get_merkle_path(&self, leaf_index: u32) -> Result<Vec<[u8; 32]>> {
        require!(
            leaf_index < self.next_leaf_index,
            WhiteProtocolError::LeafIndexNotFound
        );

        let mut path = Vec::with_capacity(self.depth as usize);
        let mut current_index = leaf_index;

        for level in 0..self.depth {
            let level_usize = level as usize;
            let is_right_child = (current_index & 1) == 1;
            let sibling_index = if is_right_child {
                current_index - 1
            } else {
                current_index + 1
            };

            // Get sibling hash
            // If sibling is beyond current tree, use zero
            let sibling_hash = if sibling_index >= (self.next_leaf_index >> level) {
                self.zeros[level_usize]
            } else if is_right_child {
                // Left sibling exists in filled_subtrees for completed subtrees
                self.filled_subtrees[level_usize]
            } else {
                // Right sibling exists but we don't store right subtrees on-chain.
                // This is only accurate when filled_subtrees is fully maintained
                // (i.e., after batch_process_deposits). After settle_deposits_batch,
                // filled_subtrees is NOT updated, so this path may return an
                // incorrect zero hash. For ZK-settled trees, Merkle proofs MUST
                // be generated from an off-chain tree mirror (e.g., the relayer).
                // SECURITY: Withdrawals verify the root, not this path, on-chain.
                self.zeros[level_usize]
            };

            path.push(sibling_hash);
            current_index >>= 1;
        }

        Ok(path)
    }
}

/// PDA seeds for MerkleTree
impl MerkleTree {
    pub const SEED_PREFIX: &'static [u8] = b"merkle_tree";

    pub fn find_pda(program_id: &Pubkey, pool: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[Self::SEED_PREFIX, pool.as_ref()], program_id)
    }

    pub fn seeds<'a>(pool: &'a Pubkey, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
        [Self::SEED_PREFIX, pool.as_ref(), bump]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_space_calculation() {
        let space = MerkleTree::space(20, 100);
        // Should be reasonable size
        assert!(space < 10_000_000); // Less than 10MB
        assert!(space > 1000); // But not trivially small
    }

    #[test]
    fn test_capacity() {
        let tree = MerkleTree {
            pool: Pubkey::default(),
            depth: 20,
            next_leaf_index: 0,
            current_root: [0u8; 32],
            root_history: vec![],
            root_history_index: 0,
            root_history_size: 100,
            filled_subtrees: vec![],
            zeros: vec![],
            total_leaves: 0,
            last_insertion_at: 0,
            version: 2,
        };

        assert_eq!(tree.capacity(), 1 << 20); // 2^20 = 1,048,576
        assert!(!tree.is_full());
        assert_eq!(tree.fill_percentage(), 0);
    }

    #[test]
    fn test_capacity_edge_cases() {
        // Test depth 4 (minimum)
        let tree4 = MerkleTree {
            pool: Pubkey::default(),
            depth: 4,
            next_leaf_index: 0,
            current_root: [0u8; 32],
            root_history: vec![],
            root_history_index: 0,
            root_history_size: 30,
            filled_subtrees: vec![],
            zeros: vec![],
            total_leaves: 0,
            last_insertion_at: 0,
            version: 2,
        };
        assert_eq!(tree4.capacity(), 16); // 2^4

        // Test depth 24 (maximum)
        let tree24 = MerkleTree {
            pool: Pubkey::default(),
            depth: 24,
            next_leaf_index: 0,
            current_root: [0u8; 32],
            root_history: vec![],
            root_history_index: 0,
            root_history_size: 100,
            filled_subtrees: vec![],
            zeros: vec![],
            total_leaves: 0,
            last_insertion_at: 0,
            version: 2,
        };
        assert_eq!(tree24.capacity(), 1 << 24); // ~16M
    }

    #[test]
    fn test_is_known_root() {
        let root1 = [1u8; 32];
        let root2 = [2u8; 32];
        let root3 = [3u8; 32];

        let tree = MerkleTree {
            pool: Pubkey::default(),
            depth: 20,
            next_leaf_index: 0,
            current_root: root1,
            root_history: vec![root1, root2],
            root_history_index: 2,
            root_history_size: 100,
            filled_subtrees: vec![],
            zeros: vec![],
            total_leaves: 0,
            last_insertion_at: 0,
            version: 2,
        };

        assert!(tree.is_known_root(&root1)); // Current root
        assert!(tree.is_known_root(&root2)); // In history
        assert!(!tree.is_known_root(&root3)); // Not known
    }

    /// CRITICAL SECURITY TEST: Zero root must always be rejected
    /// to prevent matching uninitialized history slots.
    #[test]
    fn test_is_known_root_rejects_zero() {
        let zero_root = [0u8; 32];
        let valid_root = [1u8; 32];

        // Tree with zero history slots (uninitialized)
        let tree_with_zeros = MerkleTree {
            pool: Pubkey::default(),
            depth: 20,
            next_leaf_index: 0,
            current_root: valid_root,
            root_history: vec![[0u8; 32], [0u8; 32], valid_root], // zeros in history
            root_history_index: 3,
            root_history_size: 100,
            filled_subtrees: vec![],
            zeros: vec![],
            total_leaves: 0,
            last_insertion_at: 0,
            version: 2,
        };

        // Zero root must NEVER match, even when zeros are in history
        assert!(
            !tree_with_zeros.is_known_root(&zero_root),
            "SECURITY: Zero root must be rejected to prevent uninitialized slot matching"
        );

        // Valid root still works
        assert!(tree_with_zeros.is_known_root(&valid_root));

        // Tree where current_root is zero (edge case after init)
        let tree_with_zero_current = MerkleTree {
            pool: Pubkey::default(),
            depth: 20,
            next_leaf_index: 0,
            current_root: [0u8; 32], // empty tree
            root_history: vec![[0u8; 32]],
            root_history_index: 1,
            root_history_size: 100,
            filled_subtrees: vec![],
            zeros: vec![],
            total_leaves: 0,
            last_insertion_at: 0,
            version: 2,
        };

        // Even with zero current_root, zero input should be rejected
        assert!(
            !tree_with_zero_current.is_known_root(&zero_root),
            "SECURITY: Zero root must be rejected even when current_root is zero"
        );
    }

    #[test]
    fn test_fill_percentage() {
        let mut tree = MerkleTree {
            pool: Pubkey::default(),
            depth: 4, // capacity = 16
            next_leaf_index: 0,
            current_root: [0u8; 32],
            root_history: vec![],
            root_history_index: 0,
            root_history_size: 30,
            filled_subtrees: vec![],
            zeros: vec![],
            total_leaves: 0,
            last_insertion_at: 0,
            version: 2,
        };

        assert_eq!(tree.fill_percentage(), 0);

        tree.next_leaf_index = 8;
        assert_eq!(tree.fill_percentage(), 50);

        tree.next_leaf_index = 16;
        assert_eq!(tree.fill_percentage(), 100);
    }
}
