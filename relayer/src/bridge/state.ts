/**
 * Bridge Message State Store — PR-010F
 *
 * JSON file-based persistence for bridge message state machine.
 * Atomic writes (write-then-rename) to prevent corruption.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BridgeMessageState, BridgeMessageStatus } from './types';

const STATE_FILE = 'bridge-messages.json';

export class BridgeStateStore {
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, STATE_FILE);
    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): Record<string, BridgeMessageState> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as Record<string, BridgeMessageState>;
    } catch {
      return {};
    }
  }

  private save(state: Record<string, BridgeMessageState>): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(state, (key, value) => {
        if (typeof value === 'bigint') return value.toString();
        return value;
      }, 2)
    );
    fs.renameSync(tmp, this.filePath);
  }

  /** Get a message by its hash, or undefined if not tracked. */
  get(messageHash: string): BridgeMessageState | undefined {
    const state = this.load();
    return state[messageHash.toLowerCase()];
  }

  /** Upsert a message state. */
  set(message: BridgeMessageState): void {
    const state = this.load();
    state[message.messageHash.toLowerCase()] = message;
    this.save(state);
  }

  /** Update specific fields of a message. */
  update(
    messageHash: string,
    patch: Partial<BridgeMessageState> & { status: BridgeMessageStatus }
  ): void {
    const state = this.load();
    const existing = state[messageHash.toLowerCase()];
    if (!existing) {
      throw new Error(`Message not found: ${messageHash}`);
    }
    state[messageHash.toLowerCase()] = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };
    this.save(state);
  }

  /** Check if a message is already tracked. */
  has(messageHash: string): boolean {
    const state = this.load();
    return messageHash.toLowerCase() in state;
  }

  /** List all tracked messages. */
  list(): BridgeMessageState[] {
    return Object.values(this.load());
  }

  /** List messages by status. */
  listByStatus(status: BridgeMessageStatus): BridgeMessageState[] {
    return this.list().filter((m) => m.status === status);
  }

  /** Remove a message (use with caution). */
  delete(messageHash: string): void {
    const state = this.load();
    delete state[messageHash.toLowerCase()];
    this.save(state);
  }

  /** Clear all state (destructive — for tests only). */
  clear(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }
}
