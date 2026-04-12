var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/crypto/poseidon.ts
import { buildPoseidon } from "circomlibjs";
var poseidonInstance = null;
async function initPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
}
function getPoseidon() {
  if (!poseidonInstance) {
    throw new Error("Poseidon not initialized. Call initPoseidon() first.");
  }
  return poseidonInstance;
}
function hashTwo(left, right) {
  const poseidon = getPoseidon();
  const hash = poseidon([left, right]);
  return poseidon.F.toObject(hash);
}
function hashFour(a, b, c, d) {
  const poseidon = getPoseidon();
  const hash = poseidon([a, b, c, d]);
  return poseidon.F.toObject(hash);
}
function computeCommitment(secret, nullifier, amount, assetId) {
  return hashFour(secret, nullifier, amount, assetId);
}
function computeNullifierHash(nullifier, secret, leafIndex) {
  const inner = hashTwo(nullifier, secret);
  return hashTwo(inner, leafIndex);
}
function bytesToBigInt(bytes) {
  let result = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    result = result << BigInt(8) | BigInt(bytes[i]);
  }
  return result;
}
function bigIntToBytes(value) {
  const bytes = new Uint8Array(32);
  let temp = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(temp & BigInt(255));
    temp = temp >> BigInt(8);
  }
  return bytes;
}
function bigIntToFieldBytes(value) {
  const bytes = new Uint8Array(32);
  let temp = value;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(temp & BigInt(255));
    temp = temp >> BigInt(8);
  }
  return bytes;
}
function randomFieldElement() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  bytes[0] &= 31;
  return bytesToBigInt(bytes);
}
var FIELD_MODULUS = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);
function isValidFieldElement(value) {
  return value >= BigInt(0) && value < FIELD_MODULUS;
}
function fieldMod(value) {
  return (value % FIELD_MODULUS + FIELD_MODULUS) % FIELD_MODULUS;
}

export {
  __require,
  initPoseidon,
  hashTwo,
  hashFour,
  computeCommitment,
  computeNullifierHash,
  bytesToBigInt,
  bigIntToBytes,
  bigIntToFieldBytes,
  randomFieldElement,
  FIELD_MODULUS,
  isValidFieldElement,
  fieldMod
};
