/**
 * Solana PDA derivation helpers for the relayer.
 *
 * These mirror the SDK's pda.ts signatures so that future migration to
 * @whiteprotocol/sdk is a drop-in replacement. Seeds are kept identical
 * to the deployed devnet program.
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
