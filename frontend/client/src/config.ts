export const DEVNET_CONFIG = {
  PROGRAM_ID: 'DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk',
  POOL_CONFIG: '5tiLj9YYhsc28h1JVVBBeUmUKmwTEUEnzn7q86NNso6q',
  MERKLE_TREE: '3Zo9P2p8582y9mTbP49TUC7hk8aDDo5Sz3fYQBDFkFhc',
  PENDING_BUFFER: '4A63xarGARyQyq5C37kHQcZEixeoyKhkqEoocGGEkjxh',
  RPC_URL: 'https://api.devnet.solana.com',
  RELAYER_ENDPOINT: import.meta.env.VITE_RELAYER_API_URL || 'https://relayer.thewhiteprotocol.com',
  NATIVE_SOL_ASSET_ID: BigInt(0),
  NETWORK: 'Solana Devnet',
  EXPLORER_URL: 'https://explorer.solana.com/address/DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk?cluster=devnet',
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
