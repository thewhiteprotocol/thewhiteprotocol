/**
 * Shared cryptographic utilities for The White Protocol
 * Chain-agnostic hash functions and ZK primitives
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { buildPoseidon, Poseidon } from 'circomlibjs';
import bs58 from 'bs58';

// Poseidon instance (lazy-loaded)
let poseidonInstance: Poseidon | null = null;

/**
 * Initialize Poseidon hash function
 */
export async function initializePoseidon(): Promise<void> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
}

/**
 * Get Poseidon instance (throws if not initialized)
 */
function getPoseidon(): Poseidon {
  if (!poseidonInstance) {
    throw new Error('Poseidon not initialized. Call initializePoseidon() first.');
  }
  return poseidonInstance;
}

/**
 * Poseidon hash of two field elements
 * Returns result as bigint
 */
export function poseidonHash2(a: bigint, b: bigint): bigint {
  const poseidon = getPoseidon();
  const result = poseidon([a, b]);
  return BigInt(poseidon.F.toString(result));
}

/**
 * Poseidon hash of an array of field elements
 */
export function poseidonHash(inputs: bigint[]): bigint {
  const poseidon = getPoseidon();
  const result = poseidon(inputs.map(x => BigInt(x)));
  return BigInt(poseidon.F.toString(result));
}

/**
 * Compute v1 asset ID from token address using Keccak256
 * Matches on-chain formula: 0x00 || keccak256("white:asset_id:v1" || mint)[0..31]
 *
 * @deprecated Use computeAssetIdV2 for new deployments. V1 is preserved for
 *             backward compatibility with existing pools (e.g. Base Sepolia PR-004).
 */
export function computeAssetIdV1(tokenAddress: string | Uint8Array): Uint8Array {
  let mintBytes: Uint8Array;

  if (typeof tokenAddress === 'string') {
    if (tokenAddress.startsWith('0x')) {
      // Base / EVM hex address
      mintBytes = Uint8Array.from(Buffer.from(tokenAddress.slice(2), 'hex'));
    } else if (tokenAddress.length >= 32 && tokenAddress.length <= 44) {
      // Solana base58 address
      mintBytes = bs58.decode(tokenAddress);
    } else {
      // Fallback: treat as hex
      mintBytes = Uint8Array.from(Buffer.from(tokenAddress, 'hex'));
    }
  } else {
    mintBytes = tokenAddress;
  }

  const prefix = new TextEncoder().encode('white:asset_id:v1');
  const input = new Uint8Array(prefix.length + mintBytes.length);
  input.set(prefix, 0);
  input.set(mintBytes, prefix.length);

  const hash = keccak_256(input);
  const out = new Uint8Array(32);
  out[0] = 0;
  out.set(hash.slice(0, 31), 1);
  return out;
}

/**
 * Compute v2 asset ID with protocol-scoped domain separation.
 * Formula: 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || mint)[0..31]
 *
 * Used for all new deployments starting from PR-005B.
 */
export function computeAssetIdV2(
  tokenAddress: string | Uint8Array,
  domainId: number
): Uint8Array {
  let mintBytes: Uint8Array;

  if (typeof tokenAddress === 'string') {
    if (tokenAddress.startsWith('0x')) {
      mintBytes = Uint8Array.from(Buffer.from(tokenAddress.slice(2), 'hex'));
    } else if (tokenAddress.length >= 32 && tokenAddress.length <= 44) {
      mintBytes = bs58.decode(tokenAddress);
    } else {
      mintBytes = Uint8Array.from(Buffer.from(tokenAddress, 'hex'));
    }
  } else {
    mintBytes = tokenAddress;
  }

  const prefix = new TextEncoder().encode('white:asset_id:v2');
  const domainBytes = new Uint8Array(4);
  domainBytes[0] = (domainId >>> 24) & 0xff;
  domainBytes[1] = (domainId >>> 16) & 0xff;
  domainBytes[2] = (domainId >>> 8) & 0xff;
  domainBytes[3] = domainId & 0xff;

  const input = new Uint8Array(prefix.length + domainBytes.length + mintBytes.length);
  input.set(prefix, 0);
  input.set(domainBytes, prefix.length);
  input.set(mintBytes, prefix.length + domainBytes.length);

  const hash = keccak_256(input);
  const out = new Uint8Array(32);
  out[0] = 0;
  out.set(hash.slice(0, 31), 1);
  return out;
}

/**
 * Backward-compatible alias for computeAssetIdV1.
 * Existing code calling computeAssetId() will continue to use the v1 formula.
 *
 * @deprecated Use computeAssetIdV1 explicitly or computeAssetIdV2 for new deployments.
 */
export function computeAssetId(tokenAddress: string | Uint8Array): Uint8Array {
  return computeAssetIdV1(tokenAddress);
}

/**
 * Compute v1 asset ID as bigint.
 * @deprecated Use computeAssetIdV2BigInt for new deployments.
 */
export function computeAssetIdV1BigInt(tokenAddress: string | Uint8Array): bigint {
  const bytes = computeAssetIdV1(tokenAddress);
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

/**
 * Compute v2 asset ID as bigint.
 */
export function computeAssetIdV2BigInt(
  tokenAddress: string | Uint8Array,
  domainId: number
): bigint {
  const bytes = computeAssetIdV2(tokenAddress, domainId);
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

/**
 * Backward-compatible alias for computeAssetIdV1BigInt.
 */
export function computeAssetIdBigInt(tokenAddress: string | Uint8Array): bigint {
  return computeAssetIdV1BigInt(tokenAddress);
}

/**
 * Compute commitment hash: Poseidon(secret, nullifier, amount, assetId)
 */
export function computeCommitment(
  secret: bigint,
  nullifier: bigint,
  amount: bigint,
  assetId: bigint
): bigint {
  return poseidonHash([secret, nullifier, amount, assetId]);
}

/**
 * Compute nullifier hash: Poseidon(nullifier, secret, leafIndex)
 */
export function computeNullifierHash(
  nullifier: bigint,
  secret: bigint,
  leafIndex: bigint | number
): bigint {
  // Circuit: nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
  const inner = poseidonHash([nullifier, secret]);
  return poseidonHash([inner, BigInt(leafIndex)]);
}

/**
 * Convert public key to scalar field element
 * Used for recipient/relayer addresses in circuits
 */
export function pubkeyToScalar(pubkey: string | Uint8Array): bigint {
  let bytes: Uint8Array;
  
  if (typeof pubkey === 'string') {
    if (pubkey.startsWith('0x')) {
      bytes = Uint8Array.from(Buffer.from(pubkey.slice(2), 'hex'));
    } else {
      // Solana base58 pubkey
      bytes = bs58.decode(pubkey);
    }
  } else {
    bytes = pubkey;
  }
  
  // Match on-chain: scalar_bytes = [0x00, pubkey_bytes[0..31]]
  const scalarBytes = new Uint8Array(32);
  scalarBytes[0] = 0;
  scalarBytes.set(bytes.slice(0, 31), 1);
  return BigInt('0x' + Buffer.from(scalarBytes).toString('hex'));
}

/**
 * Generate random field element (safe for secrets/nullifiers)
 */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(31); // 31 bytes = 248 bits < 254 bits
  crypto.getRandomValues(bytes);
  
  let result = 0n;
  for (let i = 0; i < 31; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

/**
 * Convert bigint to 32-byte Uint8Array (big-endian)
 */
export function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Convert 32-byte Uint8Array to bigint
 */
export function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

/**
 * Compute Merkle root from leaf and path
 */
export function computeMerkleRoot(
  leaf: bigint,
  pathElements: bigint[],
  pathIndices: number[]
): bigint {
  let current = leaf;
  for (let i = 0; i < pathElements.length; i++) {
    if (pathIndices[i] === 0) {
      // Current is left
      current = poseidonHash2(current, pathElements[i]);
    } else {
      // Current is right
      current = poseidonHash2(pathElements[i], current);
    }
  }
  return current;
}

/**
 * Compute zero values for Merkle tree levels
 * Returns array of zero hashes for each level
 */
export function computeZeroValues(depth: number): bigint[] {
  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= depth; i++) {
    zeros.push(poseidonHash2(zeros[i - 1], zeros[i - 1]));
  }
  return zeros;
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(
  leaf: bigint,
  root: bigint,
  pathElements: bigint[],
  pathIndices: number[]
): boolean {
  const computedRoot = computeMerkleRoot(leaf, pathElements, pathIndices);
  return computedRoot === root;
}

/**
 * Format proof for on-chain submission (256 bytes for Groth16)
 * @param proof snarkjs proof object
 * @param chain 'solana' or 'base'/'evm' — G2 point ordering differs between chains
 */
export function formatProofForOnChain(proof: any, chain: 'solana' | 'base' | 'evm' = 'solana'): Uint8Array {
  const proofData = new Uint8Array(256);
  const isEvm = chain === 'base' || chain === 'evm';

  const toHex32 = (val: string | bigint) => BigInt(val).toString(16).padStart(64, '0');

  // pi_a (G1 point): x, y (64 bytes) — same on both chains
  const ax = Uint8Array.from(Buffer.from(toHex32(proof.pi_a[0]), 'hex'));
  const ay = Uint8Array.from(Buffer.from(toHex32(proof.pi_a[1]), 'hex'));
  proofData.set(ax, 0);
  proofData.set(ay, 32);

  // pi_b (G2 point): ordering differs between Solana and EVM
  // snarkjs: pi_b[0][0]=x_real, pi_b[0][1]=x_imag, pi_b[1][0]=y_real, pi_b[1][1]=y_imag
  // Solana alt_bn128: x_imag | x_real | y_imag | y_real
  // EVM EIP-197:       x_real | x_imag | y_real | y_imag
  const xReal = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[0][0]), 'hex'));
  const xImag = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[0][1]), 'hex'));
  const yReal = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[1][0]), 'hex'));
  const yImag = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[1][1]), 'hex'));

  if (isEvm) {
    proofData.set(xReal, 64);
    proofData.set(xImag, 96);
    proofData.set(yReal, 128);
    proofData.set(yImag, 160);
  } else {
    proofData.set(xImag, 64);
    proofData.set(xReal, 96);
    proofData.set(yImag, 128);
    proofData.set(yReal, 160);
  }

  // pi_c (G1 point): x, y (64 bytes) — same on both chains
  const cx = Uint8Array.from(Buffer.from(toHex32(proof.pi_c[0]), 'hex'));
  const cy = Uint8Array.from(Buffer.from(toHex32(proof.pi_c[1]), 'hex'));
  proofData.set(cx, 192);
  proofData.set(cy, 224);

  return proofData;
}

/**
 * Parse on-chain proof data back to snarkjs format
 * @param chain 'solana' or 'base'/'evm' — G2 point ordering differs between chains
 */
export function parseProofFromOnChain(proofData: Uint8Array, chain: 'solana' | 'base' | 'evm' = 'solana'): any {
  if (proofData.length !== 256) {
    throw new Error('Invalid proof data length. Expected 256 bytes.');
  }
  
  const readField = (offset: number) => {
    return BigInt('0x' + Buffer.from(proofData.slice(offset, offset + 32)).toString('hex'));
  };
  
  const isEvm = chain === 'base' || chain === 'evm';
  
  // Solana storage order: x_imag(64), x_real(96), y_imag(128), y_real(160)
  // EVM storage order:    x_real(64), x_imag(96), y_real(128), y_imag(160)
  // snarkjs format:       pi_b[0]=[x_real, x_imag], pi_b[1]=[y_real, y_imag]
  if (isEvm) {
    return {
      pi_a: [readField(0), readField(32)],
      pi_b: [
        [readField(64), readField(96)],
        [readField(128), readField(160)],
      ],
      pi_c: [readField(192), readField(224)],
    };
  }
  
  return {
    pi_a: [readField(0), readField(32)],
    pi_b: [
      [readField(96), readField(64)],  // Reversed from Solana storage order
      [readField(160), readField(128)],
    ],
    pi_c: [readField(192), readField(224)],
  };
}
