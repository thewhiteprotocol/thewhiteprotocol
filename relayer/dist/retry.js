"use strict";
/**
 * Generic retry helper with exponential backoff and jitter.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = withRetry;
function isNonRetryableError(error, patterns) {
    const message = error.message.toLowerCase();
    return patterns.some(pattern => message.includes(pattern.toLowerCase()));
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function withRetry(fn, options = {}) {
    const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 30000, nonRetryablePatterns = [], } = options;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
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
