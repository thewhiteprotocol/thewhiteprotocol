/**
 * EVM Bridge Adapter — PR-010F
 *
 * Watches BridgeOutInitiated events on a source EVM chain
 * and submits acceptBridgeMint on a destination EVM chain.
 *
 * Uses viem for all EVM interactions.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { BridgeMessageV1 } from '@thewhiteprotocol/core';
import type {
  BridgeEventObservation,
  BridgeSourceAdapter,
  BridgeDestinationAdapter,
} from './types';
import { withRetry } from '../retry';

// ABI fragments for BridgeOutbox and BridgeInbox
const BRIDGE_OUTBOX_ABI = parseAbi([
  'event BridgeOutInitiated(bytes32 indexed messageHash, uint32 indexed destinationDomain, bytes32 indexed canonicalAssetId, uint128 amount, uint64 nonce, bytes encodedMessage)',
]);

const BRIDGE_INBOX_ABI = parseAbi([
  'function acceptBridgeMint((uint16 protocolVersion, uint8 messageType, uint32 sourceDomain, uint32 destinationDomain, uint64 sourceChainId, uint64 destinationChainId, bytes32 canonicalAssetId, bytes32 sourceLocalAssetId, bytes32 destinationLocalAssetId, uint128 amount, bytes32 sourceNullifierHash, bytes32 destinationCommitment, bytes32 sourceRoot, uint64 sourceLeafIndex, bytes32 sourceTxHash, uint64 sourceBlockNumber, uint64 sourceFinalityBlock, uint64 nonce, uint64 deadline, uint128 relayerFee, bytes32 recipientStealthMetadataHash, bytes32 memoHash, bytes32 reserved0, bytes32 reserved1) calldata message, bytes[] calldata signatures, uint256 signerSetVersion) external',
  'function isMessageConsumed(bytes32 messageHash) external view returns (bool)',
]);

/** Decode a 451-byte encoded BridgeMessageV1 back into the struct. */
export function decodeBridgeMessageV1(encoded: Uint8Array): BridgeMessageV1 {
  if (encoded.length !== 451) {
    throw new Error(`Invalid encoded length: expected 451, got ${encoded.length}`);
  }
  const view = new DataView(encoded.buffer, encoded.byteOffset);
  let offset = 0;

  const readUint16 = () => {
    const v = view.getUint16(offset, false);
    offset += 2;
    return v;
  };
  const readUint8 = () => {
    const v = encoded[offset];
    offset += 1;
    return v;
  };
  const readUint32 = () => {
    const v = view.getUint32(offset, false);
    offset += 4;
    return v;
  };
  const readUint64 = () => {
    const v = view.getBigUint64(offset, false);
    offset += 8;
    return Number(v);
  };
  const readUint128 = () => {
    // Read 16 bytes as big-endian uint128
    const bytes = encoded.slice(offset, offset + 16);
    offset += 16;
    let result = 0n;
    for (let i = 0; i < 16; i++) {
      result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
  };
  const readBytes32 = () => {
    const hex = Array.from(encoded.slice(offset, offset + 32))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    offset += 32;
    return hex;
  };

  return {
    protocolVersion: readUint16(),
    messageType: readUint8(),
    sourceDomain: readUint32(),
    destinationDomain: readUint32(),
    sourceChainId: readUint64(),
    destinationChainId: readUint64(),
    canonicalAssetId: readBytes32(),
    sourceLocalAssetId: readBytes32(),
    destinationLocalAssetId: readBytes32(),
    amount: readUint128(),
    sourceNullifierHash: readBytes32(),
    destinationCommitment: readBytes32(),
    sourceRoot: readBytes32(),
    sourceLeafIndex: readUint64(),
    sourceTxHash: readBytes32(),
    sourceBlockNumber: readUint64(),
    sourceFinalityBlock: readUint64(),
    nonce: readUint64(),
    deadline: readUint64(),
    relayerFee: readUint128(),
    recipientStealthMetadataHash: readBytes32(),
    memoHash: readBytes32(),
    reserved0: readBytes32(),
    reserved1: readBytes32(),
  };
}

/** Parse a 0x-prefixed hex string into a Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// =============================================================================
// Source Adapter
// =============================================================================

export interface EvmSourceAdapterConfig {
  rpcUrl: string;
  bridgeOutboxAddress: Hex;
  chainId: number;
}

export class EvmSourceAdapter implements BridgeSourceAdapter {
  private readonly client: PublicClient;
  private readonly outboxAddress: Hex;

  constructor(config: EvmSourceAdapterConfig) {
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient;
    this.outboxAddress = config.bridgeOutboxAddress;
  }

  async *watch(): AsyncGenerator<BridgeEventObservation> {
    const currentBlock = await this.getBlockNumber();
    // Look back 100 blocks from startup
    const fromBlock = BigInt(Math.max(0, currentBlock - 100));
    const toBlock = BigInt(currentBlock);

    const logs = await this.client.getContractEvents({
      address: this.outboxAddress,
      abi: BRIDGE_OUTBOX_ABI,
      eventName: 'BridgeOutInitiated',
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      const args = log.args as {
        messageHash: Hex;
        destinationDomain: number;
        canonicalAssetId: Hex;
        amount: bigint;
        nonce: bigint;
        encodedMessage: Hex;
      };

      yield {
        messageHash: args.messageHash,
        destinationDomain: args.destinationDomain,
        canonicalAssetId: args.canonicalAssetId,
        amount: args.amount,
        nonce: Number(args.nonce),
        encodedMessage: args.encodedMessage,
        txHash: log.transactionHash ?? '0x',
        blockNumber: Number(log.blockNumber ?? 0n),
        sourceEventKind: 'evm_bridge_outbox_bridge_out_initiated',
        sourceAddress: this.outboxAddress,
        sourceTxSucceeded: true,
      };
    }
  }

  async getBlockNumber(): Promise<number> {
    const block = await this.client.getBlockNumber();
    return Number(block);
  }

  async isFinalized(txHash: string, requiredConfirmations: number): Promise<boolean> {
    const receipt = await withRetry(() =>
      this.client.getTransactionReceipt({ hash: txHash as Hex })
    );
    if (!receipt || !receipt.blockNumber) return false;

    const currentBlock = await this.client.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber);
    return confirmations >= requiredConfirmations;
  }

  decodeEncodedMessage(encodedMessage: string): BridgeMessageV1 {
    return decodeBridgeMessageV1(hexToBytes(encodedMessage));
  }
}

// =============================================================================
// Destination Adapter
// =============================================================================

export interface EvmDestinationAdapterConfig {
  rpcUrl: string;
  bridgeInboxAddress: Hex;
  walletPrivateKey: Hex;
  chainId: number;
}

export class EvmDestinationAdapter implements BridgeDestinationAdapter {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: Account;
  private readonly inboxAddress: Hex;

  constructor(config: EvmDestinationAdapterConfig) {
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient;
    this.account = privateKeyToAccount(config.walletPrivateKey);
    this.walletClient = createWalletClient({
      account: this.account,
      transport: http(config.rpcUrl),
    });
    this.inboxAddress = config.bridgeInboxAddress;
  }

  async isMessageConsumed(messageHash: string): Promise<boolean> {
    return withRetry(() =>
      this.publicClient.readContract({
        address: this.inboxAddress,
        abi: BRIDGE_INBOX_ABI,
        functionName: 'isMessageConsumed',
        args: [messageHash as Hex],
      })
    ) as Promise<boolean>;
  }

  async submitAcceptBridgeMint(
    message: BridgeMessageV1,
    signatures: string[],
    signerSetVersion: number
  ): Promise<string> {
    // Convert to viem-compatible struct (bigints for uint64 fields, 0x-prefixed hex for bytes32)
    const viemMessage = {
      protocolVersion: message.protocolVersion,
      messageType: message.messageType,
      sourceDomain: message.sourceDomain,
      destinationDomain: message.destinationDomain,
      sourceChainId: BigInt(message.sourceChainId),
      destinationChainId: BigInt(message.destinationChainId),
      canonicalAssetId: `0x${message.canonicalAssetId}` as Hex,
      sourceLocalAssetId: `0x${message.sourceLocalAssetId}` as Hex,
      destinationLocalAssetId: `0x${message.destinationLocalAssetId}` as Hex,
      amount: message.amount,
      sourceNullifierHash: `0x${message.sourceNullifierHash}` as Hex,
      destinationCommitment: `0x${message.destinationCommitment}` as Hex,
      sourceRoot: `0x${message.sourceRoot}` as Hex,
      sourceLeafIndex: BigInt(message.sourceLeafIndex),
      sourceTxHash: `0x${message.sourceTxHash}` as Hex,
      sourceBlockNumber: BigInt(message.sourceBlockNumber),
      sourceFinalityBlock: BigInt(message.sourceFinalityBlock),
      nonce: BigInt(message.nonce),
      deadline: BigInt(message.deadline),
      relayerFee: message.relayerFee,
      recipientStealthMetadataHash: `0x${message.recipientStealthMetadataHash}` as Hex,
      memoHash: `0x${message.memoHash}` as Hex,
      reserved0: `0x${message.reserved0}` as Hex,
      reserved1: `0x${message.reserved1}` as Hex,
    };
    const txHash = await this.walletClient.writeContract({
      address: this.inboxAddress,
      abi: BRIDGE_INBOX_ABI,
      functionName: 'acceptBridgeMint',
      args: [viemMessage, signatures as Hex[], BigInt(signerSetVersion)],
      chain: undefined, // viem will auto-detect from transport
      account: this.account,
    });
    return txHash;
  }
}
