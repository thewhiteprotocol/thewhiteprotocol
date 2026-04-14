/**
 * Simple circuit breaker for protecting external calls (RPC, on-chain tx).
 */

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private nextAttempt = 0;

  constructor(
    private name: string,
    private failureThreshold = 5,
    private successThreshold = 2,
    private timeoutMs = 30000
  ) {}

  private canExecute(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttempt) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
      }
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeoutMs;
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(`Circuit breaker '${this.name}' is OPEN`);
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  getStatus(): { name: string; state: CircuitState; failureCount: number } {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
    };
  }
}
