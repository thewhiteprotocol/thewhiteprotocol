/**
 * Non-secret Base Sepolia -> Solana Devnet route metadata for PR-010V.
 *
 * Amount semantics:
 * - Source BridgeOut amount is Base-local wei.
 * - Destination BridgeMint amount is Solana-local lamports.
 * - Conversion uses exact decimal normalization only.
 */

import type { BridgeRouteAssetConfig, BridgeRouteConfig } from './types';

export const BASE_SEPOLIA_DOMAIN = 0x02000002;
export const SOLANA_DEVNET_DOMAIN = 0x01000002;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const SOLANA_CHAIN_ID = 0;

export const BASE_SEPOLIA_ETH_DECIMALS = 18;
export const SOLANA_DEVNET_WSOL_DECIMALS = 9;

export const BASE_SEPOLIA_ETH_ASSET_ID =
  '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70';

export const SOLANA_DEVNET_WSOL_ASSET_ID =
  '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0';

export const BASE_TO_SOLANA_MAX_MESSAGE_AMOUNT = 10_000_000_000_000n;
export const BASE_TO_SOLANA_DAILY_CAP = 100_000_000_000_000n;

export const BASE_SEPOLIA_TO_SOLANA_DEVNET_WSOL_ASSET: BridgeRouteAssetConfig = {
  canonicalAssetId: BASE_SEPOLIA_ETH_ASSET_ID,
  sourceDecimals: BASE_SEPOLIA_ETH_DECIMALS,
  destinationDecimals: SOLANA_DEVNET_WSOL_DECIMALS,
  normalizationMode: 'exact-decimal',
  maxMessageAmount: BASE_TO_SOLANA_MAX_MESSAGE_AMOUNT,
  dailyCap: BASE_TO_SOLANA_DAILY_CAP,
  capAmountUnits: 'destination',
};

export const BASE_SEPOLIA_TO_SOLANA_DEVNET_ROUTE: BridgeRouteConfig = {
  source: 'base-sepolia',
  destination: 'solana-devnet',
  enabled: true,
  status: 'test-only',
  signerSetVersion: 1,
  assets: [BASE_SEPOLIA_TO_SOLANA_DEVNET_WSOL_ASSET],
};
