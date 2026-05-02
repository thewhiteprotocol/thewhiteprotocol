/**
 * EVM Merkle Tree State Helpers for Repeatable E2E
 *
 * Reads on-chain tree state from WhiteProtocol and computes
 * correct insertion/withdrawal paths for any startIndex.
 */

import { ethers } from 'ethers';
import { buildPoseidon } from 'circomlibjs';
import { computeZeroValues } from '@thewhiteprotocol/core';

export interface TreeState {
  currentRoot: bigint;
  nextLeafIndex: number;
  filledSubtrees: bigint[];
  zeros: bigint[];
}

export interface MerklePath {
  pathElements: bigint[];
  pathIndices: number[];
}

const TREE_ABI = [
  'function getLastRoot() view returns (uint256)',
  'function nextLeafIndex() view returns (uint256)',
  'function filledSubtrees(uint256) view returns (uint256)',
  'function zeros(uint256) view returns (uint256)',
  'function getPendingDepositsCount() view returns (uint256)',
  'function getPendingDeposit(uint256) view returns (uint256)',
  'event Deposit(uint256 indexed commitment, uint256 amount, address indexed asset, uint256 leafIndex)',
  'event BatchSettlement(uint256 indexed startIndex, uint256 batchSize, uint256 newRoot)',
];

const DEPTH = 20;

/**
 * Read current tree state from on-chain contract.
 */
export async function getTreeState(
  contract: ethers.Contract
): Promise<TreeState> {
  const currentRoot = BigInt((await contract.getLastRoot()).toString());
  const nextLeafIndex = Number((await contract.nextLeafIndex()).toString());

  const filledSubtrees: bigint[] = [];
  const zeros: bigint[] = [];

  for (let i = 0; i < DEPTH; i++) {
    filledSubtrees.push(BigInt((await contract.filledSubtrees(i)).toString()));
    zeros.push(BigInt((await contract.zeros(i)).toString()));
  }

  return { currentRoot, nextLeafIndex, filledSubtrees, zeros };
}

/**
 * Compute zero values locally using Poseidon.
 * Use this to cross-check on-chain zeros.
 */
export async function getLocalZeros(): Promise<bigint[]> {
  await buildPoseidon();
  return computeZeroValues(DEPTH);
}

/**
 * Compute Merkle path for inserting/withdrawing a leaf at `leafIndex`
 * given the current `filledSubtrees` and `zeros`.
 *
 * For each level i:
 *   pathIndex[i] = (leafIndex >> i) & 1
 *   pathElement[i] = pathIndex[i] ? filledSubtrees[i] : zeros[i]
 *
 * This works because:
 * - If leaf is on the right, sibling = filledSubtrees[i] (last left child hash)
 * - If leaf is on the left, sibling = zeros[i] (empty right subtree)
 */
export function computePath(
  leafIndex: number,
  filledSubtrees: bigint[],
  zeros: bigint[]
): MerklePath {
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  for (let i = 0; i < DEPTH; i++) {
    const isRight = (leafIndex >> i) & 1;
    pathIndices.push(isRight);
    pathElements.push(isRight ? filledSubtrees[i] : zeros[i]);
  }

  return { pathElements, pathIndices };
}

/**
 * Compute the Merkle root after inserting `commitment` at `leafIndex`
 * using the given path.
 */
export async function computeRootFromPath(
  commitment: bigint,
  path: MerklePath
): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  let current = commitment;
  for (let i = 0; i < DEPTH; i++) {
    if (path.pathIndices[i] === 0) {
      current = F.toObject(poseidon([F.e(current), F.e(path.pathElements[i])]));
    } else {
      current = F.toObject(poseidon([F.e(path.pathElements[i]), F.e(current)]));
    }
  }

  return current;
}

/**
 * Verify that locally computed root matches on-chain root.
 */
export function verifyRootMatch(
  localRoot: bigint,
  onChainRoot: bigint,
  label: string
): void {
  if (localRoot !== onChainRoot) {
    throw new Error(
      `${label} root mismatch: local=${localRoot.toString()}, onChain=${onChainRoot.toString()}`
    );
  }
}

/**
 * Read all pending deposits from the contract.
 */
export async function getPendingDeposits(
  contract: ethers.Contract
): Promise<bigint[]> {
  const count = Number((await contract.getPendingDepositsCount()).toString());
  const commitments: bigint[] = [];
  for (let i = 0; i < count; i++) {
    commitments.push(BigInt((await contract.getPendingDeposit(i)).toString()));
  }
  return commitments;
}
