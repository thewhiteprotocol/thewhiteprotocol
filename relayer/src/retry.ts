/**
 * Generic retry helper with exponential backoff and jitter.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  nonRetryablePatterns?: string[];
}

function isNonRetryableError(error: Error, patterns: string[]): boolean {
  const message = error.message.toLowerCase();
  return patterns.some(pattern => message.includes(pattern.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    nonRetryablePatterns = [],
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (isNonRetryableError(lastError, nonRetryablePatterns)) {
        throw lastError;
      }

      if (attempt < maxAttempts) {
        const exponential = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const delay = Math.min(exponential + jitter, maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Operation failed after all retries');
}
