"use strict";
/**
 * Simple in-memory metrics collector for the relayer.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.metrics = void 0;
class MetricsCollector {
    requestsTotal = 0;
    requestsByPath = {};
    withdrawalsTotal = 0;
    withdrawalsSuccess = 0;
    withdrawalsFailure = 0;
    responseTimeSum = 0;
    responseTimeCount = 0;
    maxResponseTimeMs = 0;
    recordRequest(path) {
        this.requestsTotal++;
        this.requestsByPath[path] = (this.requestsByPath[path] || 0) + 1;
    }
    recordResponseTime(durationMs) {
        this.responseTimeSum += durationMs;
        this.responseTimeCount++;
        if (durationMs > this.maxResponseTimeMs) {
            this.maxResponseTimeMs = durationMs;
        }
    }
    recordWithdrawal(success) {
        this.withdrawalsTotal++;
        if (success) {
            this.withdrawalsSuccess++;
        }
        else {
            this.withdrawalsFailure++;
        }
    }
    getSnapshot() {
        const mem = process.memoryUsage();
        return {
            requestsTotal: this.requestsTotal,
            requestsByPath: { ...this.requestsByPath },
            withdrawalsTotal: this.withdrawalsTotal,
            withdrawalsSuccess: this.withdrawalsSuccess,
            withdrawalsFailure: this.withdrawalsFailure,
            averageResponseTimeMs: this.responseTimeCount > 0 ? Math.round(this.responseTimeSum / this.responseTimeCount) : 0,
            maxResponseTimeMs: this.maxResponseTimeMs,
            memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
        };
    }
}
exports.metrics = new MetricsCollector();
