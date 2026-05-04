/**
 * Multi-Chain EVM Sequencer
 *
 * Manages one EvmSequencer worker per active EVM chain.
 * Solana sequencer remains separate and is not managed here.
 */

import { EvmAdapter } from '../chains/evm';
import { RelayerApiExtensions } from '../api-extensions';
import { EvmSequencer } from './evm';

export interface MultiChainSequencerConfig {
  adapters: Map<string, EvmAdapter>;
  deploymentBlocks: Map<string, bigint>;
  apiExtensions: RelayerApiExtensions;
  treeDepth: number;
  logger: any;
}

export class MultiChainSequencer {
  private sequencers: Map<string, EvmSequencer> = new Map();
  private running = false;

  constructor(private config: MultiChainSequencerConfig) {}

  getStatus(): Record<string, ReturnType<EvmSequencer['getStatus']>> {
    const status: Record<string, ReturnType<EvmSequencer['getStatus']>> = {};
    for (const [name, seq] of this.sequencers) {
      status[name] = seq.getStatus();
    }
    return status;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const [name, adapter] of this.config.adapters) {
      const deploymentBlock = this.config.deploymentBlocks.get(name) ?? 0n;
      const pollIntervalMs = this.estimatePollInterval(adapter.chainId);

      const seq = new EvmSequencer({
        chainName: name,
        adapter,
        deploymentBlock,
        apiExtensions: this.config.apiExtensions,
        treeDepth: this.config.treeDepth,
        pollIntervalMs,
        logger: this.config.logger,
      });

      this.sequencers.set(name, seq);
      seq.start().catch((err) => {
        this.config.logger.error(`[${name}] EVM sequencer crashed`, { err: String(err) });
      });
    }
  }

  stop(): void {
    this.running = false;
    for (const seq of this.sequencers.values()) {
      seq.stop();
    }
  }

  private estimatePollInterval(chainId: number): number {
    // Map chain IDs to typical block times (ms) * 5
    const intervals: Record<number, number> = {
      84532: 10000,   // Base Sepolia: 2s * 5
      11155111: 60000, // Ethereum Sepolia: 12s * 5
      80002: 10000,   // Polygon Amoy: 2s * 5

    };
    return intervals[chainId] || 30000;
  }
}
