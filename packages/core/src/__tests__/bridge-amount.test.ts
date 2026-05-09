import { describe, it, expect } from 'vitest';
import {
  normalizeBridgeAmount,
  validateNormalizationParams,
  buildDestinationBridgeMintMessageFromSourceBridgeOut,
  BridgeAmountError,
  type NormalizeBridgeAmountParams,
} from '../bridge-amount.js';
import { BridgeMessageType, hashBridgeMessageV1 } from '../bridge-message.js';

function makeBridgeOutMessage(overrides: Partial<{
  amount: bigint;
  sourceNullifierHash: string;
  destinationCommitment: string;
  sourceRoot: string;
  sourceLeafIndex: number;
  nonce: number;
}> = {}): any {
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 0x02000002,
    destinationDomain: 0x01000002,
    sourceChainId: 84532,
    destinationChainId: 0,
    canonicalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    sourceLocalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    amount: overrides.amount ?? 1_000_000_000_000_000_000n,
    sourceNullifierHash: overrides.sourceNullifierHash ?? '050caaf379f71b871b696b19218423e6cb10c1d6f2d727dfab3dea42d14e0ddd',
    destinationCommitment: overrides.destinationCommitment ?? '042d8eaee960c3eebb49894566b2195ee94f55ec35d33d2ca4e1c085174480f2',
    sourceRoot: overrides.sourceRoot ?? '2e033d72f3f8500ae9a5c487e8f47eb80cc21fca004fbbbd683e27968b0f8671',
    sourceLeafIndex: overrides.sourceLeafIndex ?? 24,
    sourceTxHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sourceBlockNumber: 41116285,
    sourceFinalityBlock: 41116295,
    nonce: overrides.nonce ?? 3,
    deadline: 1778004486,
    relayerFee: 0n,
    recipientStealthMetadataHash: '0000000000000000000000000000000000000000000000000000000000000000',
    memoHash: '0000000000000000000000000000000000000000000000000000000000000000',
    reserved0: '0000000000000000000000000000000000000000000000000000000000000000',
    reserved1: '0000000000000000000000000000000000000000000000000000000000000000',
  };
}

describe('normalizeBridgeAmount', () => {
  it('18 -> 9 exact downscale', () => {
    const result = normalizeBridgeAmount({
      sourceAmount: 1_000_000_000_000_000_000n,
      sourceDecimals: 18,
      destinationDecimals: 9,
      mode: 'exact-decimal',
    });
    expect(result).toBe(1_000_000_000n);
  });

  it('18 -> 9 exact downscale (0.001 ETH -> 0.001 wSOL)', () => {
    const result = normalizeBridgeAmount({
      sourceAmount: 1_000_000_000_000_000n,
      sourceDecimals: 18,
      destinationDecimals: 9,
      mode: 'exact-decimal',
    });
    expect(result).toBe(1_000_000n);
  });

  it('9 -> 18 exact upscale', () => {
    const result = normalizeBridgeAmount({
      sourceAmount: 1_000_000_000n,
      sourceDecimals: 9,
      destinationDecimals: 18,
      mode: 'exact-decimal',
    });
    expect(result).toBe(1_000_000_000_000_000_000n);
  });

  it('9 -> 18 exact upscale (0.001 wSOL -> 0.001 ETH units)', () => {
    const result = normalizeBridgeAmount({
      sourceAmount: 1_000_000n,
      sourceDecimals: 9,
      destinationDecimals: 18,
      mode: 'exact-decimal',
    });
    expect(result).toBe(1_000_000_000_000_000n);
  });

  it('18 -> 18 unchanged', () => {
    const result = normalizeBridgeAmount({
      sourceAmount: 1_000_000_000_000_000_000n,
      sourceDecimals: 18,
      destinationDecimals: 18,
      mode: 'exact-decimal',
    });
    expect(result).toBe(1_000_000_000_000_000_000n);
  });

  it('rejects non-divisible downscale', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: 18,
        destinationDecimals: 9,
        mode: 'exact-decimal',
      })
    ).toThrow(BridgeAmountError);
  });

  it('rejects the PR-010W non-divisible 18 -> 9 amount', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1_000_000_000_000_001n,
        sourceDecimals: 18,
        destinationDecimals: 9,
        mode: 'exact-decimal',
      })
    ).toThrow('is not divisible by 10^9');
  });

  it('rejects zero source amount', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 0n,
        sourceDecimals: 18,
        destinationDecimals: 9,
        mode: 'exact-decimal',
      })
    ).toThrow('sourceAmount must be > 0');
  });

  it('rejects negative decimals', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: -1,
        destinationDecimals: 9,
        mode: 'exact-decimal',
      })
    ).toThrow('decimals must be >= 0');
  });

  it('rejects missing decimals', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: undefined as any,
        destinationDecimals: 9,
        mode: 'exact-decimal',
      })
    ).toThrow('required integer values');
  });

  it('rejects non-integer decimals', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: 18.5,
        destinationDecimals: 9,
        mode: 'exact-decimal',
      })
    ).toThrow('required integer values');
  });

  it('rejects overflow on upscale', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: (1n << 128n) - 1n,
        sourceDecimals: 9,
        destinationDecimals: 18,
        mode: 'exact-decimal',
      })
    ).toThrow('normalized amount exceeds uint128 max');
  });

  it('fixed-rate exact conversion', () => {
    const result = normalizeBridgeAmount({
      sourceAmount: 1_000_000n,
      sourceDecimals: 6,
      destinationDecimals: 6,
      mode: 'fixed-rate',
      rateNumerator: 5n,
      rateDenominator: 2n,
    });
    expect(result).toBe(2_500_000n);
  });

  it('fixed-rate rejects non-divisible', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: 6,
        destinationDecimals: 6,
        mode: 'fixed-rate',
        rateNumerator: 5n,
        rateDenominator: 2n,
      })
    ).toThrow('is not divisible by rateDenominator');
  });

  it('fixed-rate rejects missing rate params', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: 6,
        destinationDecimals: 6,
        mode: 'fixed-rate',
      })
    ).toThrow('fixed-rate mode requires rateNumerator and rateDenominator');
  });

  it('fixed-rate rejects zero numerator', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: 6,
        destinationDecimals: 6,
        mode: 'fixed-rate',
        rateNumerator: 0n,
        rateDenominator: 1n,
      })
    ).toThrow('rateNumerator must be > 0');
  });

  it('fixed-rate rejects zero denominator', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: 6,
        destinationDecimals: 6,
        mode: 'fixed-rate',
        rateNumerator: 1n,
        rateDenominator: 0n,
      })
    ).toThrow('rateDenominator must be > 0');
  });

  it('rejects unknown mode', () => {
    expect(() =>
      normalizeBridgeAmount({
        sourceAmount: 1n,
        sourceDecimals: 18,
        destinationDecimals: 9,
        mode: 'unknown' as any,
      })
    ).toThrow('unknown normalization mode');
  });
});

describe('validateNormalizationParams', () => {
  it('returns empty array for valid params', () => {
    const errors = validateNormalizationParams({
      sourceAmount: 1_000_000_000n,
      sourceDecimals: 9,
      destinationDecimals: 18,
      mode: 'exact-decimal',
    });
    expect(errors).toHaveLength(0);
  });

  it('returns errors for invalid params without throwing', () => {
    const errors = validateNormalizationParams({
      sourceAmount: 1n,
      sourceDecimals: 18,
      destinationDecimals: 9,
      mode: 'exact-decimal',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe('NON_DIVISIBLE');
  });
});

describe('buildDestinationBridgeMintMessageFromSourceBridgeOut', () => {
  it('produces BridgeMint with normalized amount (18 -> 9)', () => {
    const sourceMessage = makeBridgeOutMessage({ amount: 1_000_000_000_000_000_000n });
    const mintMessage = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage,
      destinationDomain: 0x01000002,
      destinationChainId: 0,
      destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
      destinationCommitment: '12df7d83bf11de32035547b40563fe277a0a69111907b0971bd35223cb051c67',
      sourceDecimals: 18,
      destinationDecimals: 9,
      normalizationMode: 'exact-decimal',
    });

    expect(mintMessage.messageType).toBe(BridgeMessageType.BridgeMint);
    expect(mintMessage.amount).toBe(1_000_000_000n);
    expect(mintMessage.sourceNullifierHash).toBe(sourceMessage.sourceNullifierHash);
    expect(mintMessage.sourceRoot).toBe(sourceMessage.sourceRoot);
    expect(mintMessage.sourceLeafIndex).toBe(sourceMessage.sourceLeafIndex);
    expect(mintMessage.destinationCommitment).toBe('12df7d83bf11de32035547b40563fe277a0a69111907b0971bd35223cb051c67');
  });

  it('produces BridgeMint with normalized amount (0.001 ETH -> 0.001 wSOL)', () => {
    const sourceMessage = makeBridgeOutMessage({ amount: 1_000_000_000_000_000n });
    const mintMessage = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage,
      destinationDomain: 0x01000002,
      destinationChainId: 0,
      destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
      destinationCommitment: '12df7d83bf11de32035547b40563fe277a0a69111907b0971bd35223cb051c67',
      sourceDecimals: 18,
      destinationDecimals: 9,
      normalizationMode: 'exact-decimal',
    });

    expect(mintMessage.amount).toBe(1_000_000n);
  });

  it('preserves source fields', () => {
    const sourceMessage = makeBridgeOutMessage({
      amount: 1_000_000_000_000_000_000n,
      sourceNullifierHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceRoot: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceLeafIndex: 42,
      nonce: 7,
    });

    const mintMessage = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage,
      destinationDomain: 0x01000002,
      destinationChainId: 0,
      destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
      destinationCommitment: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      sourceDecimals: 18,
      destinationDecimals: 18,
      normalizationMode: 'exact-decimal',
    });

    expect(mintMessage.sourceNullifierHash).toBe(sourceMessage.sourceNullifierHash);
    expect(mintMessage.sourceRoot).toBe(sourceMessage.sourceRoot);
    expect(mintMessage.sourceLeafIndex).toBe(sourceMessage.sourceLeafIndex);
    expect(mintMessage.nonce).toBe(sourceMessage.nonce);
    expect(mintMessage.sourceDomain).toBe(sourceMessage.sourceDomain);
    expect(mintMessage.sourceChainId).toBe(sourceMessage.sourceChainId);
    expect(mintMessage.sourceTxHash).toBe(sourceMessage.sourceTxHash);
    expect(mintMessage.sourceBlockNumber).toBe(sourceMessage.sourceBlockNumber);
    expect(mintMessage.sourceFinalityBlock).toBe(sourceMessage.sourceFinalityBlock);
    expect(mintMessage.canonicalAssetId).toBe(sourceMessage.canonicalAssetId);
    expect(mintMessage.sourceLocalAssetId).toBe(sourceMessage.sourceLocalAssetId);
  });

  it('hash changes when amount changes', () => {
    const sourceMessage = makeBridgeOutMessage({ amount: 1_000_000_000_000_000_000n });

    const mint1 = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage,
      destinationDomain: 0x01000002,
      destinationChainId: 0,
      destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
      destinationCommitment: '12df7d83bf11de32035547b40563fe277a0a69111907b0971bd35223cb051c67',
      sourceDecimals: 18,
      destinationDecimals: 9,
      normalizationMode: 'exact-decimal',
    });

    const mint2 = buildDestinationBridgeMintMessageFromSourceBridgeOut({
      sourceMessage: { ...sourceMessage, amount: 2_000_000_000_000_000_000n },
      destinationDomain: 0x01000002,
      destinationChainId: 0,
      destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
      destinationCommitment: '12df7d83bf11de32035547b40563fe277a0a69111907b0971bd35223cb051c67',
      sourceDecimals: 18,
      destinationDecimals: 9,
      normalizationMode: 'exact-decimal',
    });

    const hash1 = hashBridgeMessageV1(mint1);
    const hash2 = hashBridgeMessageV1(mint2);
    expect(hash1).not.toBe(hash2);
  });

  it('rejects non-BridgeOut source message', () => {
    const sourceMessage = makeBridgeOutMessage();
    sourceMessage.messageType = BridgeMessageType.BridgeMint;

    expect(() =>
      buildDestinationBridgeMintMessageFromSourceBridgeOut({
        sourceMessage,
        destinationDomain: 0x01000002,
        destinationChainId: 0,
        destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
        destinationCommitment: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        sourceDecimals: 18,
        destinationDecimals: 9,
        normalizationMode: 'exact-decimal',
      })
    ).toThrow('expected BridgeOut');
  });

  it('rejects invalid source message', () => {
    const sourceMessage = makeBridgeOutMessage();
    sourceMessage.amount = 0n;

    expect(() =>
      buildDestinationBridgeMintMessageFromSourceBridgeOut({
        sourceMessage,
        destinationDomain: 0x01000002,
        destinationChainId: 0,
        destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
        destinationCommitment: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        sourceDecimals: 18,
        destinationDecimals: 9,
        normalizationMode: 'exact-decimal',
      })
    ).toThrow('sourceMessage validation failed');
  });

  it('rejects non-divisible conversion', () => {
    const sourceMessage = makeBridgeOutMessage({ amount: 1n });

    expect(() =>
      buildDestinationBridgeMintMessageFromSourceBridgeOut({
        sourceMessage,
        destinationDomain: 0x01000002,
        destinationChainId: 0,
        destinationLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
        destinationCommitment: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        sourceDecimals: 18,
        destinationDecimals: 9,
        normalizationMode: 'exact-decimal',
      })
    ).toThrow('is not divisible by 10^9');
  });
});
