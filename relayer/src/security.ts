import crypto from 'crypto';
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { CorsOptions } from 'cors';

type Env = Record<string, string | undefined>;

const LOCAL_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function splitCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function rateLimitingEnabled(env: Env = process.env): boolean {
  return boolEnv(env.RELAYER_RATE_LIMIT_ENABLED, true);
}

function intEnv(value: string | undefined, defaultValue: number, min: number, max: number): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return defaultValue;
  return Math.floor(parsed);
}

export function allowedOriginsFromEnv(env: Env = process.env): string[] {
  const explicit = splitCsv(env.RELAYER_ALLOWED_ORIGINS || env.CORS_ORIGIN);
  if (explicit.length > 0) return explicit;
  return env.NODE_ENV === 'production' ? [] : LOCAL_DEV_ORIGINS;
}

export function publicAllowedOriginsFromEnv(env: Env = process.env): string[] {
  const explicit = splitCsv(env.RELAYER_PUBLIC_ALLOWED_ORIGINS);
  return explicit.length > 0 ? explicit : allowedOriginsFromEnv(env);
}

export function buildCorsOptions(env: Env = process.env): CorsOptions {
  const allowed = new Set(allowedOriginsFromEnv(env));
  return {
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowed.has(origin));
    },
  };
}

export function timingSafeEqualString(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function operatorTokenFromRequestHeaders(headers: {
  authorization?: string | string[];
  'x-bridge-operator-token'?: string | string[];
}): string | undefined {
  const authHeader = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  const bearer = authHeader?.replace(/^Bearer\s+/i, '');
  const operatorHeader = headers['x-bridge-operator-token'];
  const headerToken = Array.isArray(operatorHeader) ? operatorHeader[0] : operatorHeader;
  return bearer || headerToken;
}

export function isHexHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function parseBoundedInteger(value: unknown, defaultValue: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value !== 'string' && typeof value !== 'number') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return defaultValue;
  return parsed;
}

export interface RateLimitDefaults {
  windowMs: number;
  max: number;
}

export function createConfiguredRateLimiter(
  label: string,
  env: Env,
  prefix: 'RELAYER_PUBLIC' | 'RELAYER_OPERATOR' | 'RELAYER_EXPENSIVE',
  defaults: RateLimitDefaults
): RequestHandler {
  const enabled = rateLimitingEnabled(env);
  if (!enabled) {
    return (_req, _res, next) => next();
  }

  const windowMs = intEnv(env[`${prefix}_RATE_LIMIT_WINDOW_MS`], defaults.windowMs, 1_000, 24 * 60 * 60 * 1_000);
  const max = intEnv(env[`${prefix}_RATE_LIMIT_MAX`], defaults.max, 1, 100_000);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'RATE_LIMITED',
      message: 'Too many requests, please slow down.',
      category: label,
    },
    keyGenerator: (req) => {
      if (prefix === 'RELAYER_OPERATOR') {
        const token = operatorTokenFromRequestHeaders(req.headers as any);
        if (token) {
          return `operator:${crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)}`;
        }
      }
      return req.ip || 'unknown';
    },
  });
}

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  };
}
