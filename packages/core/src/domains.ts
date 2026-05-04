/**
 * Protocol Domain Registry
 *
 * Domain IDs are uint32 values that uniquely identify a network within
 * The White Protocol's multi-chain topology.
 *
 * Structure:
 *   high byte  = chain family (0x01 = Solana, 0x02 = EVM)
 *   low 3 bytes = network ID (sequential per family)
 *
 * Examples:
 *   0x01000002 = Solana Devnet
 *   0x02000002 = Base Sepolia
 *   0x02000007 = Base Mainnet
 */

export enum ChainFamily {
  Solana = 0x01,
  EVM = 0x02,
}

export const ProtocolDomain = {
  // Solana networks
  SOLANA_DEVNET: 0x01000002,

  // EVM testnets
  BASE_SEPOLIA: 0x02000002,
  ETHEREUM_SEPOLIA: 0x02000003,
  POLYGON_AMOY: 0x02000004,
  BSC_TESTNET: 0x02000006,

  // EVM mainnets
  BASE_MAINNET: 0x02000007,
  ETHEREUM_MAINNET: 0x02000008,
  POLYGON_MAINNET: 0x02000009,
  BSC_MAINNET: 0x0200000b,
} as const;

export type ProtocolDomainId = (typeof ProtocolDomain)[keyof typeof ProtocolDomain];

/**
 * Decompose a domain ID into its chain family and network ID.
 */
export function decomposeDomainId(domainId: number): {
  family: ChainFamily;
  networkId: number;
} {
  const family = (domainId >>> 24) as ChainFamily;
  const networkId = domainId & 0x00ffffff;
  return { family, networkId };
}

/**
 * Compose a domain ID from chain family and network ID.
 */
export function composeDomainId(
  family: ChainFamily,
  networkId: number
): number {
  return ((family & 0xff) << 24) | (networkId & 0x00ffffff);
}

/**
 * Encode domain ID as 4-byte big-endian Uint8Array.
 */
export function domainIdToBytes(domainId: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (domainId >>> 24) & 0xff;
  buf[1] = (domainId >>> 16) & 0xff;
  buf[2] = (domainId >>> 8) & 0xff;
  buf[3] = domainId & 0xff;
  return buf;
}

/**
 * Get human-readable name for a domain ID.
 */
export function domainIdToName(domainId: number): string {
  for (const [name, id] of Object.entries(ProtocolDomain)) {
    if (id === domainId) return name;
  }
  const { family, networkId } = decomposeDomainId(domainId);
  const familyName = family === ChainFamily.Solana ? 'Solana' : family === ChainFamily.EVM ? 'EVM' : 'Unknown';
  return `${familyName}-${networkId}`;
}
