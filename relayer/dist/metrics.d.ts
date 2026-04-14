/**
 * Simple in-memory metrics collector for the relayer.
 */
export interface MetricsSnapshot {
    requestsTotal: number;
    requestsByPath: Record<string, number>;
    withdrawalsTotal: number;
    withdrawalsSuccess: number;
    withdrawalsFailure: number;
    averageResponseTimeMs: number;
    maxResponseTimeMs: number;
    memoryUsageMb: number;
}
declare class MetricsCollector {
    private requestsTotal;
    private requestsByPath;
    private withdrawalsTotal;
    private withdrawalsSuccess;
    private withdrawalsFailure;
    private responseTimeSum;
    private responseTimeCount;
    private maxResponseTimeMs;
    recordRequest(path: string): void;
    recordResponseTime(durationMs: number): void;
    recordWithdrawal(success: boolean): void;
    getSnapshot(): MetricsSnapshot;
}
export declare const metrics: MetricsCollector;
export {};
//# sourceMappingURL=metrics.d.ts.map