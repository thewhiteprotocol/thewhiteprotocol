/**
 * Simple structured logger for the relayer.
 * Outputs JSON lines with timestamp, level, and context.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
declare class Logger {
    private service;
    private minLevel;
    constructor(service: string, minLevel?: LogLevel);
    private log;
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
}
export declare const logger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map