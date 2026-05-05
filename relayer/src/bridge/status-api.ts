/**
 * Bridge Status API — PR-010F
 *
 * Express router for read-only bridge status endpoints.
 * Provides visibility into tracked messages, routes, and relayer health.
 */

import { Router, type Request, type Response } from 'express';
import { BridgeStateStore } from './state';
import { BridgeMessageStatus } from './types';

export interface BridgeStatusApiConfig {
  stateStore: BridgeStateStore;
  routes: Array<{ source: string; destination: string; enabled: boolean; signerSetVersion: number }>;
}

export function createBridgeStatusRouter(config: BridgeStatusApiConfig): Router {
  const router = Router();

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

  return router;
}
