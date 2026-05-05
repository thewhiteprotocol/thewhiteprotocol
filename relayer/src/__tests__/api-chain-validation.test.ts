import {
  validateChainParameter,
  resolveChain,
  buildQuote,
  createApiError,
} from '../chain-registry';

describe('API chain validation', () => {
  describe('withdrawal chain validation', () => {
    it('rejects missing chain', () => {
      const result = validateChainParameter(undefined);
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('MISSING_CHAIN');
    });

    it('rejects unknown chain', () => {
      const result = validateChainParameter('cardano');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('UNSUPPORTED_CHAIN');
    });

    it('rejects non-live chain', () => {
      const result = validateChainParameter('base-mainnet');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('CHAIN_NOT_LIVE');
    });

    it('accepts solana', () => {
      const result = validateChainParameter('solana');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('solana');
      expect(result.entry!.family).toBe('solana');
    });

    it('accepts base-sepolia', () => {
      const result = validateChainParameter('base-sepolia');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('base-sepolia');
      expect(result.entry!.family).toBe('evm');
    });

    it('normalizes alias base -> base-sepolia', () => {
      const result = validateChainParameter('base');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('base-sepolia');
    });

    it('normalizes alias eth -> ethereum-sepolia', () => {
      const result = validateChainParameter('eth');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('ethereum-sepolia');
    });

    it('normalizes alias bnb -> bsc-testnet', () => {
      const result = validateChainParameter('bnb');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('bsc-testnet');
    });

    it('normalizes alias polygon -> polygon-amoy', () => {
      const result = validateChainParameter('polygon');
      expect(result.ok).toBe(true);
      expect(result.chainKey).toBe('polygon-amoy');
    });

    it('rejects path traversal chain value', () => {
      const result = validateChainParameter('../../../etc/passwd');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('UNSUPPORTED_CHAIN');
    });

    it('rejects empty chain string', () => {
      const result = validateChainParameter('');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('MISSING_CHAIN');
    });

    it('rejects whitespace-only chain', () => {
      const result = validateChainParameter('   ');
      expect(result.ok).toBe(false);
      expect(result.error!.code).toBe('MISSING_CHAIN');
    });
  });

  describe('quote chain validation', () => {
    it('includes chain metadata in quote', () => {
      const entry = resolveChain('ethereum-sepolia')!.entry;
      const quote = buildQuote(BigInt(1000000), 50, entry, {});

      expect(quote.chainKey).toBe('ethereum-sepolia');
      expect(quote.chainId).toBe(11155111);
      expect(quote.domainId).toBe(33554435);
      expect(quote.assetIdVersion).toBe(2);
      expect(quote.nativeGasToken).toBe('ETH');
    });

    it('includes Base metadata in quote', () => {
      const entry = resolveChain('base-sepolia')!.entry;
      const quote = buildQuote(BigInt(500000), 25, entry, {});

      expect(quote.chainKey).toBe('base-sepolia');
      expect(quote.chainId).toBe(84532);
      expect(quote.domainId).toBe(33554434);
      expect(quote.assetIdVersion).toBe(2);
    });

    it('includes BNB metadata in quote', () => {
      const entry = resolveChain('bsc-testnet')!.entry;
      const quote = buildQuote(BigInt(500000), 25, entry, {});

      expect(quote.chainKey).toBe('bsc-testnet');
      expect(quote.chainId).toBe(97);
      expect(quote.domainId).toBe(33554438);
    });

    it('includes Polygon metadata in quote', () => {
      const entry = resolveChain('polygon-amoy')!.entry;
      const quote = buildQuote(BigInt(500000), 25, entry, {});

      expect(quote.chainKey).toBe('polygon-amoy');
      expect(quote.chainId).toBe(80002);
      expect(quote.domainId).toBe(33554436);
    });

    it('includes Solana metadata in quote', () => {
      const entry = resolveChain('solana')!.entry;
      const quote = buildQuote(BigInt(500000), 25, entry, {});

      expect(quote.chainKey).toBe('solana');
      expect(quote.chainId).toBeUndefined();
      expect(quote.domainId).toBe(33554433);
      expect(quote.assetIdVersion).toBe(1);
    });

    it('is honest about gas-awareness', () => {
      const entry = resolveChain('base-sepolia')!.entry;
      const quote = buildQuote(BigInt(1000000), 50, entry, {});

      expect(quote.gasAware).toBe(false);
      expect(quote.gasWarning).toContain('pending');
      expect(quote.feeModel).toBe('flat_bps');
    });

    it('does not expose secrets in quote', () => {
      const entry = resolveChain('base-sepolia')!.entry;
      const quote = buildQuote(BigInt(1000000), 50, entry, {
        solana: 'SolAddr123',
        evm: { 'base-sepolia': '0xEvAddr456' },
      });

      const quoteStr = JSON.stringify(quote);
      expect(quoteStr).not.toContain('private_key');
      expect(quoteStr).not.toContain('secret');
      expect(quoteStr).not.toContain('rpc');
    });
  });

  describe('error response standardization', () => {
    it('createApiError returns consistent shape', () => {
      const error = createApiError('UNSUPPORTED_CHAIN', 'Chain not supported');
      expect(error).toEqual({
        success: false,
        error: {
          code: 'UNSUPPORTED_CHAIN',
          message: 'Chain not supported',
          details: undefined,
        },
      });
    });

    it('createApiError includes details when provided', () => {
      const error = createApiError('MISSING_CHAIN', 'Missing chain', { supportedChains: ['a', 'b'] });
      expect(error.error.details).toEqual({ supportedChains: ['a', 'b'] });
    });
  });
});
