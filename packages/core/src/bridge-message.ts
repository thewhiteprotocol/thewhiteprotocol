/**
 * Bridge Message V1 — Canonical encoding and hashing for The White Protocol private bridge.
 *
 * Cross-language parity: TypeScript, Solidity, and Rust must all produce
 * identical keccak256 hashes for the same message inputs.
 *
 * Encoding rules:
 * - All integers are big-endian.
 * - bytes32 fields are raw 32 bytes.
 * - No dynamic-length fields.
 * - Fixed total encoded length: 451 bytes.
 * - Hash: keccak256(domainSeparator || encodedMessage)
 */

import { keccak_256 } from '@noble/hashes/sha3';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Exact ASCII domain separator — consensus-critical */
export const BRIDGE_MESSAGE_DOMAIN_SEPARATOR = 'WHITE_PRIVATE_BRIDGE_MESSAGE_V1';

/** Fixed encoded message length in bytes */
export const BRIDGE_MESSAGE_ENCODED_LENGTH = 451;

export enum BridgeMessageType {
  BridgeOut = 1,
  BridgeMint = 2,
}

// =============================================================================
// TYPES
// =============================================================================

export interface BridgeMessageV1 {
  protocolVersion: number;
  messageType: BridgeMessageType;
  sourceDomain: number;
  destinationDomain: number;
  sourceChainId: number;
  destinationChainId: number;
  canonicalAssetId: string; // 64-char hex, no 0x prefix
  sourceLocalAssetId: string; // 64-char hex, no 0x prefix
  destinationLocalAssetId: string; // 64-char hex, no 0x prefix
  amount: bigint;
  sourceNullifierHash: string; // 64-char hex, no 0x prefix
  destinationCommitment: string; // 64-char hex, no 0x prefix
  sourceRoot: string; // 64-char hex, no 0x prefix
  sourceLeafIndex: number;
  sourceTxHash: string; // 64-char hex, no 0x prefix
  sourceBlockNumber: number;
  sourceFinalityBlock: number;
  nonce: number;
  deadline: number;
  relayerFee: bigint;
  recipientStealthMetadataHash: string; // 64-char hex, no 0x prefix
  memoHash: string; // 64-char hex, no 0x prefix
  reserved0: string; // 64-char hex, no 0x prefix
  reserved1: string; // 64-char hex, no 0x prefix
}

export interface BridgeMessageValidationError {
  field: string;
  code: string;
  message: string;
}

const BRIDGE_MESSAGE_BYTES32_FIELDS = [
  'canonicalAssetId',
  'sourceLocalAssetId',
  'destinationLocalAssetId',
  'sourceNullifierHash',
  'destinationCommitment',
  'sourceRoot',
  'sourceTxHash',
  'recipientStealthMetadataHash',
  'memoHash',
  'reserved0',
  'reserved1',
] as const;

const BRIDGE_MESSAGE_UINT64_JSON_FIELDS = [
  'sourceChainId',
  'destinationChainId',
  'sourceLeafIndex',
  'sourceBlockNumber',
  'sourceFinalityBlock',
  'nonce',
  'deadline',
] as const;

const BRIDGE_MESSAGE_UINT128_JSON_FIELDS = ['amount', 'relayerFee'] as const;

// =============================================================================
// HELPERS
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${clean.length}`);
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function uint16ToBytes(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  const view = new DataView(buf.buffer);
  view.setUint16(0, value, false); // big-endian
  return buf;
}

function uint8ToBytes(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}

function uint32ToBytes(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, value, false); // big-endian
  return buf;
}

function uint64ToBytes(value: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt.asUintN(64, BigInt(value)), false); // big-endian
  return buf;
}

function uint128ToBytes(value: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  let v = BigInt.asUintN(128, value);
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v = v >> 8n;
  }
  return buf;
}

function normalizeBytes32(input: string): string {
  const clean = input.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean)) {
    throw new Error(`Invalid hex characters in bytes32: ${input}`);
  }
  if (clean.length !== 64) {
    throw new Error(`bytes32 must be exactly 64 hex chars, got ${clean.length}: ${input}`);
  }
  return clean;
}

function normalizeBytes32ForJson(input: unknown, field: string): string {
  if (typeof input !== 'string') {
    throw new Error(`${field} must be a bytes32 hex string`);
  }
  return '0x' + normalizeBytes32(input);
}

function parseJsonIntegerToBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'string') {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error(`${field} must be a non-negative decimal integer string`);
    }
    return BigInt(value);
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${field} must be a safe integer when encoded as a JSON number`);
    }
    if (value < 0) {
      throw new Error(`${field} must be non-negative`);
    }
    return BigInt(value);
  }

  throw new Error(`${field} must be a bigint, decimal string, or safe integer`);
}

function parseJsonIntegerToSafeNumber(value: unknown, field: string): number {
  const parsed = parseJsonIntegerToBigInt(value, field);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(parsed);
}

/**
 * Normalize a JSON-loaded BridgeMessageV1 without precision loss.
 *
 * JSON cannot represent bigint values directly, so live bridge state files store
 * uint64/uint128 fields as decimal strings. This helper parses all consensus
 * integer fields through bigint first, rejects unsafe JSON numbers, and returns
 * a BridgeMessageV1 object ready for canonical hashing/transformation.
 *
 * bytes32 fields are normalized to 0x-prefixed, lowercase 32-byte hex strings.
 */
export function parseBridgeMessageV1Json(input: unknown): BridgeMessageV1 {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('BridgeMessageV1 JSON must be an object');
  }

  const raw = input as Record<string, unknown>;
  const message: any = {
    protocolVersion: parseJsonIntegerToSafeNumber(raw.protocolVersion, 'protocolVersion'),
    messageType: parseJsonIntegerToSafeNumber(raw.messageType, 'messageType'),
    sourceDomain: parseJsonIntegerToSafeNumber(raw.sourceDomain, 'sourceDomain'),
    destinationDomain: parseJsonIntegerToSafeNumber(raw.destinationDomain, 'destinationDomain'),
  };

  for (const field of BRIDGE_MESSAGE_UINT64_JSON_FIELDS) {
    message[field] = parseJsonIntegerToSafeNumber(raw[field], field);
  }

  for (const field of BRIDGE_MESSAGE_UINT128_JSON_FIELDS) {
    message[field] = parseJsonIntegerToBigInt(raw[field], field);
  }

  for (const field of BRIDGE_MESSAGE_BYTES32_FIELDS) {
    message[field] = normalizeBytes32ForJson(raw[field], field);
  }

  return message as BridgeMessageV1;
}

/**
 * JSON.stringify replacer for BridgeMessageV1 objects containing bigint fields.
 */
export function bridgeMessageV1JsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

// =============================================================================
// ENCODING
// =============================================================================

/**
 * Encode a BridgeMessageV1 into a fixed-length Uint8Array (451 bytes).
 * Throws on invalid input.
 */
export function encodeBridgeMessageV1(message: BridgeMessageV1): Uint8Array {
  // Validate before encoding
  const errors = validateBridgeMessageV1(message);
  if (errors.length > 0) {
    throw new Error(
      `BridgeMessageV1 validation failed: ${errors.map(e => `${e.field}: ${e.message}`).join(', ')}`
    );
  }

  const parts: Uint8Array[] = [];

  parts.push(uint16ToBytes(message.protocolVersion));
  parts.push(uint8ToBytes(message.messageType));
  parts.push(uint32ToBytes(message.sourceDomain));
  parts.push(uint32ToBytes(message.destinationDomain));
  parts.push(uint64ToBytes(message.sourceChainId));
  parts.push(uint64ToBytes(message.destinationChainId));
  parts.push(hexToBytes(normalizeBytes32(message.canonicalAssetId)));
  parts.push(hexToBytes(normalizeBytes32(message.sourceLocalAssetId)));
  parts.push(hexToBytes(normalizeBytes32(message.destinationLocalAssetId)));
  parts.push(uint128ToBytes(message.amount));
  parts.push(hexToBytes(normalizeBytes32(message.sourceNullifierHash)));
  parts.push(hexToBytes(normalizeBytes32(message.destinationCommitment)));
  parts.push(hexToBytes(normalizeBytes32(message.sourceRoot)));
  parts.push(uint64ToBytes(message.sourceLeafIndex));
  parts.push(hexToBytes(normalizeBytes32(message.sourceTxHash)));
  parts.push(uint64ToBytes(message.sourceBlockNumber));
  parts.push(uint64ToBytes(message.sourceFinalityBlock));
  parts.push(uint64ToBytes(message.nonce));
  parts.push(uint64ToBytes(message.deadline));
  parts.push(uint128ToBytes(message.relayerFee));
  parts.push(hexToBytes(normalizeBytes32(message.recipientStealthMetadataHash)));
  parts.push(hexToBytes(normalizeBytes32(message.memoHash)));
  parts.push(hexToBytes(normalizeBytes32(message.reserved0)));
  parts.push(hexToBytes(normalizeBytes32(message.reserved1)));

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  if (totalLength !== BRIDGE_MESSAGE_ENCODED_LENGTH) {
    throw new Error(
      `Encoded length mismatch: expected ${BRIDGE_MESSAGE_ENCODED_LENGTH}, got ${totalLength}`
    );
  }

  const encoded = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    encoded.set(part, offset);
    offset += part.length;
  }

  return encoded;
}

// =============================================================================
// HASHING
// =============================================================================

/**
 * Compute the canonical keccak256 hash of a BridgeMessageV1.
 *
 * Hash = keccak256(domainSeparator || encodedMessage)
 *
 * This is the exact hash that threshold signers sign.
 */
export function hashBridgeMessageV1(message: BridgeMessageV1): string {
  const encoded = encodeBridgeMessageV1(message);
  const domainBytes = new TextEncoder().encode(BRIDGE_MESSAGE_DOMAIN_SEPARATOR);

  const combined = new Uint8Array(domainBytes.length + encoded.length);
  combined.set(domainBytes, 0);
  combined.set(encoded, domainBytes.length);

  const hash = keccak_256(combined);
  return '0x' + bytesToHex(hash);
}

/**
 * Hash an already-encoded message buffer.
 */
export function hashEncodedBridgeMessageV1(encoded: Uint8Array): string {
  const domainBytes = new TextEncoder().encode(BRIDGE_MESSAGE_DOMAIN_SEPARATOR);
  const combined = new Uint8Array(domainBytes.length + encoded.length);
  combined.set(domainBytes, 0);
  combined.set(encoded, domainBytes.length);
  const hash = keccak_256(combined);
  return '0x' + bytesToHex(hash);
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate a BridgeMessageV1 without throwing.
 * Returns an array of validation errors (empty if valid).
 */
export function validateBridgeMessageV1(
  message: BridgeMessageV1
): BridgeMessageValidationError[] {
  const errors: BridgeMessageValidationError[] = [];

  function addError(field: string, code: string, msg: string) {
    errors.push({ field, code, message: msg });
  }

  // protocolVersion
  if (message.protocolVersion !== 1) {
    addError('protocolVersion', 'INVALID_VERSION', 'protocolVersion must be 1');
  }

  // messageType
  if (message.messageType !== BridgeMessageType.BridgeOut && message.messageType !== BridgeMessageType.BridgeMint) {
    addError('messageType', 'INVALID_MESSAGE_TYPE', 'messageType must be 1 (BridgeOut) or 2 (BridgeMint)');
  }

  // sourceDomain
  if (message.sourceDomain === 0) {
    addError('sourceDomain', 'ZERO_DOMAIN', 'sourceDomain cannot be 0');
  }

  // destinationDomain
  if (message.destinationDomain === 0) {
    addError('destinationDomain', 'ZERO_DOMAIN', 'destinationDomain cannot be 0');
  }

  if (message.sourceDomain === message.destinationDomain) {
    addError('destinationDomain', 'SAME_DOMAIN', 'sourceDomain and destinationDomain must be different');
  }

  // sourceChainId / destinationChainId
  if (message.sourceChainId < 0) {
    addError('sourceChainId', 'NEGATIVE', 'sourceChainId cannot be negative');
  }
  if (message.destinationChainId < 0) {
    addError('destinationChainId', 'NEGATIVE', 'destinationChainId cannot be negative');
  }

  // bytes32 fields
  const bytes32Fields: Array<[string, string]> = [
    ['canonicalAssetId', message.canonicalAssetId],
    ['sourceLocalAssetId', message.sourceLocalAssetId],
    ['destinationLocalAssetId', message.destinationLocalAssetId],
    ['sourceNullifierHash', message.sourceNullifierHash],
    ['destinationCommitment', message.destinationCommitment],
    ['sourceRoot', message.sourceRoot],
    ['sourceTxHash', message.sourceTxHash],
    ['recipientStealthMetadataHash', message.recipientStealthMetadataHash],
    ['memoHash', message.memoHash],
    ['reserved0', message.reserved0],
    ['reserved1', message.reserved1],
  ];

  for (const [field, value] of bytes32Fields) {
    try {
      normalizeBytes32(value);
    } catch (err: any) {
      addError(field, 'INVALID_BYTES32', err.message);
    }
  }

  // canonicalAssetId cannot be zero
  if (normalizeBytes32(message.canonicalAssetId) === '0'.repeat(64)) {
    addError('canonicalAssetId', 'ZERO_ASSET', 'canonicalAssetId cannot be zero');
  }

  // destinationCommitment cannot be zero for BridgeOut
  if (
    message.messageType === BridgeMessageType.BridgeOut &&
    normalizeBytes32(message.destinationCommitment) === '0'.repeat(64)
  ) {
    addError('destinationCommitment', 'ZERO_COMMITMENT', 'destinationCommitment cannot be zero for BridgeOut');
  }

  // sourceNullifierHash cannot be zero for BridgeOut
  if (
    message.messageType === BridgeMessageType.BridgeOut &&
    normalizeBytes32(message.sourceNullifierHash) === '0'.repeat(64)
  ) {
    addError('sourceNullifierHash', 'ZERO_NULLIFIER', 'sourceNullifierHash cannot be zero for BridgeOut');
  }

  // amount
  if (message.amount <= 0n) {
    addError('amount', 'NON_POSITIVE', 'amount must be greater than 0');
  }
  if (message.amount > (1n << 128n) - 1n) {
    addError('amount', 'UINT128_OVERFLOW', 'amount exceeds uint128 max');
  }

  // relayerFee
  if (message.relayerFee < 0n) {
    addError('relayerFee', 'NEGATIVE', 'relayerFee cannot be negative');
  }
  if (message.relayerFee > (1n << 128n) - 1n) {
    addError('relayerFee', 'UINT128_OVERFLOW', 'relayerFee exceeds uint128 max');
  }

  // deadline
  if (message.deadline === 0) {
    addError('deadline', 'ZERO_DEADLINE', 'deadline cannot be 0');
  }

  // nonce
  if (message.nonce < 0) {
    addError('nonce', 'NEGATIVE', 'nonce cannot be negative');
  }

  // sourceLeafIndex
  if (message.sourceLeafIndex < 0) {
    addError('sourceLeafIndex', 'NEGATIVE', 'sourceLeafIndex cannot be negative');
  }

  // sourceBlockNumber / sourceFinalityBlock
  if (message.sourceBlockNumber < 0) {
    addError('sourceBlockNumber', 'NEGATIVE', 'sourceBlockNumber cannot be negative');
  }
  if (message.sourceFinalityBlock < 0) {
    addError('sourceFinalityBlock', 'NEGATIVE', 'sourceFinalityBlock cannot be negative');
  }
  if (message.sourceFinalityBlock < message.sourceBlockNumber) {
    addError('sourceFinalityBlock', 'INVALID_FINALITY', 'sourceFinalityBlock must be >= sourceBlockNumber');
  }

  return errors;
}

/**
 * Strict validation: throws if message is invalid.
 */
export function assertValidBridgeMessageV1(message: BridgeMessageV1): void {
  const errors = validateBridgeMessageV1(message);
  if (errors.length > 0) {
    throw new Error(
      `Invalid BridgeMessageV1:\n${errors.map(e => `  [${e.code}] ${e.field}: ${e.message}`).join('\n')}`
    );
  }
}
