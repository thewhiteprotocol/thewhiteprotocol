/**
 * Solana Bridge Adapter — PR-010F (Skeleton)
 *
 * Provides instruction building and PDA derivation for
 * accept_bridge_v1_mint on the Solana white-protocol program.
 *
 * Full live submission is deferred until Solana devnet/testnet
 * bridge V1 accounts are deployed and funded.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { hashBridgeMessageV1, type BridgeMessageV1 } from '@thewhiteprotocol/core';
import type {
  BridgeEventObservation,
  BridgeDestinationAdapter,
} from './types';

/** Program ID for white-protocol (devnet). */
export const WHITE_PROTOCOL_PROGRAM_ID = new PublicKey(
  'DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD'
);

/** Seed prefixes matching the Rust program. */
export const SEEDS = {
  bridgeV1Config: Buffer.from('bridge_v1_config'),
  bridgeSignerSet: Buffer.from('bridge_signer_set'),
  consumedMessage: Buffer.from('bridge_consumed'),
  frozenMessage: Buffer.from('bridge_frozen'),
  outboundMessage: Buffer.from('bridge_outbound'),
  bridgeRoute: Buffer.from('bridge_route'),
  bridgeAsset: Buffer.from('bridge_asset'),
  pending: Buffer.from('pending'),
  commitment: Buffer.from('commitment'),
  merkleTree: Buffer.from('merkle_tree'),
  vault: Buffer.from('vault'),
} as const;

// =============================================================================
// PDA Derivation
// =============================================================================

export function deriveBridgeV1ConfigPDA(programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([SEEDS.bridgeV1Config], programId);
  return pda;
}

export function deriveBridgeSignerSetPDA(
  version: number,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const versionBytes = Buffer.allocUnsafe(4);
  versionBytes.writeUInt32LE(version, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.bridgeSignerSet, versionBytes],
    programId
  );
  return pda;
}

export function deriveConsumedMessagePDA(
  messageHash: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.consumedMessage, messageHash],
    programId
  );
  return pda;
}

export function deriveFrozenMessagePDA(
  messageHash: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.frozenMessage, messageHash],
    programId
  );
  return pda;
}

export function deriveOutboundMessagePDA(
  bridgeV1Config: PublicKey,
  messageHash: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.outboundMessage, bridgeV1Config.toBuffer(), messageHash],
    programId
  );
  return pda;
}

export function deriveBridgeRoutePDA(
  sourceDomain: number,
  destinationDomain: number,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const srcBytes = Buffer.allocUnsafe(4);
  srcBytes.writeUInt32LE(sourceDomain, 0);
  const dstBytes = Buffer.allocUnsafe(4);
  dstBytes.writeUInt32LE(destinationDomain, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.bridgeRoute, srcBytes, dstBytes],
    programId
  );
  return pda;
}

export function deriveBridgeAssetPDA(
  canonicalAssetId: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.bridgeAsset, canonicalAssetId],
    programId
  );
  return pda;
}

export function derivePendingBufferPDA(
  poolConfig: PublicKey,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.pending, poolConfig.toBuffer()],
    programId
  );
  return pda;
}

export function deriveCommitmentIndexPDA(
  poolConfig: PublicKey,
  commitment: Uint8Array,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEEDS.commitment, poolConfig.toBuffer(), commitment],
    programId
  );
  return pda;
}

// =============================================================================
// Instruction Builder
// =============================================================================

export interface AcceptBridgeV1MintAccounts {
  caller: PublicKey;
  bridgeV1Config: PublicKey;
  signerSet: PublicKey;
  consumedMessage: PublicKey;
  routeConfig: PublicKey;
  assetConfig: PublicKey;
  frozenMessage: PublicKey;
  poolConfig: PublicKey;
  merkleTree: PublicKey;
  pendingBuffer: PublicKey;
  assetVault: PublicKey;
  commitmentIndex: PublicKey;
}

export function buildAcceptBridgeV1MintAccounts(
  message: BridgeMessageV1,
  poolConfig: PublicKey,
  programId: PublicKey = WHITE_PROTOCOL_PROGRAM_ID
): AcceptBridgeV1MintAccounts {
  const messageHashBytes = hexToBytes(hashBridgeMessageV1(message));

  return {
    caller: poolConfig, // placeholder — caller must be a signer
    bridgeV1Config: deriveBridgeV1ConfigPDA(programId),
    signerSet: deriveBridgeSignerSetPDA(1, programId),
    consumedMessage: deriveConsumedMessagePDA(messageHashBytes, programId),
    routeConfig: deriveBridgeRoutePDA(
      message.sourceDomain,
      message.destinationDomain,
      programId
    ),
    assetConfig: deriveBridgeAssetPDA(
      hexToBytes(message.canonicalAssetId),
      programId
    ),
    frozenMessage: deriveFrozenMessagePDA(messageHashBytes, programId),
    poolConfig,
    merkleTree: new PublicKey('11111111111111111111111111111111'), // placeholder
    pendingBuffer: derivePendingBufferPDA(poolConfig, programId),
    assetVault: new PublicKey('11111111111111111111111111111111'), // placeholder
    commitmentIndex: deriveCommitmentIndexPDA(
      poolConfig,
      hexToBytes(message.destinationCommitment),
      programId
    ),
  };
}

// =============================================================================
// Destination Adapter Skeleton
// =============================================================================

export class SolanaDestinationAdapter implements BridgeDestinationAdapter {
  async isMessageConsumed(_messageHash: string): Promise<boolean> {
    // TODO: Implement account fetch once devnet accounts are available
    return false;
  }

  async submitAcceptBridgeMint(
    _message: BridgeMessageV1,
    _signatures: string[],
    _signerSetVersion: number
  ): Promise<string> {
    // TODO: Build and submit Anchor instruction once devnet is ready
    throw new Error(
      'Solana bridge submission is not yet implemented. Use EVM bridge for E2E tests.'
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
