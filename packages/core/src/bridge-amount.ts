/**
 * Bridge Amount Normalization — PR-010V
 *
 * Deterministic cross-decimal amount conversion for BridgeMessageV1.
 *
 * Semantics:
 * - BridgeOut.message.amount  = source-local units (e.g. wei for ETH)
 * - BridgeMint.message.amount = destination-local units (e.g. lamports for wSOL)
 * - Conversion is exact; non-exact down-scales are rejected.
 * - No silent rounding.
 *
 * Modes:
 * - exact-decimal:  divide or multiply by 10^(delta) based on decimal diff.
 * - fixed-rate:     apply an explicit rate numerator/denominator (test-only).
 */

import {
  BridgeMessageV1,
  BridgeMessageType,
  validateBridgeMessageV1,
} from './bridge-message.js';

// =============================================================================
// TYPES
// =============================================================================

export type NormalizationMode = 'exact-decimal' | 'fixed-rate';

export interface NormalizeBridgeAmountParams {
  /** Amount in source-local units */
  sourceAmount: bigint;
  /** Decimals of the source token (e.g. 18 for ETH) */
  sourceDecimals: number;
  /** Decimals of the destination token (e.g. 9 for wSOL) */
  destinationDecimals: number;
  /** Conversion mode */
  mode: NormalizationMode;
  /** Rate numerator (only for fixed-rate) */
  rateNumerator?: bigint;
  /** Rate denominator (only for fixed-rate) */
  rateDenominator?: bigint;
}

export interface BridgeAmountNormalizationError {
  code: string;
  message: string;
}

export interface BuildBridgeMintParams {
  /** The original BridgeOut message observed on the source chain */
  sourceMessage: BridgeMessageV1;
  /** Destination domain ID */
  destinationDomain: number;
  /** Destination chain ID */
  destinationChainId: number;
  /** Destination-local asset ID (64-char hex, no 0x prefix) */
  destinationLocalAssetId: string;
  /** Destination commitment (already computed with destination-local amount) */
  destinationCommitment: string;
  /** Source token decimals */
  sourceDecimals: number;
  /** Destination token decimals */
  destinationDecimals: number;
  /** Conversion mode */
  normalizationMode: NormalizationMode;
  /** Rate numerator (only for fixed-rate) */
  rateNumerator?: bigint;
  /** Rate denominator (only for fixed-rate) */
  rateDenominator?: bigint;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_UINT128 = (1n << 128n) - 1n;

// =============================================================================
// NORMALIZATION
// =============================================================================

/**
 * Normalize a bridge amount from source-local units to destination-local units.
 *
 * exact-decimal formula:
 *   sourceDecimals > destinationDecimals:
 *     factor = 10^(sourceDecimals - destinationDecimals)
 *     require sourceAmount % factor == 0
 *     destAmount = sourceAmount / factor
 *   sourceDecimals < destinationDecimals:
 *     factor = 10^(destinationDecimals - sourceDecimals)
 *     destAmount = sourceAmount * factor
 *   sourceDecimals == destinationDecimals:
 *     destAmount = sourceAmount
 *
 * fixed-rate formula:
 *   destAmount = sourceAmount * rateNumerator / rateDenominator
 *   require sourceAmount * rateNumerator % rateDenominator == 0
 *
 * Returns the destination amount, or throws on invalid input.
 */
export function normalizeBridgeAmount(params: NormalizeBridgeAmountParams): bigint {
  const {
    sourceAmount,
    sourceDecimals,
    destinationDecimals,
    mode,
    rateNumerator,
    rateDenominator,
  } = params;

  // Basic validation
  if (typeof sourceAmount !== 'bigint') {
    throw new BridgeAmountError('INVALID_AMOUNT', 'sourceAmount must be a bigint');
  }
  if (sourceAmount <= 0n) {
    throw new BridgeAmountError('INVALID_AMOUNT', 'sourceAmount must be > 0');
  }
  if (!Number.isInteger(sourceDecimals) || !Number.isInteger(destinationDecimals)) {
    throw new BridgeAmountError(
      'INVALID_DECIMALS',
      'sourceDecimals and destinationDecimals are required integer values'
    );
  }
  if (sourceDecimals < 0 || destinationDecimals < 0) {
    throw new BridgeAmountError('INVALID_DECIMALS', 'decimals must be >= 0');
  }
  if (sourceDecimals > 255 || destinationDecimals > 255) {
    throw new BridgeAmountError('INVALID_DECIMALS', 'decimals must be <= 255');
  }

  let destAmount: bigint;

  if (mode === 'exact-decimal') {
    destAmount = normalizeExactDecimal(sourceAmount, sourceDecimals, destinationDecimals);
  } else if (mode === 'fixed-rate') {
    if (rateNumerator === undefined || rateDenominator === undefined) {
      throw new BridgeAmountError('MISSING_RATE', 'fixed-rate mode requires rateNumerator and rateDenominator');
    }
    if (typeof rateNumerator !== 'bigint' || typeof rateDenominator !== 'bigint') {
      throw new BridgeAmountError('INVALID_RATE', 'rateNumerator and rateDenominator must be bigint values');
    }
    if (rateNumerator <= 0n) {
      throw new BridgeAmountError('INVALID_RATE', 'rateNumerator must be > 0');
    }
    if (rateDenominator <= 0n) {
      throw new BridgeAmountError('INVALID_RATE', 'rateDenominator must be > 0');
    }
    destAmount = normalizeFixedRate(sourceAmount, rateNumerator, rateDenominator);
  } else {
    throw new BridgeAmountError('INVALID_MODE', `unknown normalization mode: ${mode}`);
  }

  if (destAmount <= 0n) {
    throw new BridgeAmountError('AMOUNT_ZERO', 'normalized amount would be zero');
  }
  if (destAmount > MAX_UINT128) {
    throw new BridgeAmountError('UINT128_OVERFLOW', 'normalized amount exceeds uint128 max');
  }

  return destAmount;
}

function normalizeExactDecimal(
  sourceAmount: bigint,
  sourceDecimals: number,
  destinationDecimals: number
): bigint {
  if (sourceDecimals === destinationDecimals) {
    return sourceAmount;
  }

  if (sourceDecimals > destinationDecimals) {
    const diff = sourceDecimals - destinationDecimals;
    const factor = 10n ** BigInt(diff);
    if (sourceAmount % factor !== 0n) {
      throw new BridgeAmountError(
        'NON_DIVISIBLE',
        `sourceAmount ${sourceAmount} is not divisible by 10^${diff} ` +
        `(down-scaling from ${sourceDecimals} to ${destinationDecimals} decimals)`
      );
    }
    return sourceAmount / factor;
  }

  // sourceDecimals < destinationDecimals
  const diff = destinationDecimals - sourceDecimals;
  const factor = 10n ** BigInt(diff);
  return sourceAmount * factor;
}

function normalizeFixedRate(
  sourceAmount: bigint,
  rateNumerator: bigint,
  rateDenominator: bigint
): bigint {
  const scaled = sourceAmount * rateNumerator;
  if (scaled % rateDenominator !== 0n) {
    throw new BridgeAmountError(
      'NON_DIVISIBLE_RATE',
      `sourceAmount * rateNumerator (${scaled}) is not divisible by rateDenominator (${rateDenominator})`
    );
  }
  return scaled / rateDenominator;
}

/**
 * Validate normalization parameters without throwing.
 * Returns an empty array if valid, otherwise an array of errors.
 */
export function validateNormalizationParams(
  params: NormalizeBridgeAmountParams
): BridgeAmountNormalizationError[] {
  const errors: BridgeAmountNormalizationError[] = [];
  try {
    normalizeBridgeAmount(params);
  } catch (err: any) {
    if (err instanceof BridgeAmountError) {
      errors.push({ code: err.code, message: err.message });
    } else {
      errors.push({ code: 'UNKNOWN', message: err.message || String(err) });
    }
  }
  return errors;
}

// =============================================================================
// BRIDGE MINT MESSAGE BUILDER
// =============================================================================

/**
 * Build a BridgeMint message from a source BridgeOut message,
 * applying deterministic amount normalization.
 *
 * The returned message:
 * - has messageType = BridgeMint
 * - preserves sourceNullifierHash, sourceRoot, sourceLeafIndex
 * - preserves source domain / chain / tx metadata
 * - sets destination domain / chain / local asset from params
 * - computes destination amount via normalizeBridgeAmount
 * - uses the provided destinationCommitment (must be pre-computed with dest amount)
 *
 * Throws if the source message is not a valid BridgeOut,
 * or if amount normalization fails.
 */
export function buildDestinationBridgeMintMessageFromSourceBridgeOut(
  params: BuildBridgeMintParams
): BridgeMessageV1 {
  const {
    sourceMessage,
    destinationDomain,
    destinationChainId,
    destinationLocalAssetId,
    destinationCommitment,
    sourceDecimals,
    destinationDecimals,
    normalizationMode,
    rateNumerator,
    rateDenominator,
  } = params;

  // Validate source message
  const validationErrors = validateBridgeMessageV1(sourceMessage);
  if (validationErrors.length > 0) {
    throw new BridgeAmountError(
      'INVALID_SOURCE_MESSAGE',
      `sourceMessage validation failed: ${validationErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`
    );
  }

  if (sourceMessage.messageType !== BridgeMessageType.BridgeOut) {
    throw new BridgeAmountError(
      'INVALID_MESSAGE_TYPE',
      `expected BridgeOut (type=1), got type=${sourceMessage.messageType}`
    );
  }

  // Normalize amount
  const destAmount = normalizeBridgeAmount({
    sourceAmount: sourceMessage.amount,
    sourceDecimals,
    destinationDecimals,
    mode: normalizationMode,
    rateNumerator,
    rateDenominator,
  });

  const mintMessage: BridgeMessageV1 = {
    protocolVersion: sourceMessage.protocolVersion,
    messageType: BridgeMessageType.BridgeMint,
    sourceDomain: sourceMessage.sourceDomain,
    destinationDomain,
    sourceChainId: sourceMessage.sourceChainId,
    destinationChainId,
    canonicalAssetId: sourceMessage.canonicalAssetId,
    sourceLocalAssetId: sourceMessage.sourceLocalAssetId,
    destinationLocalAssetId,
    amount: destAmount,
    sourceNullifierHash: sourceMessage.sourceNullifierHash,
    destinationCommitment,
    sourceRoot: sourceMessage.sourceRoot,
    sourceLeafIndex: sourceMessage.sourceLeafIndex,
    sourceTxHash: sourceMessage.sourceTxHash,
    sourceBlockNumber: sourceMessage.sourceBlockNumber,
    sourceFinalityBlock: sourceMessage.sourceFinalityBlock,
    nonce: sourceMessage.nonce,
    deadline: sourceMessage.deadline,
    relayerFee: sourceMessage.relayerFee,
    recipientStealthMetadataHash: sourceMessage.recipientStealthMetadataHash,
    memoHash: sourceMessage.memoHash,
    reserved0: sourceMessage.reserved0,
    reserved1: sourceMessage.reserved1,
  };

  const mintValidationErrors = validateBridgeMessageV1(mintMessage);
  if (mintValidationErrors.length > 0) {
    throw new BridgeAmountError(
      'INVALID_DESTINATION_MESSAGE',
      `BridgeMint validation failed: ${mintValidationErrors.map(e => `${e.field}: ${e.message}`).join(', ')}`
    );
  }

  return mintMessage;
}

// =============================================================================
// ERRORS
// =============================================================================

export class BridgeAmountError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'BridgeAmountError';
  }
}
