import {
  computeSolanaAssetIdV1,
  computeEvmAssetIdV1,
  computeEvmAssetIdV2,
  computeAssetId,
  assetIdToBigInt,
  bytesToHex,
  isValidSolanaPubkey,
  isValidEvmAddress,
} from '../asset-id';
import { PublicKey } from '@solana/web3.js';

describe('asset-id', () => {
  describe('computeSolanaAssetIdV1', () => {
    it('produces deterministic output for same mint', () => {
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const a1 = computeSolanaAssetIdV1(mint);
      const a2 = computeSolanaAssetIdV1(mint);
      expect(bytesToHex(a1)).toBe(bytesToHex(a2));
    });

    it('produces different output for different mints', () => {
      const mint1 = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const mint2 = new PublicKey('So11111111111111111111111111111111111111112');
      const a1 = computeSolanaAssetIdV1(mint1);
      const a2 = computeSolanaAssetIdV1(mint2);
      expect(bytesToHex(a1)).not.toBe(bytesToHex(a2));
    });

    it('has leading zero byte', () => {
      const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      const assetId = computeSolanaAssetIdV1(mint);
      expect(assetId[0]).toBe(0x00);
    });
  });

  describe('computeEvmAssetIdV1', () => {
    it('produces deterministic output for same address', () => {
      const addr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const a1 = computeEvmAssetIdV1(addr);
      const a2 = computeEvmAssetIdV1(addr);
      expect(bytesToHex(a1)).toBe(bytesToHex(a2));
    });

    it('is case-insensitive', () => {
      const a1 = computeEvmAssetIdV1('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      const a2 = computeEvmAssetIdV1('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      expect(bytesToHex(a1)).toBe(bytesToHex(a2));
    });

    it('throws for invalid address', () => {
      expect(() => computeEvmAssetIdV1('0xdead')).toThrow('Invalid EVM token address');
    });
  });

  describe('computeEvmAssetIdV2', () => {
    it('produces different output for different domainIds', () => {
      const addr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const a1 = computeEvmAssetIdV2(addr, 33554434);
      const a2 = computeEvmAssetIdV2(addr, 33554435);
      expect(bytesToHex(a1)).not.toBe(bytesToHex(a2));
    });

    it('produces different output for same domainId but different addresses', () => {
      const a1 = computeEvmAssetIdV2('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 33554434);
      const a2 = computeEvmAssetIdV2('0xdAC17F958D2ee523a2206206994597C13D831ec7', 33554434);
      expect(bytesToHex(a1)).not.toBe(bytesToHex(a2));
    });

    it('has leading zero byte', () => {
      const assetId = computeEvmAssetIdV2('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 33554434);
      expect(assetId[0]).toBe(0x00);
    });
  });

  describe('computeAssetId unified', () => {
    it('computes Solana v1 asset ID', () => {
      const result = computeAssetId('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 1, 33554433);
      expect(result.version).toBe(1);
      expect(result.domainId).toBe(33554433);
      expect(result.fieldSafe).toBe(true);
      expect(result.assetId).toHaveLength(64);
    });

    it('computes EVM v2 asset ID', () => {
      const result = computeAssetId('evm', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 2, 33554434);
      expect(result.version).toBe(2);
      expect(result.domainId).toBe(33554434);
      expect(result.formula).toContain('v2');
    });

    it('computes EVM v1 asset ID', () => {
      const result = computeAssetId('evm', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1, 33554434);
      expect(result.version).toBe(1);
      expect(result.formula).toContain('v1');
    });

    it('throws for Solana with version !== 1', () => {
      expect(() => computeAssetId('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 2, 33554433))
        .toThrow('Solana only supports asset ID version 1');
    });

    it('throws for unsupported version', () => {
      expect(() => computeAssetId('evm', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 3, 33554434))
        .toThrow('Unsupported asset ID version');
    });

    it('throws for unsupported family', () => {
      expect(() => computeAssetId('bitcoin' as any, 'addr', 1, 0))
        .toThrow('Unsupported chain family');
    });
  });

  describe('assetIdToBigInt', () => {
    it('converts zero asset ID to zero', () => {
      expect(assetIdToBigInt(new Uint8Array(32))).toBe(0n);
    });

    it('converts nonzero asset ID correctly', () => {
      const bytes = new Uint8Array(32);
      bytes[31] = 0x01;
      expect(assetIdToBigInt(bytes)).toBe(1n);
    });
  });

  describe('bytesToHex', () => {
    it('converts bytes to hex', () => {
      expect(bytesToHex(new Uint8Array([0xab, 0xcd]))).toBe('abcd');
    });

    it('pads single nibble bytes', () => {
      expect(bytesToHex(new Uint8Array([0x01, 0x0f]))).toBe('010f');
    });
  });

  describe('isValidSolanaPubkey', () => {
    it('accepts valid pubkey', () => {
      expect(isValidSolanaPubkey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('rejects invalid pubkey', () => {
      expect(isValidSolanaPubkey('not-a-pubkey')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidSolanaPubkey('')).toBe(false);
    });
  });

  describe('isValidEvmAddress', () => {
    it('accepts valid checksummed address', () => {
      expect(isValidEvmAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(true);
    });

    it('accepts lowercase address', () => {
      expect(isValidEvmAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(true);
    });

    it('rejects short address', () => {
      expect(isValidEvmAddress('0xdead')).toBe(false);
    });

    it('rejects missing 0x prefix', () => {
      expect(isValidEvmAddress('a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(isValidEvmAddress('0xGGGG9999c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(false);
    });
  });
});
