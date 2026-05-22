import express, { Request, Response } from 'express';
import {
  buildCorsOptions,
  createConfiguredRateLimiter,
  securityHeaders,
  timingSafeEqualString,
} from '../security';

async function invokeApp(
  app: express.Application,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: any } = {}
): Promise<{ status: number; headers: Record<string, any>; body: any }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const req = {
      method: options.method || 'GET',
      url: path,
      path,
      headers: options.headers || {},
      body: options.body,
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
      on: (event: string, cb: (...args: any[]) => void) => {
        if (event === 'data') return req;
        if (event === 'end') setImmediate(cb);
        return req;
      },
    } as any;
    const res = {
      statusCode: 200,
      headers: {} as Record<string, any>,
      setHeader(name: string, value: any) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name: string) {
        return this.headers[name.toLowerCase()];
      },
      removeHeader(name: string) {
        delete this.headers[name.toLowerCase()];
      },
      writeHead(status: number, headers?: Record<string, any>) {
        this.statusCode = status;
        if (headers) {
          for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
        }
      },
      write(chunk: any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(chunk?: any) {
        if (chunk) this.write(chunk);
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any = text;
        try { body = text ? JSON.parse(text) : undefined; } catch {}
        resolve({ status: this.statusCode, headers: this.headers, body });
      },
    } as any;
    (app as any).handle(req, res);
  });
}

function checkOrigin(origin: string | undefined, env: Record<string, string | undefined>): Promise<boolean> {
  const options = buildCorsOptions(env);
  return new Promise((resolve, reject) => {
    const originFn = options.origin as (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;
    originFn(origin, (err, allow) => {
      if (err) reject(err);
      else resolve(Boolean(allow));
    });
  });
}

describe('production API security helpers', () => {
  test('CORS allows configured origins and rejects unconfigured production origins', async () => {
    const env = {
      NODE_ENV: 'production',
      RELAYER_ALLOWED_ORIGINS: 'https://app.thewhiteprotocol.com,https://ops.thewhiteprotocol.com',
    };
    await expect(checkOrigin('https://app.thewhiteprotocol.com', env)).resolves.toBe(true);
    await expect(checkOrigin('https://evil.example', env)).resolves.toBe(false);
  });

  test('CORS does not allow wildcard credentials in production', () => {
    const options = buildCorsOptions({
      NODE_ENV: 'production',
      RELAYER_ALLOWED_ORIGINS: 'https://app.thewhiteprotocol.com',
    });
    expect(options.credentials).toBe(false);
  });

  test('local development has explicit localhost defaults', async () => {
    await expect(checkOrigin('http://localhost:3000', { NODE_ENV: 'development' })).resolves.toBe(true);
    await expect(checkOrigin('https://example.com', { NODE_ENV: 'development' })).resolves.toBe(false);
  });

  test('rate limiter returns safe 429 body and disabled mode bypasses', async () => {
    const limited = express();
    limited.use(createConfiguredRateLimiter('public', {
      RELAYER_RATE_LIMIT_ENABLED: 'true',
      RELAYER_PUBLIC_RATE_LIMIT_WINDOW_MS: '60000',
      RELAYER_PUBLIC_RATE_LIMIT_MAX: '1',
    }, 'RELAYER_PUBLIC', { windowMs: 60_000, max: 1 }));
    limited.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

    expect((await invokeApp(limited, '/health')).status).toBe(200);
    const blocked = await invokeApp(limited, '/health');
    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked.body)).not.toContain('RELAYER_PUBLIC_RATE_LIMIT_MAX');

    const disabled = express();
    disabled.use(createConfiguredRateLimiter('public', {
      RELAYER_RATE_LIMIT_ENABLED: 'false',
      RELAYER_PUBLIC_RATE_LIMIT_MAX: '1',
    }, 'RELAYER_PUBLIC', { windowMs: 60_000, max: 1 }));
    disabled.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));
    expect((await invokeApp(disabled, '/health')).status).toBe(200);
    expect((await invokeApp(disabled, '/health')).status).toBe(200);
  });

  test('security headers include low-risk API defaults', async () => {
    const app = express();
    app.use(securityHeaders());
    app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));
    const response = await invokeApp(app, '/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  test('timing safe token comparison rejects missing and mismatched tokens', () => {
    expect(timingSafeEqualString('operator-token', 'operator-token')).toBe(true);
    expect(timingSafeEqualString('wrong-token', 'operator-token')).toBe(false);
    expect(timingSafeEqualString(undefined, 'operator-token')).toBe(false);
  });
});
