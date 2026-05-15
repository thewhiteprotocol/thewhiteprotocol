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

export const SOLANA_DEVNET_PROGRAM_ID =
  'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD';
export const SOLANA_DEVNET_BRIDGE_V1_CONFIG =
  '5ZiC1A8NTS1pc1Rp1mQEnPERzJA1viJZYqW7MX9QhH9s';
export const SOLANA_DEVNET_SIGNER_SET_VERSION = 2;
export const SOLANA_DEVNET_SIGNER_SET_V2 =
  '7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK';
export const SOLANA_DEVNET_BASE_ROUTE_CONFIG =
  'Bp6dhddL1pRRacMYGfKqFyN6azEujbphzH8xmnpKzEWt';
export const SOLANA_DEVNET_WSOL_BRIDGE_ASSET_CONFIG =
  'CByfLtYcZcVWJoihhzTaKGeVEbqL9b9b1qgVdNLHEpdV';
export const SOLANA_DEVNET_POOL_CONFIG =
  'DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF';
export const SOLANA_DEVNET_MERKLE_TREE =
  '7rNj4NVMyaNFSL9ius2hej2rpzk88d7spXrbYFchhnPi';
export const SOLANA_DEVNET_PENDING_BUFFER =
  '9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s';
export const SOLANA_DEVNET_ASSET_VAULT =
  '4Wb17Qbxm74i4BNLZ6CejXtaijLFRSre5wWKAzwWkaXD';

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
  signerSetVersion: SOLANA_DEVNET_SIGNER_SET_VERSION,
  assets: [BASE_SEPOLIA_TO_SOLANA_DEVNET_WSOL_ASSET],
  solanaDestination: {
    programId: SOLANA_DEVNET_PROGRAM_ID,
    bridgeV1Config: SOLANA_DEVNET_BRIDGE_V1_CONFIG,
    signerSetVersion: SOLANA_DEVNET_SIGNER_SET_VERSION,
    signerSetPda: SOLANA_DEVNET_SIGNER_SET_V2,
    routeConfig: SOLANA_DEVNET_BASE_ROUTE_CONFIG,
    assetConfig: SOLANA_DEVNET_WSOL_BRIDGE_ASSET_CONFIG,
    poolConfig: SOLANA_DEVNET_POOL_CONFIG,
    merkleTree: SOLANA_DEVNET_MERKLE_TREE,
    pendingBuffer: SOLANA_DEVNET_PENDING_BUFFER,
    assetVault: SOLANA_DEVNET_ASSET_VAULT,
  },
};
