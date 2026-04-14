/**
 * Simple circuit breaker for protecting external calls (RPC, on-chain tx).
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export declare class CircuitBreaker {
    private name;
    private failureThreshold;
    private successThreshold;
    private timeoutMs;
    private state;
    private failureCount;
    private successCount;
    private nextAttempt;
    constructor(name: string, failureThreshold?: number, successThreshold?: number, timeoutMs?: number);
    private canExecute;
    private recordSuccess;
    private recordFailure;
    execute<T>(fn: () => Promise<T>): Promise<T>;
    getStatus(): {
        name: string;
        state: CircuitState;
        failureCount: number;
    };
}
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map