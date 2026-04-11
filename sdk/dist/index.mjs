import {
  FIELD_MODULUS,
  __require,
  bigIntToBytes,
  bigIntToFieldBytes,
  bytesToBigInt,
  computeCommitment,
  computeNullifierHash,
  fieldMod,
  hashFour,
  hashTwo,
  initPoseidon,
  isValidFieldElement,
  randomFieldElement
} from "./chunk-KGIHADTE.mjs";

// src/note/note.ts
async function createNote(amount, assetId) {
  await initPoseidon();
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();
  const commitment = computeCommitment(secret, nullifier, amount, assetId);
  return {
    secret,
    nullifier,
    amount,
    assetId,
    commitment
  };
}
async function createNoteFromParams(secret, nullifier, amount, assetId, leafIndex, merkleRoot) {
  await initPoseidon();
  const commitment = computeCommitment(secret, nullifier, amount, assetId);
  return {
    secret,
    nullifier,
    amount,
    assetId,
    commitment,
    leafIndex,
    merkleRoot
  };
}
async function computeNoteNullifier(note) {
  if (note.leafIndex === void 0) {
    throw new Error("Note must have leafIndex set to compute nullifier hash");
  }
  await initPoseidon();
  const nullifierHash = computeNullifierHash(
    note.nullifier,
    note.secret,
    BigInt(note.leafIndex)
  );
  return {
    ...note,
    nullifierHash
  };
}
function serializeNote(note) {
  return {
    secret: note.secret.toString(),
    nullifier: note.nullifier.toString(),
    amount: note.amount.toString(),
    assetId: note.assetId.toString(),
    commitment: note.commitment.toString(),
    leafIndex: note.leafIndex,
    merkleRoot: note.merkleRoot?.toString(),
    depositTimestamp: note.depositTimestamp,
    depositSignature: note.depositSignature
  };
}
function deserializeNote(data) {
  return {
    secret: BigInt(data.secret),
    nullifier: BigInt(data.nullifier),
    amount: BigInt(data.amount),
    assetId: BigInt(data.assetId),
    commitment: BigInt(data.commitment),
    leafIndex: data.leafIndex,
    merkleRoot: data.merkleRoot ? BigInt(data.merkleRoot) : void 0,
    depositTimestamp: data.depositTimestamp,
    depositSignature: data.depositSignature
  };
}
function commitmentToBytes(commitment) {
  return bigIntToBytes(commitment);
}
function bytesToCommitment(bytes) {
  return bytesToBigInt(bytes);
}
async function encryptNote(note, password) {
  const serialized = JSON.stringify(serializeNote(note));
  const encoder = new TextEncoder();
  const data = encoder.encode(serialized);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 1e5,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(new Uint8Array(encrypted), salt.length + iv.length);
  return result;
}
async function decryptNote(encryptedData, password) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const salt = encryptedData.slice(0, 16);
  const iv = encryptedData.slice(16, 28);
  const ciphertext = encryptedData.slice(28);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 1e5,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  const serialized = decoder.decode(decrypted);
  return deserializeNote(JSON.parse(serialized));
}
var NoteStore = class _NoteStore {
  constructor() {
    this.notes = /* @__PURE__ */ new Map();
  }
  /**
   * Add a note to the store
   */
  add(note) {
    const key = note.commitment.toString();
    this.notes.set(key, note);
  }
  /**
   * Get a note by commitment
   */
  get(commitment) {
    return this.notes.get(commitment.toString());
  }
  /**
   * Get all unspent notes for an asset
   */
  getByAsset(assetId) {
    return Array.from(this.notes.values()).filter(
      (note) => note.assetId === assetId
    );
  }
  /**
   * Get total balance for an asset
   */
  getBalance(assetId) {
    return this.getByAsset(assetId).reduce(
      (sum, note) => sum + note.amount,
      BigInt(0)
    );
  }
  /**
   * Remove a note (after spending)
   */
  remove(commitment) {
    return this.notes.delete(commitment.toString());
  }
  /**
   * Get all notes
   */
  getAll() {
    return Array.from(this.notes.values());
  }
  /**
   * Serialize store to JSON
   */
  serialize() {
    const notes = Array.from(this.notes.values()).map(serializeNote);
    return JSON.stringify(notes);
  }
  /**
   * Load store from JSON
   */
  static deserialize(data) {
    const store = new _NoteStore();
    const notes = JSON.parse(data);
    for (const serialized of notes) {
      store.add(deserializeNote(serialized));
    }
    return store;
  }
};

// src/merkle/tree.ts
function computeZeros(depth) {
  const zeros = new Array(depth + 1);
  zeros[0] = BigInt(0);
  for (let i = 1; i <= depth; i++) {
    zeros[i] = hashTwo(zeros[i - 1], zeros[i - 1]);
  }
  return zeros;
}
var MerkleTree = class _MerkleTree {
  constructor(depth) {
    /** Current number of leaves */
    this.nextIndex = 0;
    /** All leaves (for proof generation) */
    this.leaves = [];
    /** Root history */
    this.rootHistory = [];
    if (depth < 4 || depth > 24) {
      throw new Error("Tree depth must be between 4 and 24");
    }
    this.depth = depth;
    this.maxLeaves = 2 ** depth;
    this.zeros = computeZeros(depth);
    this.filledSubtrees = [...this.zeros.slice(0, depth)];
    this._root = this.zeros[depth];
  }
  /**
   * Initialize Poseidon (must be called before using tree)
   */
  static async create(depth) {
    await initPoseidon();
    return new _MerkleTree(depth);
  }
  /**
   * Get current root
   */
  get root() {
    return this._root;
  }
  /**
   * Get next available leaf index
   */
  get nextLeafIndex() {
    return this.nextIndex;
  }
  /**
   * Check if tree is full
   */
  get isFull() {
    return this.nextIndex >= this.maxLeaves;
  }
  /**
   * Insert a leaf and return its index
   */
  insert(leaf) {
    if (this.isFull) {
      throw new Error("Merkle tree is full");
    }
    const leafIndex = this.nextIndex;
    this.leaves.push(leaf);
    let currentHash = leaf;
    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[level] = currentHash;
        currentHash = hashTwo(currentHash, this.zeros[level]);
      } else {
        currentHash = hashTwo(this.filledSubtrees[level], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    this.rootHistory.push(this._root);
    this._root = currentHash;
    this.nextIndex++;
    return leafIndex;
  }
  /**
   * Generate Merkle proof for a leaf
   */
  generateProof(leafIndex) {
    if (leafIndex < 0 || leafIndex >= this.nextIndex) {
      throw new Error(`Invalid leaf index: ${leafIndex}`);
    }
    const pathElements = [];
    const pathIndices = [];
    const levels = [this.leaves.slice()];
    const paddedLeaves = [...this.leaves];
    while (paddedLeaves.length < Math.pow(2, Math.ceil(Math.log2(this.nextIndex)))) {
      paddedLeaves.push(BigInt(0));
    }
    levels[0] = paddedLeaves;
    for (let level = 0; level < this.depth; level++) {
      const currentLevel = levels[level];
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : this.zeros[level];
        nextLevel.push(hashTwo(left, right));
      }
      if (nextLevel.length === 0) {
        nextLevel.push(this.zeros[level + 1]);
      }
      levels.push(nextLevel);
    }
    let currentIndex = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling = siblingIndex < levels[level].length ? levels[level][siblingIndex] : this.zeros[level];
      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2);
      currentIndex = Math.floor(currentIndex / 2);
    }
    return {
      pathElements,
      pathIndices,
      leaf: this.leaves[leafIndex],
      root: this._root,
      leafIndex
    };
  }
  /**
   * Verify a Merkle proof
   */
  static verifyProof(proof) {
    let currentHash = proof.leaf;
    for (let i = 0; i < proof.pathElements.length; i++) {
      if (proof.pathIndices[i] === 0) {
        currentHash = hashTwo(currentHash, proof.pathElements[i]);
      } else {
        currentHash = hashTwo(proof.pathElements[i], currentHash);
      }
    }
    return currentHash === proof.root;
  }
  /**
   * Check if a root is known (current or historical)
   */
  isKnownRoot(root) {
    if (root === this._root) return true;
    return this.rootHistory.includes(root);
  }
  /**
   * Get root at a specific leaf index
   */
  getRootAtIndex(leafIndex) {
    if (leafIndex < 0 || leafIndex >= this.nextIndex) {
      return void 0;
    }
    if (leafIndex === this.nextIndex - 1) {
      return this._root;
    }
    return this.rootHistory[leafIndex];
  }
  /**
   * Serialize tree state
   */
  serialize() {
    return JSON.stringify({
      depth: this.depth,
      nextIndex: this.nextIndex,
      leaves: this.leaves.map((l) => l.toString()),
      rootHistory: this.rootHistory.map((r) => r.toString()),
      root: this._root.toString()
    });
  }
  /**
   * Deserialize tree state
   */
  static async deserialize(data) {
    await initPoseidon();
    const parsed = JSON.parse(data);
    const tree = new _MerkleTree(parsed.depth);
    tree.nextIndex = parsed.nextIndex;
    tree.leaves = parsed.leaves.map((l) => BigInt(l));
    tree.rootHistory = parsed.rootHistory.map((r) => BigInt(r));
    tree._root = BigInt(parsed.root);
    for (const leaf of tree.leaves) {
    }
    return tree;
  }
};
async function syncTreeWithChain(tree, onChainLeaves) {
  for (let i = tree.nextLeafIndex; i < onChainLeaves.length; i++) {
    tree.insert(onChainLeaves[i]);
  }
}

// src/proof/prover.ts
import * as snarkjs from "snarkjs";
var ProofType = /* @__PURE__ */ ((ProofType3) => {
  ProofType3[ProofType3["Deposit"] = 0] = "Deposit";
  ProofType3[ProofType3["Withdraw"] = 1] = "Withdraw";
  ProofType3[ProofType3["JoinSplit"] = 2] = "JoinSplit";
  ProofType3[ProofType3["Membership"] = 3] = "Membership";
  return ProofType3;
})(ProofType || {});
var DEFAULT_MERKLE_TREE_DEPTH = 20;
var DEFAULT_CIRCUIT_PATHS = {
  [0 /* Deposit */]: {
    wasmPath: "circuits/build/deposit_js/deposit.wasm",
    zkeyPath: "circuits/build/deposit.zkey"
  },
  [1 /* Withdraw */]: {
    wasmPath: "circuits/build/withdraw_js/withdraw.wasm",
    zkeyPath: "circuits/build/withdraw.zkey"
  },
  [2 /* JoinSplit */]: {
    wasmPath: "circuits/build/joinsplit_js/joinsplit.wasm",
    zkeyPath: "circuits/build/joinsplit.zkey"
  },
  [3 /* Membership */]: {
    wasmPath: "circuits/build/membership_js/membership.wasm",
    zkeyPath: "circuits/build/membership.zkey"
  }
};
var Prover = class {
  constructor(circuitPaths, merkleTreeDepth = DEFAULT_MERKLE_TREE_DEPTH) {
    this.circuitPaths = {
      ...DEFAULT_CIRCUIT_PATHS,
      ...circuitPaths
    };
    this.merkleTreeDepth = merkleTreeDepth;
  }
  /**
   * Generate deposit proof
   */
  async generateDepositProof(inputs) {
    this.assertCircuitArtifactsExist(0 /* Deposit */);
    const circuitInputs = {
      commitment: inputs.commitment.toString(),
      amount: inputs.amount.toString(),
      asset_id: inputs.assetId.toString(),
      secret: inputs.secret.toString(),
      nullifier: inputs.nullifier.toString()
    };
    const paths = this.circuitPaths[0 /* Deposit */];
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      paths.wasmPath,
      paths.zkeyPath
    );
    return this.serializeProof(proof, publicSignals);
  }
  /**
   * Generate withdrawal proof
   */
  async generateWithdrawProof(inputs) {
    this.assertCircuitArtifactsExist(1 /* Withdraw */);
    this.assertMerkleDepth(inputs.merkleProof.pathElements.length, "withdraw");
    const circuitInputs = {
      // Public inputs
      merkle_root: inputs.merkleRoot.toString(),
      nullifier_hash: inputs.nullifierHash.toString(),
      asset_id: inputs.assetId.toString(),
      recipient: pubkeyToScalar(inputs.recipient).toString(),
      amount: inputs.amount.toString(),
      relayer: pubkeyToScalar(inputs.relayer).toString(),
      relayer_fee: inputs.relayerFee.toString(),
      public_data_hash: inputs.publicDataHash.toString(),
      // Private inputs
      secret: inputs.secret.toString(),
      nullifier: inputs.nullifier.toString(),
      leaf_index: inputs.leafIndex.toString(),
      merkle_path: inputs.merkleProof.pathElements.map((e) => e.toString()),
      merkle_path_indices: inputs.merkleProof.pathIndices.map((i) => i.toString())
    };
    const paths = this.circuitPaths[1 /* Withdraw */];
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      paths.wasmPath,
      paths.zkeyPath
    );
    return this.serializeProof(proof, publicSignals);
  }
  /**
   * Generate JoinSplit proof
   */
  async generateJoinSplitProof(inputs) {
    this.assertCircuitArtifactsExist(2 /* JoinSplit */);
    if (inputs.inputNotes.length !== 2 || inputs.outputNotes.length !== 2) {
      throw new Error("JoinSplit requires exactly 2 inputs and 2 outputs");
    }
    for (const proof2 of inputs.inputMerkleProofs) {
      this.assertMerkleDepth(proof2.pathElements.length, "joinsplit");
    }
    const circuitInputs = {
      merkle_root: inputs.merkleRoot.toString(),
      asset_id: inputs.assetId.toString(),
      input_nullifiers: inputs.inputNotes.map((n) => n.nullifierHash.toString()),
      output_commitments: inputs.outputNotes.map((n) => n.commitment.toString()),
      public_amount: inputs.publicAmount.toString(),
      relayer: pubkeyToScalar(inputs.relayer).toString(),
      relayer_fee: inputs.relayerFee.toString(),
      // Private inputs
      input_secrets: inputs.inputNotes.map((n) => n.secret.toString()),
      input_nullifier_preimages: inputs.inputNotes.map((n) => n.nullifier.toString()),
      input_amounts: inputs.inputNotes.map((n) => n.amount.toString()),
      input_leaf_indices: inputs.inputNotes.map((n) => n.leafIndex.toString()),
      input_merkle_paths: inputs.inputMerkleProofs.map(
        (p) => p.pathElements.map((e) => e.toString())
      ),
      input_path_indices: inputs.inputMerkleProofs.map(
        (p) => p.pathIndices.map((i) => i.toString())
      ),
      output_secrets: inputs.outputNotes.map((n) => n.secret.toString()),
      output_nullifier_preimages: inputs.outputNotes.map((n) => n.nullifier.toString()),
      output_amounts: inputs.outputNotes.map((n) => n.amount.toString())
    };
    const paths = this.circuitPaths[2 /* JoinSplit */];
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      paths.wasmPath,
      paths.zkeyPath
    );
    return this.serializeProof(proof, publicSignals);
  }
  /**
   * Serialize Groth16 proof to 256 bytes for on-chain verification
   */
  serializeProof(proof, publicSignals) {
    const proofData = new Uint8Array(256);
    const ax = hexToBytes32(bigIntToHex(BigInt(proof.pi_a[0])));
    const ay = hexToBytes32(bigIntToHex(BigInt(proof.pi_a[1])));
    proofData.set(ax, 0);
    proofData.set(ay, 32);
    const bx0 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[0][1])));
    const bx1 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[0][0])));
    const by0 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[1][1])));
    const by1 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[1][0])));
    proofData.set(bx0, 64);
    proofData.set(bx1, 96);
    proofData.set(by0, 128);
    proofData.set(by1, 160);
    const cx = hexToBytes32(bigIntToHex(BigInt(proof.pi_c[0])));
    const cy = hexToBytes32(bigIntToHex(BigInt(proof.pi_c[1])));
    proofData.set(cx, 192);
    proofData.set(cy, 224);
    const publicInputs = publicSignals.map((s) => BigInt(s));
    return { proofData, publicInputs };
  }
  assertMerkleDepth(actualDepth, proofType) {
    if (actualDepth !== this.merkleTreeDepth) {
      throw new Error(
        `Merkle depth mismatch for ${proofType} proof: expected ${this.merkleTreeDepth}, got ${actualDepth}`
      );
    }
  }
  assertCircuitArtifactsExist(proofType) {
    if (typeof globalThis !== "undefined" && "window" in globalThis) return;
    try {
      const fs = __require("fs");
      const paths = this.circuitPaths[proofType];
      if (!fs.existsSync(paths.wasmPath)) {
        throw new Error(
          `Missing ${ProofType[proofType]} circuit wasm at ${paths.wasmPath}. Run: cd circuits && ./build.sh`
        );
      }
      if (!fs.existsSync(paths.zkeyPath)) {
        throw new Error(
          `Missing ${ProofType[proofType]} circuit zkey at ${paths.zkeyPath}. Run: cd circuits && ./build.sh`
        );
      }
    } catch (e) {
      if (e.code === "MODULE_NOT_FOUND") return;
      throw e;
    }
  }
};
function pubkeyToScalar(pubkey) {
  const bytes = pubkey.toBytes();
  const scalarBytes = new Uint8Array(32);
  scalarBytes.set(bytes.slice(0, 31), 1);
  let result = 0n;
  for (let i = 0; i < scalarBytes.length; i++) {
    result = result << 8n | BigInt(scalarBytes[i]);
  }
  return result;
}
function bigIntToHex(value) {
  return value.toString(16).padStart(64, "0");
}
function hexToBytes32(hex) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
async function verifyProofLocally(proofType, proof, publicSignals, vkeyPath) {
  const vkey = await fetch(vkeyPath).then((r) => r.json());
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
async function exportVerificationKey(zkeyPath) {
  return snarkjs.zKey.exportVerificationKey(zkeyPath);
}

// src/types.ts
import BN from "bn.js";
var ProofType2 = /* @__PURE__ */ ((ProofType3) => {
  ProofType3[ProofType3["Deposit"] = 0] = "Deposit";
  ProofType3[ProofType3["Withdraw"] = 1] = "Withdraw";
  ProofType3[ProofType3["JoinSplit"] = 2] = "JoinSplit";
  ProofType3[ProofType3["Membership"] = 3] = "Membership";
  ProofType3[ProofType3["WithdrawV2"] = 5] = "WithdrawV2";
  return ProofType3;
})(ProofType2 || {});
function proofTypeSeed(proofType) {
  const seeds = {
    [0 /* Deposit */]: "vk_deposit",
    [1 /* Withdraw */]: "vk_withdraw",
    [2 /* JoinSplit */]: "vk_joinsplit",
    [3 /* Membership */]: "vk_membership",
    [5 /* WithdrawV2 */]: "vk_withdraw_v2"
  };
  return Buffer.from(seeds[proofType]);
}
var ShieldedActionType = /* @__PURE__ */ ((ShieldedActionType2) => {
  ShieldedActionType2[ShieldedActionType2["DexSwap"] = 0] = "DexSwap";
  ShieldedActionType2[ShieldedActionType2["LendingDeposit"] = 1] = "LendingDeposit";
  ShieldedActionType2[ShieldedActionType2["LendingBorrow"] = 2] = "LendingBorrow";
  ShieldedActionType2[ShieldedActionType2["Stake"] = 3] = "Stake";
  ShieldedActionType2[ShieldedActionType2["Unstake"] = 4] = "Unstake";
  ShieldedActionType2[ShieldedActionType2["Custom"] = 255] = "Custom";
  return ShieldedActionType2;
})(ShieldedActionType || {});
var SpendType = /* @__PURE__ */ ((SpendType2) => {
  SpendType2[SpendType2["Withdraw"] = 0] = "Withdraw";
  SpendType2[SpendType2["JoinSplit"] = 1] = "JoinSplit";
  SpendType2[SpendType2["ShieldedCpi"] = 2] = "ShieldedCpi";
  return SpendType2;
})(SpendType || {});
var AssetType = /* @__PURE__ */ ((AssetType2) => {
  AssetType2[AssetType2["SplToken"] = 0] = "SplToken";
  AssetType2[AssetType2["NativeSol"] = 1] = "NativeSol";
  AssetType2[AssetType2["Token2022"] = 2] = "Token2022";
  return AssetType2;
})(AssetType || {});
var MIN_TREE_DEPTH = 4;
var MAX_TREE_DEPTH = 24;
var MIN_ROOT_HISTORY_SIZE = 30;
var DEFAULT_ROOT_HISTORY_SIZE = 100;
var PROOF_SIZE = 256;
var G1_POINT_SIZE = 64;
var G2_POINT_SIZE = 128;
var MAX_METADATA_URI_LEN = 200;
var MAX_ENCRYPTED_NOTE_SIZE = 1024;
var NATIVE_SOL_ASSET_ID = new Uint8Array([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1
]);
var FEATURE_MASP = 1 << 0;
var FEATURE_JOIN_SPLIT = 1 << 1;
var FEATURE_MEMBERSHIP = 1 << 2;
var FEATURE_SHIELDED_CPI = 1 << 3;
var FEATURE_COMPLIANCE = 1 << 4;
function toBN(value) {
  if (BN.isBN(value)) return value;
  if (typeof value === "bigint") return new BN(value.toString());
  return new BN(value);
}
function toHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}
function fromHex(hex) {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function isValidCommitment(commitment) {
  if (commitment.length !== 32) return false;
  return !commitment.every((b) => b === 0);
}
function isValidNullifier(nullifier) {
  if (nullifier.length !== 32) return false;
  return !nullifier.every((b) => b === 0);
}
function isValidProofLength(proofData) {
  return proofData.length === PROOF_SIZE;
}

// src/pda.ts
import { PublicKey } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";
var PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
var POOL_SEED = Buffer.from("white_pool");
var MERKLE_TREE_SEED = Buffer.from("merkle_tree");
var VAULT_SEED = Buffer.from("vault");
var NULLIFIER_SEED = Buffer.from("nullifier");
var RELAYER_REGISTRY_SEED = Buffer.from("relayer_registry");
var RELAYER_SEED = Buffer.from("relayer");
var COMPLIANCE_SEED = Buffer.from("compliance");
var PENDING_SEED = Buffer.from("pending");
function findPoolConfigPda(programId, authority) {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, authority.toBuffer()],
    programId
  );
}
function findMerkleTreePda(programId, poolConfig) {
  return PublicKey.findProgramAddressSync(
    [MERKLE_TREE_SEED, poolConfig.toBuffer()],
    programId
  );
}
function findAssetVaultPda(programId, poolConfig, assetId) {
  if (assetId.length !== 32) {
    throw new Error("Asset ID must be 32 bytes");
  }
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, poolConfig.toBuffer(), Buffer.from(assetId)],
    programId
  );
}
function findVerificationKeyPda(programId, poolConfig, proofType) {
  const seed = proofTypeSeed(proofType);
  return PublicKey.findProgramAddressSync(
    [seed, poolConfig.toBuffer()],
    programId
  );
}
function findSpentNullifierPda(programId, poolConfig, nullifierHash) {
  if (nullifierHash.length !== 32) {
    throw new Error("Nullifier hash must be 32 bytes");
  }
  return PublicKey.findProgramAddressSync(
    [NULLIFIER_SEED, poolConfig.toBuffer(), Buffer.from(nullifierHash)],
    programId
  );
}
function findRelayerRegistryPda(programId, poolConfig) {
  return PublicKey.findProgramAddressSync(
    [RELAYER_REGISTRY_SEED, poolConfig.toBuffer()],
    programId
  );
}
function findPendingBufferPda(programId, poolConfig) {
  return PublicKey.findProgramAddressSync(
    [PENDING_SEED, poolConfig.toBuffer()],
    programId
  );
}
function findRelayerNodePda(programId, registry, operator) {
  return PublicKey.findProgramAddressSync(
    [RELAYER_SEED, registry.toBuffer(), operator.toBuffer()],
    programId
  );
}
function findComplianceConfigPda(programId, poolConfig) {
  return PublicKey.findProgramAddressSync(
    [COMPLIANCE_SEED, poolConfig.toBuffer()],
    programId
  );
}
function computeAssetId(mint) {
  const prefix = Buffer.from("white:asset_id:v1");
  const mintBytes = mint.toBuffer();
  const input = Buffer.concat([prefix, mintBytes]);
  const hash = keccak_256(input);
  const out = new Uint8Array(32);
  out[0] = 0;
  out.set(hash.slice(0, 31), 1);
  return out;
}
function derivePoolPdas(programId, authority) {
  const [poolConfig, poolConfigBump] = findPoolConfigPda(programId, authority);
  const [merkleTree, merkleTreeBump] = findMerkleTreePda(programId, poolConfig);
  const [relayerRegistry, relayerRegistryBump] = findRelayerRegistryPda(programId, poolConfig);
  const [complianceConfig, complianceConfigBump] = findComplianceConfigPda(programId, poolConfig);
  return {
    poolConfig,
    poolConfigBump,
    merkleTree,
    merkleTreeBump,
    relayerRegistry,
    relayerRegistryBump,
    complianceConfig,
    complianceConfigBump
  };
}
function deriveAssetVaultPdas(programId, poolConfig, assetIds) {
  return assetIds.map((assetId) => findAssetVaultPda(programId, poolConfig, assetId));
}
function deriveVerificationKeyPdas(programId, poolConfig) {
  return {
    [0 /* Deposit */]: findVerificationKeyPda(programId, poolConfig, 0 /* Deposit */),
    [1 /* Withdraw */]: findVerificationKeyPda(programId, poolConfig, 1 /* Withdraw */),
    [2 /* JoinSplit */]: findVerificationKeyPda(programId, poolConfig, 2 /* JoinSplit */),
    [3 /* Membership */]: findVerificationKeyPda(programId, poolConfig, 3 /* Membership */),
    [5 /* WithdrawV2 */]: findVerificationKeyPda(programId, poolConfig, 5 /* WithdrawV2 */)
  };
}

// src/client.ts
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  PublicKey as PublicKey3,
  SystemProgram
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";

// src/yield/jupiter.ts
import {
  VersionedTransaction,
  TransactionMessage
} from "@solana/web3.js";
function getJupiterBaseUrl() {
  return process.env.JUPITER_BASE_URL ?? "https://quote-api.jup.ag";
}
async function jupiterQuoteExactIn(params) {
  const base = getJupiterBaseUrl();
  const url = new URL(`${base}/v6/quote`);
  url.searchParams.set("inputMint", params.inputMint.toBase58());
  url.searchParams.set("outputMint", params.outputMint.toBase58());
  url.searchParams.set("amount", params.amount.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps));
  url.searchParams.set("swapMode", "ExactIn");
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Jupiter quote failed: ${res.status} ${res.statusText} ${text}`
    );
  }
  return await res.json();
}
async function jupiterSwapExactIn(params) {
  const base = getJupiterBaseUrl();
  const res = await fetch(`${base}/v6/swap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      quoteResponse: params.quote,
      userPublicKey: params.userPublicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto"
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Jupiter swap build failed: ${res.status} ${res.statusText} ${text}`
    );
  }
  const json = await res.json();
  if (!json.swapTransaction) {
    throw new Error("Jupiter swap response missing swapTransaction");
  }
  const raw = Buffer.from(json.swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(raw);
  const signed = await params.signTransaction(tx);
  const sig = await params.connection.sendTransaction(signed, {
    maxRetries: 3,
    skipPreflight: false
  });
  const latest = await params.connection.getLatestBlockhash("finalized");
  await params.connection.confirmTransaction(
    { signature: sig, ...latest },
    "finalized"
  );
  return { signature: sig };
}
function buildNoopMemoTx(params) {
  const msg = new TransactionMessage({
    payerKey: params.payer,
    recentBlockhash: params.recentBlockhash,
    instructions: []
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

// src/client.ts
import { NATIVE_MINT } from "@solana/spl-token";
var SUPPORTED_LST_MINTS = {
  JitoSOL: new PublicKey3("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
  mSOL: new PublicKey3("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So")
};
var WhiteProtocolClient = class {
  constructor(options) {
    this.programId = options.programId ?? PROGRAM_ID;
    if (options.provider) {
      this.provider = options.provider;
    } else if (options.connection && options.wallet) {
      const wallet = {
        publicKey: options.wallet.publicKey,
        signTransaction: async (tx) => {
          tx.sign(options.wallet);
          return tx;
        },
        signAllTransactions: async (txs) => {
          txs.forEach((tx) => tx.sign(options.wallet));
          return txs;
        }
      };
      this.provider = new AnchorProvider(options.connection, wallet, {
        commitment: "confirmed"
      });
    } else {
      throw new Error("Either provider or connection+wallet must be provided");
    }
    if (!options.idl) {
      throw new Error("IDL must be provided");
    }
    this.program = new Program(options.idl, this.provider);
  }
  /**
   * Get authority public key
   */
  get authority() {
    return this.provider.publicKey;
  }
  // ============================================
  // Pool Administration
  // ============================================
  /**
   * Initialize a new MASP pool
   */
  async initializePool(treeDepth, rootHistorySize) {
    const authority = this.authority;
    const [poolConfig] = findPoolConfigPda(this.programId, authority);
    const [merkleTree] = findMerkleTreePda(this.programId, poolConfig);
    const tx = await this.program.methods.initializePoolV2(treeDepth, rootHistorySize).accounts({
      authority,
      poolConfig,
      merkleTree,
      systemProgram: SystemProgram.programId
    }).rpc();
    return {
      signature: tx,
      poolConfig,
      merkleTree
    };
  }
  /**
   * Initialize pool registries (relayer registry, compliance config)
   */
  async initializePoolRegistries(poolConfig) {
    const authority = this.authority;
    const [relayerRegistry] = findRelayerRegistryPda(this.programId, poolConfig);
    const [complianceConfig] = findComplianceConfigPda(this.programId, poolConfig);
    return await this.program.methods.initializePoolRegistries().accounts({
      authority,
      poolConfig,
      relayerRegistry,
      complianceConfig,
      systemProgram: SystemProgram.programId
    }).rpc();
  }
  /**
   * Register an asset (SPL token) in the pool
   */
  async registerAsset(poolConfig, mint) {
    const authority = this.authority;
    const assetId = computeAssetId(mint);
    const [assetVault] = findAssetVaultPda(this.programId, poolConfig, assetId);
    const [vaultTokenAccount] = PublicKey3.findProgramAddressSync(
      [Buffer.from("vault_token"), assetVault.toBuffer()],
      this.programId
    );
    return await this.program.methods.registerAsset(Array.from(assetId)).accounts({
      authority,
      poolConfig,
      mint,
      assetVault,
      vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }).rpc();
  }
  /**
   * Set verification key for a proof type
   */
  async setVerificationKey(poolConfig, proofType, vkAlphaG1, vkBetaG2, vkGammaG2, vkDeltaG2, vkIc) {
    const authority = this.authority;
    const [vkAccount] = findVerificationKeyPda(this.programId, poolConfig, proofType);
    return await this.program.methods.setVerificationKeyV2(
      proofType,
      Array.from(vkAlphaG1),
      Array.from(vkBetaG2),
      Array.from(vkGammaG2),
      Array.from(vkDeltaG2),
      vkIc.map((ic) => Array.from(ic))
    ).accounts({
      authority,
      poolConfig,
      vkAccount,
      systemProgram: SystemProgram.programId
    }).rpc();
  }
  // ============================================
  // Deposits & Withdrawals
  // ============================================
  /**
   * Deposit funds into the shielded pool
   */
  async deposit(poolConfig, mint, amount, commitment, proofData, encryptedNote) {
    const depositor = this.authority;
    const assetId = computeAssetId(mint);
    const [merkleTree] = findMerkleTreePda(this.programId, poolConfig);
    const [assetVault] = findAssetVaultPda(this.programId, poolConfig, assetId);
    const [vaultTokenAccount] = PublicKey3.findProgramAddressSync(
      [Buffer.from("vault_token"), assetVault.toBuffer()],
      this.programId
    );
    const [depositVk] = findVerificationKeyPda(this.programId, poolConfig, 0 /* Deposit */);
    const userTokenAccount = getAssociatedTokenAddressSync(mint, depositor);
    const poolConfigData = await this.program.account.poolConfigV2.fetch(poolConfig);
    const poolAuthority = poolConfigData.authority;
    const connection = this.provider.connection;
    const userTokenAccountInfo = await connection.getAccountInfo(userTokenAccount);
    const preInstructions = [];
    if (!userTokenAccountInfo) {
      const { createAssociatedTokenAccountInstruction, NATIVE_MINT: NM2 } = await import("@solana/spl-token");
      const createAtaIx = createAssociatedTokenAccountInstruction(
        depositor,
        userTokenAccount,
        depositor,
        mint
      );
      preInstructions.push(createAtaIx);
    }
    const { NATIVE_MINT: NM, createSyncNativeInstruction } = await import("@solana/spl-token");
    if (mint.equals(NM)) {
      const transferIx = SystemProgram.transfer({
        fromPubkey: depositor,
        toPubkey: userTokenAccount,
        lamports: Number(amount)
      });
      preInstructions.push(transferIx);
      const syncIx = createSyncNativeInstruction(userTokenAccount);
      preInstructions.push(syncIx);
    }
    const tx = await this.program.methods.depositMasp(
      toBN(amount),
      Array.from(commitment),
      Array.from(assetId),
      Buffer.from(proofData),
      encryptedNote || null
    ).accounts({
      depositor,
      poolConfig,
      authority: poolAuthority,
      merkleTree,
      assetVault,
      vaultTokenAccount,
      userTokenAccount,
      mint,
      depositVk,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }).preInstructions(preInstructions).rpc();
    return {
      signature: tx,
      leafIndex: 0
      // TODO: Parse from logs
    };
  }
  async withdraw(poolConfig, mint, recipient, amount, merkleRoot, nullifierHash, proofData, relayerFee) {
    const relayer = this.authority;
    const assetId = computeAssetId(mint);
    const [merkleTree] = findMerkleTreePda(this.programId, poolConfig);
    const [assetVault] = findAssetVaultPda(this.programId, poolConfig, assetId);
    const [vaultTokenAccount] = PublicKey3.findProgramAddressSync(
      [Buffer.from("vault_token"), assetVault.toBuffer()],
      this.programId
    );
    const [withdrawVk] = findVerificationKeyPda(this.programId, poolConfig, 1 /* Withdraw */);
    const [spentNullifier] = findSpentNullifierPda(this.programId, poolConfig, nullifierHash);
    const [relayerRegistry] = findRelayerRegistryPda(this.programId, poolConfig);
    const recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient);
    const relayerTokenAccount = getAssociatedTokenAddressSync(mint, relayer);
    const connection = this.provider.connection;
    const recipientAccountInfo = await connection.getAccountInfo(recipientTokenAccount);
    const preInstructions = [];
    if (!recipientAccountInfo) {
      const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
      const createAtaIx = createAssociatedTokenAccountInstruction(
        relayer,
        recipientTokenAccount,
        recipient,
        mint
      );
      preInstructions.push(createAtaIx);
    }
    const relayerAccountInfo = await connection.getAccountInfo(relayerTokenAccount);
    if (!relayerAccountInfo) {
      const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
      const createRelayerAtaIx = createAssociatedTokenAccountInstruction(
        relayer,
        relayerTokenAccount,
        relayer,
        mint
      );
      preInstructions.push(createRelayerAtaIx);
    }
    const tx = await this.program.methods.withdrawMasp(
      Buffer.from(proofData),
      Array.from(merkleRoot),
      Array.from(nullifierHash),
      recipient,
      toBN(amount),
      Array.from(assetId),
      toBN(relayerFee ?? 0n)
    ).accounts({
      relayer,
      poolConfig,
      merkleTree,
      vkAccount: withdrawVk,
      assetVault,
      vaultTokenAccount,
      recipientTokenAccount,
      relayerTokenAccount,
      spentNullifier,
      relayerRegistry,
      relayerNode: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }).preInstructions(preInstructions).rpc();
    return { signature: tx };
  }
  /**
   * Withdraw V2 (join-split with change)
   * Enables partial withdrawals with a change output
   * 
   * @param poolConfig - Pool configuration account
   * @param mint - Token mint address
   * @param recipient - Recipient address for withdrawn funds
   * @param amount - Gross withdrawal amount (includes relayer fee)
   * @param merkleRoot - Merkle root for proof verification
   * @param nullifierHash0 - Primary nullifier hash
   * @param nullifierHash1 - Secondary nullifier hash (pass zeros if unused)
   * @param changeCommitment - Change output commitment
   * @param proofData - ZK proof bytes (256 bytes)
   * @param relayerFee - Fee for relayer service
   */
  async withdrawV2(poolConfig, mint, recipient, amount, merkleRoot, nullifierHash0, nullifierHash1, changeCommitment, proofData, relayerFee) {
    const relayer = this.authority;
    const assetId = computeAssetId(mint);
    const [merkleTree] = findMerkleTreePda(this.programId, poolConfig);
    const [assetVault] = findAssetVaultPda(this.programId, poolConfig, assetId);
    const [vaultTokenAccount] = PublicKey3.findProgramAddressSync(
      [Buffer.from("vault_token"), assetVault.toBuffer()],
      this.programId
    );
    const [withdrawV2Vk] = findVerificationKeyPda(this.programId, poolConfig, 5 /* WithdrawV2 */);
    const [spentNullifier0] = findSpentNullifierPda(this.programId, poolConfig, nullifierHash0);
    const [relayerRegistry] = findRelayerRegistryPda(this.programId, poolConfig);
    const [pendingBuffer] = findPendingBufferPda(this.programId, poolConfig);
    const hasSecondNullifier = !nullifierHash1.every((byte) => byte === 0);
    const spentNullifier1 = hasSecondNullifier ? findSpentNullifierPda(this.programId, poolConfig, nullifierHash1)[0] : null;
    const recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient);
    const relayerTokenAccount = getAssociatedTokenAddressSync(mint, relayer);
    const connection = this.provider.connection;
    const recipientAccountInfo = await connection.getAccountInfo(recipientTokenAccount);
    const preInstructions = [];
    if (!recipientAccountInfo) {
      const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
      const createAtaIx = createAssociatedTokenAccountInstruction(
        relayer,
        recipientTokenAccount,
        recipient,
        mint
      );
      preInstructions.push(createAtaIx);
    }
    const relayerAccountInfo = await connection.getAccountInfo(relayerTokenAccount);
    if (!relayerAccountInfo) {
      const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
      const createRelayerAtaIx = createAssociatedTokenAccountInstruction(
        relayer,
        relayerTokenAccount,
        relayer,
        mint
      );
      preInstructions.push(createRelayerAtaIx);
    }
    const tx = await this.program.methods.withdrawV2(
      Buffer.from(proofData),
      Array.from(merkleRoot),
      Array.from(assetId),
      Array.from(nullifierHash0),
      Array.from(nullifierHash1),
      Array.from(changeCommitment),
      recipient,
      toBN(amount),
      toBN(relayerFee ?? 0n)
    ).accounts({
      relayer,
      poolConfig,
      merkleTree,
      vkAccount: withdrawV2Vk,
      assetVault,
      vaultTokenAccount,
      recipientTokenAccount,
      relayerTokenAccount,
      spentNullifier0,
      spentNullifier1,
      pendingBuffer,
      relayerRegistry,
      relayerNode: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId
    }).preInstructions(preInstructions).rpc();
    return { signature: tx };
  }
  // ============================================
  // Account Fetchers
  // ============================================
  /**
   * Fetch pool configuration
   */
  async fetchPoolConfig(poolConfig) {
    return await this.program.account.poolConfigV2.fetch(poolConfig);
  }
  /**
   * Fetch Merkle tree state
   */
  async fetchMerkleTree(merkleTree) {
    return await this.program.account.merkleTreeV2.fetch(merkleTree);
  }
  /**
   * Fetch asset vault
   */
  async fetchAssetVault(assetVault) {
    return await this.program.account.assetVault.fetch(assetVault);
  }
  /**
   * Check if nullifier has been spent
   */
  async isNullifierSpent(poolConfig, nullifierHash) {
    const [spentNullifier] = findSpentNullifierPda(this.programId, poolConfig, nullifierHash);
    try {
      await this.program.account.spentNullifierV2.fetch(spentNullifier);
      return true;
    } catch {
      return false;
    }
  }
  // ==========================================================================
  // YIELD MODE METHODS
  // ==========================================================================
  /**
   * Deposit SOL with Yield Mode (swap to LST first)
   * 
   * Flow:
   * 1. Swap SOL -> LST using Jupiter
   * 2. Deposit LST to pool (existing deposit flow)
   * 3. Store note metadata with principal SOL amount
   * 
   * @param params - Deposit parameters with yield mode options
   * @returns Swap signature and deposit signature
   */
  async depositYieldSol(params) {
    const slippageBps = params.slippageBps ?? Number(process.env.JUPITER_SLIPPAGE_BPS ?? "50");
    const connection = this.provider.connection;
    const payer = this.provider.publicKey;
    if (!payer) throw new Error("Provider missing publicKey");
    const quote = await jupiterQuoteExactIn({
      inputMint: NATIVE_MINT,
      outputMint: params.mintLST,
      amount: params.amountSolLamports,
      slippageBps
    });
    const { signature: swapSig } = await jupiterSwapExactIn({
      connection,
      userPublicKey: payer,
      quote,
      signTransaction: async (tx) => {
        const w = this.provider.wallet;
        if (!w?.signTransaction) {
          throw new Error("Provider wallet missing signTransaction");
        }
        return await w.signTransaction(tx);
      }
    });
    const lstAmount = BigInt(quote.outAmount);
    throw new Error(
      "depositYieldSol: Proof generation wiring not yet implemented. Need to generate deposit proof and call deposit instruction."
    );
  }
  /**
   * Withdraw with Yield Mode (5% performance fee on positive yield)
   * 
   * Flow:
   * 1. Fetch current LST -> SOL quote
   * 2. Calculate fee: max(0, current_value - principal) * 0.05
   * 3. Generate withdraw_v2 proof with relayer_fee
   * 4. Submit via relayer endpoint (relayer signs)
   * 
   * @param params - Withdraw parameters with yield mode options
   * @returns Withdraw signature and optional swap signature
   */
  async withdrawYieldV2(params) {
    const slippageBps = params.slippageBps ?? Number(process.env.JUPITER_SLIPPAGE_BPS ?? "50");
    const connection = this.provider.connection;
    const payer = this.provider.publicKey;
    if (!payer) throw new Error("Provider missing publicKey");
    const quote = await jupiterQuoteExactIn({
      inputMint: params.mintLST,
      outputMint: NATIVE_MINT,
      amount: params.amountLstAtomic,
      slippageBps
    });
    const currentValueSol = BigInt(quote.outAmount);
    const yieldSol = currentValueSol > params.principalSolLamports ? currentValueSol - params.principalSolLamports : 0n;
    const feeSol = yieldSol * 5n / 100n;
    const feeLst = feeSol > 0n ? feeSol * params.amountLstAtomic / currentValueSol : 0n;
    throw new Error(
      `withdrawYieldV2: Proof generation and relayer submission not yet implemented. Fee calculation: feeSol=${feeSol}, feeLst=${feeLst}`
    );
  }
};
function createWhiteProtocolClient(provider, idl, programId) {
  return new WhiteProtocolClient({
    provider,
    idl,
    programId
  });
}

// src/index.ts
async function initializeSDK() {
  const { initPoseidon: initPoseidon2 } = await import("./poseidon-EVTSYZRO.mjs");
  await initPoseidon2();
}
var SDK_VERSION = "2.0.0";
var IS_PRODUCTION_READY = false;
var SDK_STATUS = "alpha";
var PROTOCOL_NAME = "The White Protocol";
export {
  AssetType,
  COMPLIANCE_SEED,
  DEFAULT_CIRCUIT_PATHS,
  DEFAULT_ROOT_HISTORY_SIZE,
  FEATURE_COMPLIANCE,
  FEATURE_JOIN_SPLIT,
  FEATURE_MASP,
  FEATURE_MEMBERSHIP,
  FEATURE_SHIELDED_CPI,
  FIELD_MODULUS,
  G1_POINT_SIZE,
  G2_POINT_SIZE,
  IS_PRODUCTION_READY,
  MAX_ENCRYPTED_NOTE_SIZE,
  MAX_METADATA_URI_LEN,
  MAX_TREE_DEPTH,
  MERKLE_TREE_SEED,
  MIN_ROOT_HISTORY_SIZE,
  MIN_TREE_DEPTH,
  MerkleTree,
  NATIVE_SOL_ASSET_ID,
  NULLIFIER_SEED,
  NoteStore,
  PENDING_SEED,
  POOL_SEED,
  PROGRAM_ID,
  PROOF_SIZE,
  PROTOCOL_NAME,
  ProofType2 as ProofType,
  Prover,
  RELAYER_REGISTRY_SEED,
  RELAYER_SEED,
  SDK_STATUS,
  SDK_VERSION,
  SUPPORTED_LST_MINTS,
  ShieldedActionType,
  SpendType,
  VAULT_SEED,
  WhiteProtocolClient,
  bigIntToBytes,
  bigIntToFieldBytes,
  buildNoopMemoTx,
  bytesEqual,
  bytesToBigInt,
  bytesToCommitment,
  commitmentToBytes,
  computeAssetId,
  computeCommitment,
  computeNoteNullifier,
  computeNullifierHash,
  createNote,
  createNoteFromParams,
  createWhiteProtocolClient,
  decryptNote,
  deriveAssetVaultPdas,
  derivePoolPdas,
  deriveVerificationKeyPdas,
  deserializeNote,
  encryptNote,
  exportVerificationKey,
  fieldMod,
  findAssetVaultPda,
  findComplianceConfigPda,
  findMerkleTreePda,
  findPendingBufferPda,
  findPoolConfigPda,
  findRelayerNodePda,
  findRelayerRegistryPda,
  findSpentNullifierPda,
  findVerificationKeyPda,
  fromHex,
  hashFour,
  hashTwo,
  initPoseidon,
  initializeSDK,
  isValidCommitment,
  isValidFieldElement,
  isValidNullifier,
  isValidProofLength,
  jupiterQuoteExactIn,
  jupiterSwapExactIn,
  proofTypeSeed,
  pubkeyToScalar,
  randomFieldElement,
  serializeNote,
  syncTreeWithChain,
  toBN,
  toHex,
  verifyProofLocally
};
