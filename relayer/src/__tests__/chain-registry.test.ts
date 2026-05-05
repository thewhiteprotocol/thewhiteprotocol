import {
  buildChainRegistry,
  getChainRegistry,
  resetChainRegistry,
  resolveChain,
  validateChainParameter,
  getSupportedChainKeys,
  getLiveChainEntries,
  createApiError,
  buildQuote,
  buildEvmAssetsForChain,
} from '../chain-registry';

describe('chain-registry', () => {
  beforeEach(() => {
    resetChainRegistry();
  });

  describe('buildChainRegistry', () => {
    it('includes solana and sol aliases', () => {
      const registry = buildChainRegistry();
      expect(registry['solana']).toBeDefined();
      expect(registry['sol']).toBeDefined();
      expect(registry['solana'].chainKey).toBe('solana');
      expect(registry['solana'].family).toBe('solana');
    });

    it('includes live EVM chains', () => {
      const registry = buildChainRegistry();
      expect(registry['base-sepolia']).toBeDefined();
      expect(registry['ethereum-sepolia']).toBeDefined();
      expect(registry['bsc-testnet']).toBeDefined();
      expect(registry['polygon-amoy']).toBeDefined();
    });

    it('includes non-live EVM chains', () => {
      const registry = buildChainRegistry();
      expect(registry['base-mainnet']).toBeDefined();
      expect(registry['base-mainnet'].isLive).toBe(false);
    });

    it('includes aliases for EVM chains', () => {
      const registry = buildChainRegistry();
      expect(registry['base'].chainKey).toBe('base-sepolia');
      expect(registry['eth'].chainKey).toBe('ethereum-sepolia');
      expect(registry['bnb'].chainKey).toBe('bsc-testnet');
      expect(registry['polygon'].chainKey).toBe('polygon-amoy');
    });
  });

  describe('resolveChain', () => {
    it('resolves exact chain key', () => {
      const result = resolveChain('solana');
      expect(result).not.toBeNull();
      expect(result!.chainKey).toBe('solana');
    });

    it('resolves alias', () => {
      const result = resolveChain('base');
      expect(result).not.toBeNull();
      expect(result!.chainKey).toBe('base-sepolia');
    });

    it('is case-insensitive', () => {
      const result = resolveChain('BASE');
      expect(result).not.toBeNull();
      expect(result!.chainKey).toBe('base-sepolia');
    });

    it('returns null for unknown chain', () => {
      expect(resolveChain('unknown-chain')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(resolveChain('')).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(resolveChain(undefined)).toBeNull();
    });

    it('returns null for path traversal attempt', () => {
      expect(resolveChain('../../etc/passwd')).toBeNull();
    });

    it('returns null for SQL injection-like string', () => {
      expect(resolveChain("'; DROP TABLE users; --")).toBeNull();
    });
  });

  describe('validateChainParameter', () => {
    it('passes for live chain', () => {
      const result = validateChainParameter('solana');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('solana');
    });

    it('passes for live EVM chain', () => {
      const result = validateChainParameter('base-sepolia');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('base-sepolia');
    });

    it('fails for missing chain', () => {
      const result = validateChainParameter(undefined);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('MISSING_CHAIN');
    });

    it('fails for empty chain', () => {
      const result = validateChainParameter('  ');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('MISSING_CHAIN');
    });

    it('fails for unsupported chain', () => {
      const result = validateChainParameter('cardano');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('UNSUPPORTED_CHAIN');
    });

    it('fails for non-live chain by default', () => {
      const result = validateChainParameter('base-mainnet');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('CHAIN_NOT_LIVE');
    });

    it('passes for non-live chain when allowNonLive is true', () => {
      const result = validateChainParameter('base-mainnet', { allowNonLive: true });
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('base-mainnet');
    });

    it('includes supported chains in error message', () => {
      const result = validateChainParameter('fake');
      expect(result.error!.message).toContain('Supported chains:');
      expect(result.error!.message).toContain('solana');
    });
  });

  describe('getSupportedChainKeys', () => {
    it('returns live chain keys only', () => {
      const keys = getSupportedChainKeys();
      expect(keys).toContain('solana');
      expect(keys).toContain('base-sepolia');
      expect(keys).not.toContain('base-mainnet');
    });
  });

  describe('getLiveChainEntries', () => {
    it('returns unique entries for live chains', () => {
      const entries = getLiveChainEntries();
      const keys = entries.map(e => e.chainKey);
      expect(new Set(keys).size).toBe(keys.length);
      expect(entries.some(e => e.chainKey === 'solana')).toBe(true);
      expect(entries.some(e => e.chainKey === 'base-sepolia')).toBe(true);
    });

    it('includes domainId for all entries', () => {
      const entries = getLiveChainEntries();
      for (const entry of entries) {
        expect(typeof entry.domainId).toBe('number');
        expect(entry.domainId).toBeGreaterThan(0);
      }
    });
  });

  describe('createApiError', () => {
    it('creates standard error shape', () => {
      const error = createApiError('TEST_CODE', 'Test message', { foo: 'bar' });
      expect(error.success).toBe(false);
      expect(error.error.code).toBe('TEST_CODE');
      expect(error.error.message).toBe('Test message');
      expect(error.error.details).toEqual({ foo: 'bar' });
    });
  });

  describe('buildQuote', () => {
    it('returns chain-aware quote', () => {
      const entry = resolveChain('base-sepolia')!.entry;
      const quote = buildQuote(BigInt(1000000), 50, entry, {
        solana: 'SolAddr',
        evm: { 'base-sepolia': '0xEvAddr' },
      });

      expect(quote.amount).toBe('1000000');
      expect(quote.relayerFee).toBe('5000');
      expect(quote.feeBps).toBe(50);
      expect(quote.netAmount).toBe('995000');
      expect(quote.feeModel).toBe('flat_bps');
      expect(quote.gasAware).toBe(false);
      expect(quote.gasWarning).toContain('pending');
      expect(quote.chainKey).toBe('base-sepolia');
      expect(quote.chainId).toBe(84532);
      expect(quote.domainId).toBe(33554434);
      expect(quote.assetIdVersion).toBe(2);
      expect(quote.nativeGasToken).toBe('ETH');
    });

    it('returns zero net amount when fee exceeds amount', () => {
      const entry = resolveChain('solana')!.entry;
      const quote = buildQuote(BigInt(100), 10000, entry, {});
      expect(quote.netAmount).toBe('0');
    });
  });

  describe('buildEvmAssetsForChain', () => {
    it('builds assets for chain with native, wrapped, usdc, usdt', () => {
      const entry = resolveChain('ethereum-sepolia')!.entry;
      const assets = buildEvmAssetsForChain('ethereum-sepolia', {
        chainId: 11155111,
        supportedAssets: {
          native: '0x0000000000000000000000000000000000000000',
          wrappedNative: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
          usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          usdt: null,
        },
      }, entry);

      expect(assets).toHaveLength(3);
      expect(assets[0].isNative).toBe(true);
      expect(assets[0].symbol).toBe('ETH');
      expect(assets[1].symbol).toBe('WETH');
      expect(assets[2].symbol).toBe('USDC');
    });

    it('skips wrapped native when null', () => {
      const entry = resolveChain('base-sepolia')!.entry;
      const assets = buildEvmAssetsForChain('base-sepolia', {
        chainId: 84532,
        supportedAssets: {
          native: '0x0000000000000000000000000000000000000000',
          wrappedNative: null as any,
          usdc: null,
          usdt: null,
        },
      }, entry);

      expect(assets).toHaveLength(1);
      expect(assets[0].isNative).toBe(true);
    });
  });
});
