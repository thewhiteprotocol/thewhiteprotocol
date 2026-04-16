"use strict";
/**
 * Simple structured logger for the relayer.
 * Outputs JSON lines with timestamp, level, and context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const LEVEL_PRIORITY = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
class Logger {
    service;
    minLevel;
    constructor(service, minLevel = 'info') {
        this.service = service;
        this.minLevel = minLevel;
    }
    log(level, message, meta) {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel])
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            service: this.service,
            message,
            ...meta,
        };
        const output = JSON.stringify(entry);
        if (level === 'error') {
            console.error(output);
        }
        else if (level === 'warn') {
            console.warn(output);
        }
        else {
            console.log(output);
        }
    }
    debug(message, meta) {
        this.log('debug', message, meta);
    }
    info(message, meta) {
        this.log('info', message, meta);
    }
    warn(message, meta) {
        this.log('warn', message, meta);
    }
    error(message, meta) {
        this.log('error', message, meta);
    }
}
exports.logger = new Logger('relayer', process.env.LOG_LEVEL || 'info');
