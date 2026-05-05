/**
 * Solana Bridge Adapter Tests — PR-010F
 */

import { PublicKey } from '@solana/web3.js';
import {
  WHITE_PROTOCOL_PROGRAM_ID,
  deriveBridgeV1ConfigPDA,
  deriveBridgeSignerSetPDA,
  deriveConsumedMessagePDA,
  deriveFrozenMessagePDA,
  deriveBridgeRoutePDA,
  deriveBridgeAssetPDA,
  derivePendingBufferPDA,
  deriveCommitmentIndexPDA,
} from '../solana-adapter';

describe('Solana Bridge PDA Derivation', () => {
  test('deriveBridgeV1ConfigPDA is deterministic', () => {
    const pda1 = deriveBridgeV1ConfigPDA();
    const pda2 = deriveBridgeV1ConfigPDA();
    expect(pda1.toBase58()).toBe(pda2.toBase58());
    expect(pda1.toBase58()).not.toBe(WHITE_PROTOCOL_PROGRAM_ID.toBase58());
  });

  test('deriveBridgeSignerSetPDA varies by version', () => {
    const pda1 = deriveBridgeSignerSetPDA(1);
    const pda2 = deriveBridgeSignerSetPDA(2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('deriveConsumedMessagePDA varies by hash', () => {
    const hash1 = new Uint8Array(32).fill(1);
    const hash2 = new Uint8Array(32).fill(2);
    const pda1 = deriveConsumedMessagePDA(hash1);
    const pda2 = deriveConsumedMessagePDA(hash2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('deriveBridgeRoutePDA varies by domains', () => {
    const pda1 = deriveBridgeRoutePDA(33554434, 33554435);
    const pda2 = deriveBridgeRoutePDA(33554434, 33554436);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('derivePendingBufferPDA varies by pool', () => {
    // Use valid base58-encoded public keys
    const pool1 = new PublicKey('5oNDL3swdJJF1g9DzJiZ4ynHXgszjpmunRaFsXq3VyhM');
    const pool2 = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    const pda1 = derivePendingBufferPDA(pool1);
    const pda2 = derivePendingBufferPDA(pool2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('deriveCommitmentIndexPDA varies by commitment', () => {
    const pool = new PublicKey('11111111111111111111111111111111');
    const c1 = new Uint8Array(32).fill(1);
    const c2 = new Uint8Array(32).fill(2);
    const pda1 = deriveCommitmentIndexPDA(pool, c1);
    const pda2 = deriveCommitmentIndexPDA(pool, c2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });

  test('all PDAs are valid program addresses', () => {
    const pda = deriveBridgeV1ConfigPDA();
    expect(PublicKey.isOnCurve(pda.toBytes())).toBe(false);
  });
});

describe('SolanaDestinationAdapter', () => {
  test('isMessageConsumed returns false (skeleton)', async () => {
    const { SolanaDestinationAdapter } = await import('../solana-adapter');
    const adapter = new SolanaDestinationAdapter();
    const result = await adapter.isMessageConsumed('0xabc');
    expect(result).toBe(false);
  });

  test('submitAcceptBridgeMint throws not implemented', async () => {
    const { SolanaDestinationAdapter } = await import('../solana-adapter');
    const adapter = new SolanaDestinationAdapter();
    await expect(
      adapter.submitAcceptBridgeMint({} as any, [], 1)
    ).rejects.toThrow('Solana bridge submission is not yet implemented');
  });
});
