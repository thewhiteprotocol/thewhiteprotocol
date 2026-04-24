export const DEVNET_CONFIG = {
  PROGRAM_ID: 'C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW',
  POOL_CONFIG: 'EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS',
  MERKLE_TREE: '2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD',
  PENDING_BUFFER: '7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw',
  RPC_URL: 'https://api.devnet.solana.com',
  RELAYER_ENDPOINT: import.meta.env.VITE_RELAYER_API_URL || 'https://relayer.thewhiteprotocol.com',
  NATIVE_SOL_ASSET_ID: BigInt(0),
  NETWORK: 'Solana Devnet',
  EXPLORER_URL: 'https://explorer.solana.com/address/C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW?cluster=devnet',
  TREE_DEPTH: 20,
} as const;

export const {
  PROGRAM_ID,
  POOL_CONFIG,
  MERKLE_TREE,
  PENDING_BUFFER,
  RPC_URL,
  RELAYER_ENDPOINT,
  NATIVE_SOL_ASSET_ID,
  NETWORK,
  EXPLORER_URL,
  TREE_DEPTH,
} = DEVNET_CONFIG;
