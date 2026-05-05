import { isValidCompressedSecp256k1Pubkey, shouldUseEvmStealthWithdrawal } from '../evm-stealth';

describe('evm-stealth', () => {
  describe('isValidCompressedSecp256k1Pubkey', () => {
    it('accepts 66-char hex starting with 0x02', () => {
      const pk = '02' + 'a'.repeat(64);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(true);
    });

    it('accepts 66-char hex starting with 0x03', () => {
      const pk = '03' + 'b'.repeat(64);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(true);
    });

    it('accepts mixed case', () => {
      const pk = '02' + 'AbCdEf'.repeat(10) + '1234';
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(true);
    });

    it('rejects 32-byte (64 hex chars)', () => {
      const pk = '02' + 'a'.repeat(62);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(false);
    });

    it('rejects 34-byte (68 hex chars)', () => {
      const pk = '02' + 'a'.repeat(66);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(false);
    });

    it('rejects prefix 0x04', () => {
      const pk = '04' + 'a'.repeat(64);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(false);
    });

    it('rejects prefix 0x00', () => {
      const pk = '00' + 'a'.repeat(64);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(false);
    });

    it('rejects all zeros', () => {
      const pk = '0'.repeat(66);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(false);
    });

    it('rejects non-hex characters', () => {
      const pk = '02' + 'g'.repeat(64);
      expect(isValidCompressedSecp256k1Pubkey(pk)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidCompressedSecp256k1Pubkey('')).toBe(false);
    });
  });

  describe('shouldUseEvmStealthWithdrawal', () => {
    it('returns false when no ephemeral pubkey', () => {
      expect(shouldUseEvmStealthWithdrawal(undefined)).toBe(false);
    });

    it('returns false for invalid pubkey', () => {
      expect(shouldUseEvmStealthWithdrawal('02' + 'a'.repeat(62))).toBe(false);
    });

    it('returns true for valid 0x02 pubkey', () => {
      expect(shouldUseEvmStealthWithdrawal('02' + 'a'.repeat(64))).toBe(true);
    });

    it('returns true for valid 0x03 pubkey', () => {
      expect(shouldUseEvmStealthWithdrawal('03' + 'a'.repeat(64))).toBe(true);
    });
  });
});
