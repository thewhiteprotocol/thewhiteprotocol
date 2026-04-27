/**
 * Simple in-memory metrics collector for the relayer.
 * Supports per-chain labels for multi-chain deployments.
 */

export interface MetricsSnapshot {
  requestsTotal: number;
  requestsByPath: Record<string, number>;
  withdrawalsTotal: number;
  withdrawalsSuccess: number;
  withdrawalsFailure: number;
  withdrawalsByChain: Record<string, { total: number; success: number; failure: number }>;
  averageResponseTimeMs: number;
  maxResponseTimeMs: number;
  memoryUsageMb: number;
}

interface ChainCounters {
  total: number;
  success: number;
  failure: number;
}

class MetricsCollector {
  private requestsTotal = 0;
  private requestsByPath: Record<string, number> = {};
  private withdrawalsTotal = 0;
  private withdrawalsSuccess = 0;
  private withdrawalsFailure = 0;
  private withdrawalsByChain: Record<string, ChainCounters> = {};
  private responseTimeSum = 0;
  private responseTimeCount = 0;
  private maxResponseTimeMs = 0;

  recordRequest(path: string): void {
    this.requestsTotal++;
    this.requestsByPath[path] = (this.requestsByPath[path] || 0) + 1;
  }

  recordResponseTime(durationMs: number): void {
    this.responseTimeSum += durationMs;
    this.responseTimeCount++;
    if (durationMs > this.maxResponseTimeMs) {
      this.maxResponseTimeMs = durationMs;
    }
  }

  recordWithdrawal(success: boolean, chain?: string): void {
    this.withdrawalsTotal++;
    if (success) {
      this.withdrawalsSuccess++;
    } else {
      this.withdrawalsFailure++;
    }
    if (chain) {
      const c = this.withdrawalsByChain[chain] || { total: 0, success: 0, failure: 0 };
      c.total++;
      if (success) c.success++;
      else c.failure++;
      this.withdrawalsByChain[chain] = c;
    }
  }

  getSnapshot(): MetricsSnapshot {
    const mem = process.memoryUsage();
    return {
      requestsTotal: this.requestsTotal,
      requestsByPath: { ...this.requestsByPath },
      withdrawalsTotal: this.withdrawalsTotal,
      withdrawalsSuccess: this.withdrawalsSuccess,
      withdrawalsFailure: this.withdrawalsFailure,
      withdrawalsByChain: { ...this.withdrawalsByChain },
      averageResponseTimeMs:
        this.responseTimeCount > 0 ? Math.round(this.responseTimeSum / this.responseTimeCount) : 0,
      maxResponseTimeMs: this.maxResponseTimeMs,
      memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
    };
  }
}

export const metrics = new MetricsCollector();
