// Asset configuration for The White Protocol v2
export const SUPPORTED_ASSETS = [
  {
    symbol: 'SOL',
    displayName: 'SOL',
    name: 'Solana',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    isNative: true,
    icon: '/wSOL-logo.png',
  },
  // USDC disabled - vault not registered on-chain
  // {
  //   symbol: 'USDC',
  //   displayName: 'USDC',
  //   name: 'USD Coin',
  //   mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  //   decimals: 6,
  //   isNative: false,
  //   icon: '/usdc-logo.jpg',
  // },
] as const;

export type SupportedAsset = typeof SUPPORTED_ASSETS[number];
export type AssetSymbol = SupportedAsset['symbol'];

export function getAssetBySymbol(symbol: AssetSymbol): SupportedAsset {
  const asset = SUPPORTED_ASSETS.find(a => a.symbol === symbol);
  if (!asset) throw new Error(`Unknown asset: ${symbol}`);
  return asset;
}

export function getAssetByMint(mint: string): SupportedAsset | undefined {
  return SUPPORTED_ASSETS.find(a => a.mint === mint);
}

export function formatTokenAmount(amount: string | bigint, decimals: number): string {
  const val = typeof amount === 'string' ? BigInt(amount) : amount;
  const divisor = BigInt(10 ** decimals);
  const whole = val / divisor;
  const frac = val % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 4);
  return `${whole}.${fracStr}`;
}

export function parseTokenAmount(amountStr: string, decimals: number): string {
  const trimmed = amountStr.trim();
  if (!trimmed || !/^\d*\.?\d+$/.test(trimmed)) throw new Error('Invalid amount');
  const [whole, decimal = ''] = trimmed.split('.');
  const paddedDecimal = decimal.padEnd(decimals, '0').slice(0, decimals);
  const baseUnits = (whole || '0') + paddedDecimal;
  return baseUnits.replace(/^0+/, '') || '0';
}
