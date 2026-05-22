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
import type { BridgeDaemon } from './daemon';
import { createApiError } from '../chain-registry';
import { buildHostedOperatorReadiness } from './operator-readiness';
import {
  isHexHash,
  operatorTokenFromRequestHeaders,
  parseBoundedInteger,
  timingSafeEqualString,
} from '../security';

export interface BridgeStatusApiConfig {
  stateStore: BridgeStateStore;
  routes: Array<{ source: string; destination: string; enabled: boolean; signerSetVersion: number }>;
  watcherDaemon?: BridgeWatcherDaemon;
  bridgeDaemon?: BridgeDaemon;
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
    const token = operatorTokenFromRequestHeaders(req.headers as any);
    if (!timingSafeEqualString(token, config.operatorApiToken)) {
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

  function requireBridgeDaemon(req: Request, res: Response): BridgeDaemon | undefined {
    if (!config.bridgeDaemon) {
      res
        .status(503)
        .json(createApiError('BRIDGE_DAEMON_NOT_CONFIGURED', 'Bridge daemon is not configured.'));
      return undefined;
    }
    return config.bridgeDaemon;
  }

  function requireMutableBridgeDaemon(req: Request, res: Response): BridgeDaemon | undefined {
    if (!requireOperatorAuth(req, res)) return undefined;
    return requireBridgeDaemon(req, res);
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
    if (!isHexHash(req.params.hash)) {
      return res.status(400).json(createApiError('INVALID_MESSAGE_HASH', 'Message hash must be a 32-byte hex string.'));
    }
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
    const limit = parseBoundedInteger(req.query.limit, 100, 1, 1000);
    const offset = parseBoundedInteger(req.query.offset, 0, 0, 1_000_000);

    let messages = config.stateStore.list();

    if (statusFilter && !Object.values(BridgeMessageStatus).includes(statusFilter as BridgeMessageStatus)) {
      return res.status(400).json(createApiError('INVALID_MESSAGE_STATUS', 'Unsupported bridge message status filter.'));
    }
    if (statusFilter) {
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

  router.get('/bridge/daemon/status', (req: Request, res: Response) => {
    const daemon = requireBridgeDaemon(req, res);
    if (!daemon) return;
    res.json(daemon.getStatus());
  });

  router.get('/bridge/operator/readiness', (req: Request, res: Response) => {
    res.json(buildHostedOperatorReadiness());
  });

  router.get('/bridge/daemon/messages', (req: Request, res: Response) => {
    const daemon = requireBridgeDaemon(req, res);
    if (!daemon) return;
    res.json({ messages: daemon.listMessages() });
  });

  router.get('/bridge/daemon/messages/:hash', (req: Request, res: Response) => {
    if (!isHexHash(req.params.hash)) {
      return res.status(400).json(createApiError('INVALID_MESSAGE_HASH', 'Message hash must be a 32-byte hex string.'));
    }
    const daemon = requireBridgeDaemon(req, res);
    if (!daemon) return;
    const message = daemon.getMessage(req.params.hash);
    if (!message) {
      return res
        .status(404)
        .json(createApiError('BRIDGE_DAEMON_MESSAGE_NOT_FOUND', `No daemon message found with hash: ${req.params.hash}`));
    }
    res.json(message);
  });

  router.post('/bridge/daemon/tick', async (req: Request, res: Response) => {
    const daemon = requireMutableBridgeDaemon(req, res);
    if (!daemon) return;
    try {
      res.json(await daemon.tick());
    } catch (err) {
      res
        .status(500)
        .json(createApiError('BRIDGE_DAEMON_TICK_FAILED', err instanceof Error ? err.message : String(err)));
    }
  });

  router.post('/bridge/daemon/messages/:hash/retry', (req: Request, res: Response) => {
    if (!isHexHash(req.params.hash)) {
      return res.status(400).json(createApiError('INVALID_MESSAGE_HASH', 'Message hash must be a 32-byte hex string.'));
    }
    const daemon = requireMutableBridgeDaemon(req, res);
    if (!daemon) return;
    try {
      res.json(daemon.retryMessage(req.params.hash));
    } catch (err) {
      res
        .status(404)
        .json(createApiError('BRIDGE_DAEMON_MESSAGE_NOT_FOUND', err instanceof Error ? err.message : String(err)));
    }
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
    const limit = parseBoundedInteger(req.query.limit, 100, 1, 1000);
    const offset = parseBoundedInteger(req.query.offset, 0, 0, 1_000_000);
    if (status && !['open', 'acknowledged', 'ignored', 'resolved', 'freeze_requested', 'freeze_submitted'].includes(status)) {
      return res.status(400).json(createApiError('INVALID_WATCHER_STATUS', 'Unsupported watcher finding status filter.'));
    }
    if (severity && !['low', 'medium', 'high', 'critical'].includes(severity)) {
      return res.status(400).json(createApiError('INVALID_WATCHER_SEVERITY', 'Unsupported watcher finding severity filter.'));
    }
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
