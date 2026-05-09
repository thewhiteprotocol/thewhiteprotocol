/**
 * Bridge Status API — PR-010F
 *
 * Express router for read-only bridge status endpoints.
 * Provides visibility into tracked messages, routes, and relayer health.
 */

import { Router, type Request, type Response } from 'express';
import { BridgeStateStore } from './state';
import { BridgeMessageStatus } from './types';
import type { BridgeWatcherDaemon } from './watcher-daemon';
import { createApiError } from '../chain-registry';

export interface BridgeStatusApiConfig {
  stateStore: BridgeStateStore;
  routes: Array<{ source: string; destination: string; enabled: boolean; signerSetVersion: number }>;
  watcherDaemon?: BridgeWatcherDaemon;
  operatorApiToken?: string;
}

export function createBridgeStatusRouter(config: BridgeStatusApiConfig): Router {
  const router = Router();

  function requireOperatorAuth(req: Request, res: Response): boolean {
    if (!config.operatorApiToken) {
      res
        .status(503)
        .json(createApiError('OPERATOR_AUTH_NOT_CONFIGURED', 'Operator API token is not configured.'));
      return false;
    }
    const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const headerToken = req.header('x-bridge-operator-token');
    if (bearer !== config.operatorApiToken && headerToken !== config.operatorApiToken) {
      res.status(401).json(createApiError('UNAUTHORIZED', 'Operator API token is required.'));
      return false;
    }
    return true;
  }

  function requireWatcher(req: Request, res: Response): BridgeWatcherDaemon | undefined {
    if (!requireOperatorAuth(req, res)) return undefined;
    if (!config.watcherDaemon) {
      res
        .status(503)
        .json(createApiError('WATCHER_NOT_CONFIGURED', 'Bridge watcher daemon is not configured.'));
      return undefined;
    }
    return config.watcherDaemon;
  }

  /**
   * GET /bridge/status
   * Relayer health + live routes + message counts by status
   */
  router.get('/bridge/status', (req: Request, res: Response) => {
    const allMessages = config.stateStore.list();
    const statusCounts = Object.values(BridgeMessageStatus).reduce(
      (acc, status) => {
        acc[status] = allMessages.filter((m) => m.status === status).length;
        return acc;
      },
      {} as Record<string, number>
    );

    res.json({
      status: 'ok',
      timestamp: Date.now(),
      routes: config.routes.filter((r) => r.enabled).map((r) => ({
        source: r.source,
        destination: r.destination,
        signerSetVersion: r.signerSetVersion,
      })),
      messageCounts: statusCounts,
      totalTracked: allMessages.length,
    });
  });

  /**
   * GET /bridge/messages/:hash
   * Single message state lookup
   */
  router.get('/bridge/messages/:hash', (req: Request, res: Response) => {
    const hash = req.params.hash.toLowerCase();
    const message = config.stateStore.get(hash);
    if (!message) {
      return res.status(404).json({
        error: 'MESSAGE_NOT_FOUND',
        message: `No message tracked with hash: ${hash}`,
      });
    }
    res.json(message);
  });

  /**
   * GET /bridge/messages
   * List tracked messages with optional status filter
   * Query params:
   *   - status: filter by BridgeMessageStatus
   *   - limit: max results (default 100, max 1000)
   *   - offset: pagination offset (default 0)
   */
  router.get('/bridge/messages', (req: Request, res: Response) => {
    const statusFilter = req.query.status as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 1000);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    let messages = config.stateStore.list();

    if (statusFilter && Object.values(BridgeMessageStatus).includes(statusFilter as BridgeMessageStatus)) {
      messages = messages.filter((m) => m.status === statusFilter);
    }

    const total = messages.length;
    const paginated = messages.slice(offset, offset + limit);

    res.json({
      total,
      offset,
      limit,
      messages: paginated,
    });
  });

  /**
   * GET /bridge/routes
   * All configured routes (enabled and disabled)
   */
  router.get('/bridge/routes', (req: Request, res: Response) => {
    res.json({
      routes: config.routes,
    });
  });

  router.get('/bridge/watcher/status', (req: Request, res: Response) => {
    const watcher = requireWatcher(req, res);
    if (!watcher) return;
    res.json(watcher.getStatus());
  });

  router.get('/bridge/watcher/findings', (req: Request, res: Response) => {
    const watcher = requireWatcher(req, res);
    if (!watcher) return;
    const status = req.query.status as string | undefined;
    const severity = req.query.severity as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || '100', 10), 1000);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const allFindings = watcher.getFindingStore().list({
      status: status as any,
      severity: severity as any,
    });
    res.json({
      total: allFindings.length,
      offset,
      limit,
      findings: allFindings.slice(offset, offset + limit),
    });
  });

  router.get('/bridge/watcher/findings/:id', (req: Request, res: Response) => {
    const watcher = requireWatcher(req, res);
    if (!watcher) return;
    const finding = watcher.getFindingStore().get(req.params.id);
    if (!finding) {
      return res
        .status(404)
        .json(createApiError('WATCHER_FINDING_NOT_FOUND', `No watcher finding found with id: ${req.params.id}`));
    }
    res.json(finding);
  });

  router.post('/bridge/watcher/findings/:id/ack', (req: Request, res: Response) => {
    const watcher = requireWatcher(req, res);
    if (!watcher) return;
    try {
      res.json(watcher.getFindingStore().acknowledge(req.params.id));
    } catch (err) {
      res
        .status(404)
        .json(createApiError('WATCHER_FINDING_NOT_FOUND', err instanceof Error ? err.message : String(err)));
    }
  });

  router.post('/bridge/watcher/findings/:id/ignore', (req: Request, res: Response) => {
    const watcher = requireWatcher(req, res);
    if (!watcher) return;
    try {
      res.json(watcher.getFindingStore().ignore(req.params.id));
    } catch (err) {
      res
        .status(404)
        .json(createApiError('WATCHER_FINDING_NOT_FOUND', err instanceof Error ? err.message : String(err)));
    }
  });

  router.post('/bridge/watcher/findings/:id/freeze-dry-run', async (req: Request, res: Response) => {
    const watcher = requireWatcher(req, res);
    if (!watcher) return;
    try {
      const preview = await watcher.freezeDryRun(req.params.id);
      res.json({ dryRun: true, preview });
    } catch (err) {
      res
        .status(404)
        .json(createApiError('WATCHER_FINDING_NOT_FOUND', err instanceof Error ? err.message : String(err)));
    }
  });

  router.post('/bridge/watcher/tick', async (req: Request, res: Response) => {
    const watcher = requireWatcher(req, res);
    if (!watcher) return;
    try {
      res.json(await watcher.tick());
    } catch (err) {
      res
        .status(500)
        .json(createApiError('WATCHER_TICK_FAILED', err instanceof Error ? err.message : String(err)));
    }
  });

  return router;
}
