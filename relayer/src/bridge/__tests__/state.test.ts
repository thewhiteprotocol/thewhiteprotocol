/**
 * Bridge State Store Tests — PR-010F
 */

import * as os from 'os';
import * as path from 'path';
import { BridgeStateStore } from '../state';
import { BridgeMessageStatus, type BridgeMessageState } from '../types';

describe('BridgeStateStore', () => {
  let store: BridgeStateStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bridge-state-test-${Date.now()}-${Math.random()}`);
    store = new BridgeStateStore(tmpDir);
  });

  afterEach(() => {
    store.clear();
  });

  function makeMessage(hash: string): BridgeMessageState {
    return {
      messageHash: hash,
      sourceChain: 'base-sepolia',
      destinationChain: 'ethereum-sepolia',
      sourceDomain: 33554434,
      destinationDomain: 33554435,
      sourceTxHash: '0xabc',
      sourceBlockNumber: 100,
      sourceFinalityBlock: 110,
      nonce: 1,
      destinationCommitment: '0'.repeat(64),
      canonicalAssetId: '0'.repeat(63) + '1',
      amount: '1000',
      signatures: [],
      status: BridgeMessageStatus.OBSERVED,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      message: {} as any,
    };
  }

  test('set and get', () => {
    const msg = makeMessage('0xdeadbeef');
    store.set(msg);
    const got = store.get('0xdeadbeef');
    expect(got).toBeDefined();
    expect(got?.messageHash).toBe('0xdeadbeef');
    expect(got?.status).toBe(BridgeMessageStatus.OBSERVED);
  });

  test('get is case-insensitive', () => {
    const msg = makeMessage('0xDEADBEEF');
    store.set(msg);
    expect(store.get('0xdeadbeef')).toBeDefined();
    expect(store.get('0xDeadBeef')).toBeDefined();
  });

  test('has returns true for tracked messages', () => {
    store.set(makeMessage('0xabc'));
    expect(store.has('0xabc')).toBe(true);
    expect(store.has('0xdef')).toBe(false);
  });

  test('update changes status', () => {
    store.set(makeMessage('0xabc'));
    store.update('0xabc', { status: BridgeMessageStatus.CONFIRMED });
    const got = store.get('0xabc');
    expect(got?.status).toBe(BridgeMessageStatus.CONFIRMED);
  });

  test('update throws for untracked message', () => {
    expect(() =>
      store.update('0xunknown', { status: BridgeMessageStatus.FAILED })
    ).toThrow('Message not found');
  });

  test('list returns all messages', () => {
    store.set(makeMessage('0xabc'));
    store.set(makeMessage('0xdef'));
    expect(store.list()).toHaveLength(2);
  });

  test('listByStatus filters correctly', () => {
    const m1 = makeMessage('0xabc');
    m1.status = BridgeMessageStatus.CONFIRMED;
    store.set(m1);

    const m2 = makeMessage('0xdef');
    m2.status = BridgeMessageStatus.FAILED;
    store.set(m2);

    expect(store.listByStatus(BridgeMessageStatus.CONFIRMED)).toHaveLength(1);
    expect(store.listByStatus(BridgeMessageStatus.FAILED)).toHaveLength(1);
    expect(store.listByStatus(BridgeMessageStatus.OBSERVED)).toHaveLength(0);
  });

  test('delete removes message', () => {
    store.set(makeMessage('0xabc'));
    store.delete('0xabc');
    expect(store.has('0xabc')).toBe(false);
  });

  test('clear removes all state', () => {
    store.set(makeMessage('0xabc'));
    store.clear();
    expect(store.list()).toHaveLength(0);
  });

  test('survives re-instantiation', () => {
    store.set(makeMessage('0xabc'));
    const store2 = new BridgeStateStore(tmpDir);
    expect(store2.has('0xabc')).toBe(true);
  });
});
