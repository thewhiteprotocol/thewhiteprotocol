"use strict";
/**
 * Simple circuit breaker for protecting external calls (RPC, on-chain tx).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = void 0;
class CircuitBreaker {
    constructor(name, failureThreshold = 5, successThreshold = 2, timeoutMs = 30000) {
        this.name = name;
        this.failureThreshold = failureThreshold;
        this.successThreshold = successThreshold;
        this.timeoutMs = timeoutMs;
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.nextAttempt = 0;
    }
    canExecute() {
        if (this.state === 'CLOSED')
            return true;
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
    recordSuccess() {
        this.failureCount = 0;
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= this.successThreshold) {
                this.state = 'CLOSED';
            }
        }
    }
    recordFailure() {
        this.failureCount++;
        if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeoutMs;
        }
    }
    async execute(fn) {
        if (!this.canExecute()) {
            throw new Error(`Circuit breaker '${this.name}' is OPEN`);
        }
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (err) {
            this.recordFailure();
            throw err;
        }
    }
    getStatus() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
        };
    }
}
exports.CircuitBreaker = CircuitBreaker;
