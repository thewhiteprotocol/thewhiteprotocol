import {
  getRpcUrl,
  getDeployerPrivateKey,
  validateConfig,
  loadNetwork,
} from '../config';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getRpcUrl', () => {
    it('returns canonical env var when present', () => {
      process.env.BASE_SEPOLIA_RPC_URL = 'https://base.example.com';
      const url = getRpcUrl('base-sepolia');
      expect(url).toBe('https://base.example.com');
    });

    it('falls back to deprecated alias with warning', () => {
      delete process.env.BASE_SEPOLIA_RPC_URL;
      process.env.BASE_RPC_URL = 'https://base-legacy.example.com';
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const url = getRpcUrl('base-sepolia');
      expect(url).toBe('https://base-legacy.example.com');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('throws when canonical and aliases are missing', () => {
      delete process.env.BASE_SEPOLIA_RPC_URL;
      delete process.env.BASE_RPC_URL;
      expect(() => getRpcUrl('base-sepolia')).toThrow('Missing RPC URL');
    });
  });

  describe('getDeployerPrivateKey', () => {
    it('returns per-chain key when present', () => {
      process.env.BASE_DEPLOYER_PRIVATE_KEY = '0xabc123';
      const key = getDeployerPrivateKey('base-sepolia');
      expect(key).toBe('0xabc123');
    });

    it('returns canonical per-chain key over legacy alias', () => {
      process.env.BASE_DEPLOYER_PRIVATE_KEY = '0xcanonical';
      process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY = '0xsep';
      const key = getDeployerPrivateKey('base-sepolia');
      expect(key).toBe('0xcanonical');
    });

    it('falls back to EVM_DEPLOYER_PRIVATE_KEY', () => {
      delete process.env.BASE_DEPLOYER_PRIVATE_KEY;
      delete process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY;
      process.env.EVM_DEPLOYER_PRIVATE_KEY = '0xshared';
      const key = getDeployerPrivateKey('base-sepolia');
      expect(key).toBe('0xshared');
    });

    it('returns undefined when no key is set', () => {
      delete process.env.BASE_DEPLOYER_PRIVATE_KEY;
      delete process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY;
      delete process.env.EVM_DEPLOYER_PRIVATE_KEY;
      const key = getDeployerPrivateKey('base-sepolia');
      expect(key).toBeUndefined();
    });
  });

  describe('loadNetwork', () => {
    it('loads base-sepolia config', () => {
      const net = loadNetwork('base-sepolia');
      expect(net.chainId).toBe(84532);
      expect(net.isLive).toBe(true);
      expect(net.rpcUrlEnvVar).toBe('BASE_SEPOLIA_RPC_URL');
    });

    it('throws for unknown network', () => {
      expect(() => loadNetwork('nonexistent-chain')).toThrow('Unknown network');
    });
  });

  describe('validateConfig', () => {
    it('reports missing RPC URLs when env vars are absent', () => {
      delete process.env.BASE_SEPOLIA_RPC_URL;
      delete process.env.BASE_RPC_URL;
      delete process.env.ETHEREUM_SEPOLIA_RPC_URL;
      delete process.env.ETH_RPC_URL;
      delete process.env.BSC_TESTNET_RPC_URL;
      delete process.env.BSC_RPC_URL;
      delete process.env.POLYGON_AMOY_RPC_URL;

      const result = validateConfig();
      expect(result.ok).toBe(false);
      expect(result.errors.some(e => e.includes('BASE_SEPOLIA_RPC_URL'))).toBe(true);
      expect(result.errors.some(e => e.includes('ETHEREUM_SEPOLIA_RPC_URL'))).toBe(true);
      expect(result.errors.some(e => e.includes('BSC_TESTNET_RPC_URL'))).toBe(true);
      expect(result.errors.some(e => e.includes('POLYGON_AMOY_RPC_URL'))).toBe(true);
    });

    it('does not print secret values in errors', () => {
      process.env.BASE_SEPOLIA_RPC_URL = 'https://base.example.com';
      process.env.ETHEREUM_SEPOLIA_RPC_URL = 'https://eth.example.com';
      process.env.BSC_TESTNET_RPC_URL = 'https://bsc.example.com';
      process.env.POLYGON_AMOY_RPC_URL = 'https://polygon.example.com';
      process.env.BASE_DEPLOYER_PRIVATE_KEY = 'super_secret_key_123';

      const result = validateConfig();
      const allMessages = [...result.errors, ...result.warnings].join(' ');
      expect(allMessages).not.toContain('super_secret_key_123');
    });

    it('warns when deployer keys are missing', () => {
      delete process.env.BASE_DEPLOYER_PRIVATE_KEY;
      delete process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY;
      delete process.env.EVM_DEPLOYER_PRIVATE_KEY;

      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('No deployer private key'))).toBe(true);
    });
  });
});
