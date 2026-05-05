/**
 * Solana PDA derivation helpers for the relayer.
 *
 * ⚠️ SDK COMPATIBILITY WARNING:
 * These helpers intentionally do NOT delegate to @whiteprotocol/sdk because
 * the SDK's PDA seeds target a future program revision (v2 seeds) that is
 * incompatible with the currently deployed devnet program.
 *
 * Seed discrepancies (SDK vs deployed program):
 *   - PoolConfig:      "pool_v2"        vs "white_pool"
 *   - MerkleTree:      "merkle_tree_v2" vs "merkle_tree"
 *   - AssetVault:      "vault_v2"       vs "vault"
 *   - SpentNullifier:  "nullifier_v2"   vs "nullifier"
 *   - PendingBuffer:   "pending_deposits" vs "pending"
 *   - VK accounts:     "vk_v2" + type   vs direct "vk_{type}"
 *
 * The SDK also lacks ProofType.MerkleBatchUpdate, so it cannot derive the
 * vk_merkle_batch PDA used by the batch settlement sequencer.
 *
 * See relayer/SDK-WIRING-AUDIT.md for the full audit.
 *
 * When the on-chain program is upgraded to match SDK seeds, this file can
 * be replaced with @whiteprotocol/sdk imports after verifying parity.
 */

import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');

export function findMerkleTreePda(
  poolConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('merkle_tree'), poolConfig.toBuffer()],
    programId
  );
}

export function findAssetVaultPda(
  poolConfig: PublicKey,
  assetId: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolConfig.toBuffer(), Buffer.from(assetId)],
    programId
  );
}

export function findVaultTokenAccountPda(
  assetVault: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault_token'), assetVault.toBuffer()],
    programId
  );
}

export function findSpentNullifierPda(
  poolConfig: PublicKey,
  nullifierHash: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), poolConfig.toBuffer(), Buffer.from(nullifierHash)],
    programId
  );
}

export function findRelayerRegistryPda(
  poolConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('relayer_registry'), poolConfig.toBuffer()],
    programId
  );
}

export function findRelayerNodePda(
  registry: PublicKey,
  operator: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('relayer'), registry.toBuffer(), operator.toBuffer()],
    programId
  );
}

export function findYieldRegistryPda(
  poolConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('yield_registry'), poolConfig.toBuffer()],
    programId
  );
}

export function findPendingBufferPda(
  poolConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pending'), poolConfig.toBuffer()],
    programId
  );
}

export function findWithdrawVkPda(
  poolConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vk_withdraw'), poolConfig.toBuffer()],
    programId
  );
}

export function findWithdrawV2VkPda(
  poolConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vk_withdraw_v2'), poolConfig.toBuffer()],
    programId
  );
}

export function findMerkleBatchVkPda(
  poolConfig: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vk_merkle_batch'), poolConfig.toBuffer()],
    programId
  );
}
