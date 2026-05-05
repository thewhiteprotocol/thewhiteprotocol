import { PublicKey } from '@solana/web3.js';
import {
  findMerkleTreePda,
  findAssetVaultPda,
  findVaultTokenAccountPda,
  findSpentNullifierPda,
  findRelayerRegistryPda,
  findRelayerNodePda,
  findYieldRegistryPda,
  findPendingBufferPda,
  findWithdrawVkPda,
  findWithdrawV2VkPda,
  findMerkleBatchVkPda,
} from '../solana-pdas';

const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
const OPERATOR = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');

function assertPda(pda: PublicKey, bump: number) {
  expect(pda).toBeInstanceOf(PublicKey);
  expect(typeof bump).toBe('number');
  expect(bump).toBeGreaterThanOrEqual(0);
  expect(bump).toBeLessThanOrEqual(255);
}

describe('solana-pdas', () => {
  describe('findMerkleTreePda', () => {
    it('returns deterministic PDA for pool config', () => {
      const [pda1, bump1] = findMerkleTreePda(POOL_CONFIG, PROGRAM_ID);
      const [pda2, bump2] = findMerkleTreePda(POOL_CONFIG, PROGRAM_ID);
      assertPda(pda1, bump1);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
      expect(bump1).toBe(bump2);
    });

    it('returns different PDA for different pool configs', () => {
      const otherPool = new PublicKey('11111111111111111111111111111111');
      const [pda1] = findMerkleTreePda(POOL_CONFIG, PROGRAM_ID);
      const [pda2] = findMerkleTreePda(otherPool, PROGRAM_ID);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  describe('findAssetVaultPda', () => {
    it('returns deterministic PDA for asset id', () => {
      const assetId = new Uint8Array(32);
      assetId[31] = 1;
      const [pda1, bump1] = findAssetVaultPda(POOL_CONFIG, assetId, PROGRAM_ID);
      const [pda2, bump2] = findAssetVaultPda(POOL_CONFIG, assetId, PROGRAM_ID);
      assertPda(pda1, bump1);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('returns different PDA for different asset ids', () => {
      const assetId1 = new Uint8Array(32);
      const assetId2 = new Uint8Array(32);
      assetId2[31] = 2;
      const [pda1] = findAssetVaultPda(POOL_CONFIG, assetId1, PROGRAM_ID);
      const [pda2] = findAssetVaultPda(POOL_CONFIG, assetId2, PROGRAM_ID);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  describe('findVaultTokenAccountPda', () => {
    it('derives from asset vault', () => {
      const assetId = new Uint8Array(32);
      const [assetVault] = findAssetVaultPda(POOL_CONFIG, assetId, PROGRAM_ID);
      const [pda, bump] = findVaultTokenAccountPda(assetVault, PROGRAM_ID);
      assertPda(pda, bump);
    });
  });

  describe('findSpentNullifierPda', () => {
    it('returns deterministic PDA for nullifier hash', () => {
      const nullifierHash = new Uint8Array(32);
      nullifierHash[0] = 0xab;
      const [pda1, bump1] = findSpentNullifierPda(POOL_CONFIG, nullifierHash, PROGRAM_ID);
      const [pda2, bump2] = findSpentNullifierPda(POOL_CONFIG, nullifierHash, PROGRAM_ID);
      assertPda(pda1, bump1);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });
  });

  describe('findRelayerRegistryPda', () => {
    it('derives from pool config only', () => {
      const [pda, bump] = findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      assertPda(pda, bump);
    });
  });

  describe('findRelayerNodePda', () => {
    it('derives from registry and operator', () => {
      const [registry] = findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const [pda, bump] = findRelayerNodePda(registry, OPERATOR, PROGRAM_ID);
      assertPda(pda, bump);
    });

    it('changes with different operator', () => {
      const [registry] = findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const otherOperator = new PublicKey('11111111111111111111111111111111');
      const [pda1] = findRelayerNodePda(registry, OPERATOR, PROGRAM_ID);
      const [pda2] = findRelayerNodePda(registry, otherOperator, PROGRAM_ID);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  describe('findYieldRegistryPda', () => {
    it('derives from pool config', () => {
      const [pda, bump] = findYieldRegistryPda(POOL_CONFIG, PROGRAM_ID);
      assertPda(pda, bump);
    });
  });

  describe('findPendingBufferPda', () => {
    it('derives from pool config', () => {
      const [pda, bump] = findPendingBufferPda(POOL_CONFIG, PROGRAM_ID);
      assertPda(pda, bump);
    });
  });

  describe('findWithdrawVkPda', () => {
    it('derives from pool config', () => {
      const [pda, bump] = findWithdrawVkPda(POOL_CONFIG, PROGRAM_ID);
      assertPda(pda, bump);
    });
  });

  describe('findWithdrawV2VkPda', () => {
    it('derives from pool config with different seed than v1', () => {
      const [pda1] = findWithdrawVkPda(POOL_CONFIG, PROGRAM_ID);
      const [pda2] = findWithdrawV2VkPda(POOL_CONFIG, PROGRAM_ID);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  describe('findMerkleBatchVkPda', () => {
    it('derives from pool config', () => {
      const [pda, bump] = findMerkleBatchVkPda(POOL_CONFIG, PROGRAM_ID);
      assertPda(pda, bump);
    });
  });

  describe('determinism across all helpers', () => {
    it('produces same results when called multiple times', () => {
      const assetId = new Uint8Array(32);
      assetId[0] = 1;
      const nullifierHash = new Uint8Array(32);
      nullifierHash[0] = 2;

      const results1 = [
        findMerkleTreePda(POOL_CONFIG, PROGRAM_ID)[0].toBase58(),
        findAssetVaultPda(POOL_CONFIG, assetId, PROGRAM_ID)[0].toBase58(),
        findSpentNullifierPda(POOL_CONFIG, nullifierHash, PROGRAM_ID)[0].toBase58(),
        findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID)[0].toBase58(),
        findPendingBufferPda(POOL_CONFIG, PROGRAM_ID)[0].toBase58(),
      ];

      const results2 = [
        findMerkleTreePda(POOL_CONFIG, PROGRAM_ID)[0].toBase58(),
        findAssetVaultPda(POOL_CONFIG, assetId, PROGRAM_ID)[0].toBase58(),
        findSpentNullifierPda(POOL_CONFIG, nullifierHash, PROGRAM_ID)[0].toBase58(),
        findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID)[0].toBase58(),
        findPendingBufferPda(POOL_CONFIG, PROGRAM_ID)[0].toBase58(),
      ];

      expect(results1).toEqual(results2);
    });
  });
});
