"use client";

import { keccak_256 } from "@noble/hashes/sha3.js";
import { buildPoseidon } from "circomlibjs";

let poseidonInstance: any = null;

export async function initializePoseidon(): Promise<void> {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
}

function getPoseidon(): any {
  if (!poseidonInstance) {
    throw new Error("Poseidon not initialized. Call initializePoseidon() first.");
  }
  return poseidonInstance;
}

export function poseidonHash2(a: bigint, b: bigint): bigint {
  const poseidon = getPoseidon();
  const result = poseidon([a, b]);
  return BigInt(poseidon.F.toString(result));
}

export function poseidonHash(inputs: bigint[]): bigint {
  const poseidon = getPoseidon();
  const result = poseidon(inputs.map((x) => BigInt(x)));
  return BigInt(poseidon.F.toString(result));
}

export function computeAssetId(tokenAddress: string | Uint8Array): Uint8Array {
  let input: Uint8Array;
  if (typeof tokenAddress === "string") {
    if (tokenAddress.startsWith("0x")) {
      input = Uint8Array.from(Buffer.from(tokenAddress.slice(2), "hex"));
    } else {
      input = Uint8Array.from(Buffer.from(tokenAddress, "hex"));
    }
  } else {
    input = tokenAddress;
  }
  return keccak_256(input);
}

export function computeAssetIdBigInt(tokenAddress: string | Uint8Array): bigint {
  const bytes = computeAssetId(tokenAddress);
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

export function computeCommitment(
  secret: bigint,
  nullifier: bigint,
  amount: bigint,
  assetId: bigint
): bigint {
  return poseidonHash([secret, nullifier, amount, assetId]);
}

export function computeNullifierHash(
  nullifier: bigint,
  secret: bigint,
  leafIndex: bigint | number
): bigint {
  return poseidonHash([nullifier, secret, BigInt(leafIndex)]);
}

export function pubkeyToScalar(pubkey: string | Uint8Array): bigint {
  let bytes: Uint8Array;
  if (typeof pubkey === "string") {
    if (pubkey.startsWith("0x")) {
      bytes = Uint8Array.from(Buffer.from(pubkey.slice(2), "hex"));
    } else {
      bytes = keccak_256(new TextEncoder().encode(pubkey));
    }
  } else {
    bytes = pubkey;
  }
  const fieldBytes = bytes.slice(0, 31);
  return BigInt("0x" + Buffer.from(fieldBytes).toString("hex"));
}

export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (let i = 0; i < 31; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

export function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

export function computeMerkleRoot(
  leaf: bigint,
  pathElements: bigint[],
  pathIndices: number[]
): bigint {
  let current = leaf;
  for (let i = 0; i < pathElements.length; i++) {
    if (pathIndices[i] === 0) {
      current = poseidonHash2(current, pathElements[i]);
    } else {
      current = poseidonHash2(pathElements[i], current);
    }
  }
  return current;
}

export function formatProofForOnChain(proof: any): Uint8Array {
  const proofData = new Uint8Array(256);
  const toHex32 = (val: string | bigint) => BigInt(val).toString(16).padStart(64, "0");
  const ax = Uint8Array.from(Buffer.from(toHex32(proof.pi_a[0]), "hex"));
  const ay = Uint8Array.from(Buffer.from(toHex32(proof.pi_a[1]), "hex"));
  proofData.set(ax, 0);
  proofData.set(ay, 32);
  const bx01 = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[0][1]), "hex"));
  const bx00 = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[0][0]), "hex"));
  const bx11 = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[1][1]), "hex"));
  const bx10 = Uint8Array.from(Buffer.from(toHex32(proof.pi_b[1][0]), "hex"));
  proofData.set(bx01, 64);
  proofData.set(bx00, 96);
  proofData.set(bx11, 128);
  proofData.set(bx10, 160);
  const cx = Uint8Array.from(Buffer.from(toHex32(proof.pi_c[0]), "hex"));
  const cy = Uint8Array.from(Buffer.from(toHex32(proof.pi_c[1]), "hex"));
  proofData.set(cx, 192);
  proofData.set(cy, 224);
  return proofData;
}

export const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);
export const MERKLE_TREE_DEPTH = 20;
export const DEFAULT_RELAYER_FEE_BPS = 50;
