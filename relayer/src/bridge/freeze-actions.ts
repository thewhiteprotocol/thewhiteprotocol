/**
 * Freeze action abstraction for bridge watcher findings.
 *
 * PR-011B builds dry-run previews only by default. Submission requires an
 * explicit implementation to be injected by operators.
 */

import { encodeFunctionData, parseAbi, type Hex } from 'viem';
import { PublicKey } from '@solana/web3.js';
import type { BridgeChainPolicyConfig } from './types';
import { DEFAULT_BRIDGE_CHAINS } from './policy';
import { deriveBridgeV1ConfigPDA, deriveFrozenMessagePDA, WHITE_PROTOCOL_PROGRAM_ID } from './solana-adapter';
import type { BridgeWatcherFindingRecord } from './watcher-store';

const BRIDGE_INBOX_FREEZE_ABI = parseAbi([
  'function freezeMessage(bytes32 messageHash) external',
]);

export interface BridgeFreezePreview {
  dryRun: boolean;
  messageHash: string;
  targetChain: string;
  targetFamily: 'evm' | 'solana' | 'unknown';
  action: 'freeze_message';
  evm?: {
    to?: string;
    functionName: 'freezeMessage';
    args: [string];
    calldata: string;
  };
  solana?: {
    programId: string;
    instructionName: 'freeze_bridge_v1_message';
    accounts: {
      bridgeV1Config: string;
      frozenMessage: string;
    };
    args: {
      messageHash: string;
      frozen: boolean;
    };
  };
  warning?: string;
}

export interface BridgeFreezeSubmitResult {
  txHash: string;
}

export interface BridgeFreezeActionExecutor {
  buildFreezePreview(finding: BridgeWatcherFindingRecord): BridgeFreezePreview;
  submitFreeze?(preview: BridgeFreezePreview): Promise<BridgeFreezeSubmitResult>;
}

export interface BridgeFreezeActionBuilderConfig {
  chains?: Record<string, BridgeChainPolicyConfig>;
}

function cleanHash(hash: string): string {
  return hash.replace(/^0x/i, '').toLowerCase();
}

function hashBytes(hash: string): Uint8Array {
  const clean = cleanHash(hash);
  if (clean.length !== 64) {
    throw new Error(`messageHash must be 32 bytes, got ${clean.length / 2} bytes`);
  }
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}

export class BridgeFreezeActionBuilder implements BridgeFreezeActionExecutor {
  private readonly chains: Record<string, BridgeChainPolicyConfig>;

  constructor(config: BridgeFreezeActionBuilderConfig = {}) {
    this.chains = config.chains ?? DEFAULT_BRIDGE_CHAINS;
  }

  buildFreezePreview(finding: BridgeWatcherFindingRecord): BridgeFreezePreview {
    const chain = this.chains[finding.destinationChain] ?? this.chains[finding.sourceChain];
    const messageHash = `0x${cleanHash(finding.messageHash)}`;

    if (!chain) {
      return {
        dryRun: true,
        messageHash,
        targetChain: finding.destinationChain,
        targetFamily: 'unknown',
        action: 'freeze_message',
        warning: 'No chain policy configured; cannot build freeze call preview.',
      };
    }

    if (chain.family === 'evm') {
      const calldata = encodeFunctionData({
        abi: BRIDGE_INBOX_FREEZE_ABI,
        functionName: 'freezeMessage',
        args: [messageHash as Hex],
      });
      const bridgeInboxAddress = (chain as BridgeChainPolicyConfig & { bridgeInboxAddress?: string })
        .bridgeInboxAddress;
      return {
        dryRun: true,
        messageHash,
        targetChain: chain.chainKey,
        targetFamily: 'evm',
        action: 'freeze_message',
        evm: {
          to: bridgeInboxAddress,
          functionName: 'freezeMessage',
          args: [messageHash],
          calldata,
        },
        warning: bridgeInboxAddress
          ? undefined
          : 'BridgeInbox address is not configured; preview includes calldata only.',
      };
    }

    const programId = chain.solanaProgramId
      ? new PublicKey(chain.solanaProgramId)
      : WHITE_PROTOCOL_PROGRAM_ID;
    const bridgeV1Config = deriveBridgeV1ConfigPDA(programId);
    const frozenMessage = deriveFrozenMessagePDA(hashBytes(messageHash), programId);

    return {
      dryRun: true,
      messageHash,
      targetChain: chain.chainKey,
      targetFamily: 'solana',
      action: 'freeze_message',
      solana: {
        programId: programId.toBase58(),
        instructionName: 'freeze_bridge_v1_message',
        accounts: {
          bridgeV1Config: bridgeV1Config.toBase58(),
          frozenMessage: frozenMessage.toBase58(),
        },
        args: {
          messageHash,
          frozen: true,
        },
      },
    };
  }
}
