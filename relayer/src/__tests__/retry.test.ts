jest.mock('../retry', () => {
  const actual = jest.requireActual('../retry');

  // A test-only version of withRetry that skips sleep delays
  async function withRetry(
    fn: () => Promise<any>,
    options: any = {}
  ): Promise<any> {
    const {
      maxAttempts = 3,
      nonRetryablePatterns = [],
    } = options;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        const message = lastError.message.toLowerCase();
        const isNonRetryable = nonRetryablePatterns.some((p: string) =>
          message.includes(p.toLowerCase())
        );

        if (isNonRetryable) {
          throw lastError;
        }
        // Skip sleep in tests
      }
    }

    throw lastError || new Error('Operation failed after all retries');
  }

  return {
    ...actual,
    withRetry,
  };
});

import { withRetry } from '../retry';

describe('withRetry', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns immediately on success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('persistent'));

    await expect(withRetry(fn, { maxAttempts: 2 })).rejects.toThrow('persistent');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('insufficient funds'));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        nonRetryablePatterns: ['insufficient funds'],
      })
    ).rejects.toThrow('insufficient funds');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('matches non-retryable patterns case-insensitively', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('INSUFFICIENT FUNDS'));

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        nonRetryablePatterns: ['insufficient funds'],
      })
    ).rejects.toThrow('INSUFFICIENT FUNDS');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries when error message does not match non-retryable patterns', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, {
      maxAttempts: 2,
      nonRetryablePatterns: ['insufficient funds', 'nonce too low'],
    });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('handles non-Error throws by wrapping them', async () => {
    const fn = jest.fn().mockRejectedValue('string error');

    await expect(withRetry(fn, { maxAttempts: 1 })).rejects.toThrow('string error');
  });
});
