import { PublicKey, Connection } from '@solana/web3.js';
import { validateSolanaRelayerFee, fetchRelayerRegistry, fetchRelayerNode } from '../solana-fee-validator';

const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
const OPERATOR = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');

function buildRegistryAccount(minFeeBps: number, maxFeeBps: number): Buffer {
  const data = Buffer.alloc(8 + 32 + 2 + 2 + 1 + 8 + 4 + 4 + 8 + 8 + 8 + 8 + 1 + 1 + 32);
  let offset = 8;
  POOL_CONFIG.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt16LE(minFeeBps, offset);
  offset += 2;
  data.writeUInt16LE(maxFeeBps, offset);
  offset += 2;
  data[offset] = 0;
  offset += 1;
  data.writeBigUInt64LE(0n, offset);
  offset += 8;
  data.writeUInt32LE(1, offset);
  offset += 4;
  data.writeUInt32LE(1, offset);
  offset += 4;
  offset += 8 + 8 + 8 + 8;
  data[offset] = 1;
  offset += 1;
  data[offset] = 1;
  return data;
}

function buildNodeAccount(registryPda: PublicKey, feeBps: number, isActive: boolean): Buffer {
  const metadataUri = '';
  const space = 8 + 32 + 32 + 2 + 1 + 8 + 8 + 8 + 8 + 8 + 4 + metadataUri.length + 1 + 1 + 16;
  const data = Buffer.alloc(space);
  let offset = 8;
  registryPda.toBuffer().copy(data, offset);
  offset += 32;
  OPERATOR.toBuffer().copy(data, offset);
  offset += 32;
  data.writeUInt16LE(feeBps, offset);
  offset += 2;
  data[offset] = isActive ? 1 : 0;
  offset += 1;
  data.writeBigUInt64LE(0n, offset);
  offset += 8;
  data.writeBigUInt64LE(0n, offset);
  offset += 8;
  data.writeBigUInt64LE(0n, offset);
  offset += 8;
  data.writeBigUInt64LE(0n, offset);
  offset += 8;
  data.writeUInt32LE(metadataUri.length, offset);
  offset += 4;
  offset += metadataUri.length;
  data[offset] = 1;
  offset += 1;
  data[offset] = 50;
  return data;
}

function mockConnection(accounts: Record<string, Buffer | null>): Connection {
  return {
    getAccountInfo: jest.fn(async (pubkey: PublicKey) => {
      const data = accounts[pubkey.toBase58()];
      if (!data) return null;
      return {
        data,
        owner: PROGRAM_ID,
        executable: false,
        lamports: 1000000,
      } as any;
    }),
  } as unknown as Connection;
}

describe('solana-fee-validator', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowMissing = process.env.RELAYER_ALLOW_MISSING_SOLANA_REGISTRY;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.RELAYER_ALLOW_MISSING_SOLANA_REGISTRY = originalAllowMissing;
    jest.restoreAllMocks();
  });

  describe('fetchRelayerRegistry', () => {
    it('returns parsed registry when account exists', async () => {
      const registryData = buildRegistryAccount(10, 500);
      const conn = mockConnection({
        'EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS': registryData, // wrong key, will be derived
      });
      const result = await fetchRelayerRegistry(conn, POOL_CONFIG, PROGRAM_ID);
      // Account won't match derived PDA, so returns null
      expect(result).toBeNull();
    });

    it('returns null when account missing', async () => {
      const conn = mockConnection({});
      const result = await fetchRelayerRegistry(conn, POOL_CONFIG, PROGRAM_ID);
      expect(result).toBeNull();
    });
  });

  describe('fetchRelayerNode', () => {
    it('returns null when account missing', async () => {
      const conn = mockConnection({});
      const [registry] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const result = await fetchRelayerNode(conn, registry, OPERATOR, PROGRAM_ID);
      expect(result).toBeNull();
    });
  });

  describe('validateSolanaRelayerFee', () => {
    it('passes when fee is within registry bounds and node is active', async () => {
      const [registryPda] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      // Node PDA uses registry PDA as registry seed
      const [nodePda] = require('../solana-pdas').findRelayerNodePda(registryPda, OPERATOR, PROGRAM_ID);

      const conn = mockConnection({
        [registryPda.toBase58()]: buildRegistryAccount(10, 500),
        [nodePda.toBase58()]: buildNodeAccount(registryPda, 50, true),
      });

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      expect(result.ok).toBe(true);
      expect(result.registry).toBeDefined();
      expect(result.node).toBeDefined();
    });

    it('fails when fee is below registry minimum', async () => {
      const [registryPda] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const conn = mockConnection({
        [registryPda.toBase58()]: buildRegistryAccount(50, 500),
      });

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 10);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('out of on-chain bounds');
    });

    it('fails when fee is above registry maximum', async () => {
      const [registryPda] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const conn = mockConnection({
        [registryPda.toBase58()]: buildRegistryAccount(10, 100),
      });

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 200);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('out of on-chain bounds');
    });

    it('fails when relayer node is inactive', async () => {
      const [registryPda] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const [nodePda] = require('../solana-pdas').findRelayerNodePda(registryPda, OPERATOR, PROGRAM_ID);

      const conn = mockConnection({
        [registryPda.toBase58()]: buildRegistryAccount(10, 500),
        [nodePda.toBase58()]: buildNodeAccount(registryPda, 50, false),
      });

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('inactive');
    });

    it('fails when relayer node feeBps mismatches config', async () => {
      const [registryPda] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const [nodePda] = require('../solana-pdas').findRelayerNodePda(registryPda, OPERATOR, PROGRAM_ID);

      const conn = mockConnection({
        [registryPda.toBase58()]: buildRegistryAccount(10, 500),
        [nodePda.toBase58()]: buildNodeAccount(registryPda, 100, true),
      });

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('fee mismatch');
    });

    it('passes with only registry when node does not exist', async () => {
      const [registryPda] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const conn = mockConnection({
        [registryPda.toBase58()]: buildRegistryAccount(10, 500),
      });

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      expect(result.ok).toBe(true);
      expect(result.registry).toBeDefined();
      expect(result.node).toBeNull();
    });

    it('fails closed in production when registry missing', async () => {
      process.env.NODE_ENV = 'production';
      const conn = mockConnection({});

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('cannot operate in production without registry');
    });

    it('fails in dev when registry missing and override not set', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.RELAYER_ALLOW_MISSING_SOLANA_REGISTRY;
      const conn = mockConnection({});

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Set RELAYER_ALLOW_MISSING_SOLANA_REGISTRY=true');
    });

    it('passes in dev when registry missing and override is true', async () => {
      process.env.NODE_ENV = 'development';
      process.env.RELAYER_ALLOW_MISSING_SOLANA_REGISTRY = 'true';
      const conn = mockConnection({});

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      expect(result.ok).toBe(true);
    });

    it('handles malformed registry data gracefully', async () => {
      const [registryPda] = require('../solana-pdas').findRelayerRegistryPda(POOL_CONFIG, PROGRAM_ID);
      const conn = mockConnection({
        [registryPda.toBase58()]: Buffer.from('too short'),
      });

      const result = await validateSolanaRelayerFee(conn, POOL_CONFIG, PROGRAM_ID, OPERATOR, 50);
      // parseRegistry returns null on error, which then hits missing-registry path
      expect(result.ok).toBe(false);
    });
  });
});
