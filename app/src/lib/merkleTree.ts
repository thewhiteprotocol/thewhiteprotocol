"use client";

import { initializePoseidon, poseidonHash2 } from "./crypto";

// Hardcoded zero values from MerkleTreeWithHistory.sol
const ZERO_VALUES: bigint[] = [
  0n,
  BigInt("0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864"),
  BigInt("0x1069673dcdb12263df301a6ff584a7ec261a44cb9dc68df067a4774460b1f1e1"),
  BigInt("0x18f43331537ee2af2e3d758d50f72106467c6eea50371dd528d57eb2b856d238"),
  BigInt("0x07f9d837cb17b0d36320ffe93ba52345f1b728571a568265caac97559dbc952a"),
  BigInt("0x2b94cf5e8746b3f5c9631f4c5df32907a699c58c94b2ad4d7b5cec1639183f55"),
  BigInt("0x2dee93c5a666459646ea7d22cca9e1bcfed71e6951b953611d11dda32ea09d78"),
  BigInt("0x078295e5a22b84e982cf601eb639597b8b0515a88cb5ac7fa8a4aabe3c87349d"),
  BigInt("0x2fa5e5f18f6027a6501bec864564472a616b2e274a41211a444cbe3a99f3cc61"),
  BigInt("0x0e884376d0d8fd21ecb780389e941f66e45e7acce3e228ab3e2156a614fcd747"),
  BigInt("0x1b7201da72494f1e28717ad1a52eb469f95892f957713533de6175e5da190af2"),
  BigInt("0x1f8d8822725e36385200c0b201249819a6e6e1e4650808b5bebc6bface7d7636"),
  BigInt("0x2c5d82f66c914bafb9701589ba8cfcfb6162b0a12acf88a8d0879a0471b5f85a"),
  BigInt("0x14c54148a0940bb820957f5adf3fa1134ef5c4aaa113f4646458f270e0bfbfd0"),
  BigInt("0x190d33b12f986f961e10c0ee44d8b9af11be25588cad89d416118e4bf4ebe80c"),
  BigInt("0x22f98aa9ce704152ac17354914ad73ed1167ae6596af510aa5b3649325e06c92"),
  BigInt("0x2a7c7c9b6ce5880b9f6f228d72bf6a575a526f29c66ecceef8b753d38bba7323"),
  BigInt("0x2e8186e558698ec1c67af9c14d463ffc470043c9c2988b954d75dd643f36b992"),
  BigInt("0x0f57c5571e9a4eab49e2c8cf050dae948aef6ead647392273546249d1c1ff10f"),
  BigInt("0x1830ee67b5fb554ad5f63d4388800e1cfe78e310697d46e43c9ce36134f72cca"),
  BigInt("0x2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e"),
];

export class IncrementalMerkleTree {
  depth: number;
  private leaves: bigint[] = [];
  private initialized = false;
  private cachedRoot: bigint | null = null;
  private cachedLevels: bigint[][] | null = null;
  private cachedPaths = new Map<number, { pathElements: bigint[]; pathIndices: number[] }>();

  constructor(depth: number = 20) {
    this.depth = depth;
  }

  async init() {
    if (!this.initialized) {
      await initializePoseidon();
      this.initialized = true;
    }
  }

  insert(leaf: bigint) {
    if (!this.initialized) {
      throw new Error("Tree not initialized. Call init() first.");
    }
    this.leaves.push(leaf);
    this.invalidateCache();
  }

  private invalidateCache() {
    this.cachedRoot = null;
    this.cachedLevels = null;
    this.cachedPaths.clear();
  }

  private computeLevels(): bigint[][] {
    if (this.cachedLevels) {
      return this.cachedLevels;
    }
    const levels: bigint[][] = [[...this.leaves]];
    for (let i = 0; i < this.depth; i++) {
      const nextLevel: bigint[] = [];
      for (let j = 0; j < levels[i].length; j += 2) {
        const left = levels[i][j];
        const right = j + 1 < levels[i].length ? levels[i][j + 1] : ZERO_VALUES[i];
        nextLevel.push(poseidonHash2(left, right));
      }
      levels.push(nextLevel);
    }
    this.cachedLevels = levels;
    return levels;
  }

  getRoot(): bigint {
    if (!this.initialized) {
      throw new Error("Tree not initialized. Call init() first.");
    }
    if (this.cachedRoot !== null) {
      return this.cachedRoot;
    }
    if (this.leaves.length === 0) {
      this.cachedRoot = ZERO_VALUES[this.depth];
      return this.cachedRoot;
    }
    const levels = this.computeLevels();
    this.cachedRoot = levels[this.depth][0];
    return this.cachedRoot;
  }

  getPath(leafIndex: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (!this.initialized) {
      throw new Error("Tree not initialized. Call init() first.");
    }
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds`);
    }
    if (this.cachedPaths.has(leafIndex)) {
      return this.cachedPaths.get(leafIndex)!;
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    const levels = this.computeLevels();
    let currentIndex = leafIndex;

    for (let i = 0; i < this.depth; i++) {
      const isRight = currentIndex % 2 === 1;
      pathIndices.push(isRight ? 1 : 0);

      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      const sibling = siblingIndex < levels[i].length ? levels[i][siblingIndex] : ZERO_VALUES[i];
      pathElements.push(sibling);

      currentIndex = Math.floor(currentIndex / 2);
    }

    const result = { pathElements, pathIndices };
    this.cachedPaths.set(leafIndex, result);
    return result;
  }

  getLeafCount(): number {
    return this.leaves.length;
  }
}

export function getZeroValue(level: number): bigint {
  return ZERO_VALUES[level];
}
