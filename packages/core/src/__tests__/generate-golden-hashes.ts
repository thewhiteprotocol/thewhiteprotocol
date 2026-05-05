/**
 * Generate actual golden hash values from TypeScript implementation.
 * Run with: npx tsx packages/core/src/__tests__/generate-golden-hashes.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  hashBridgeMessageV1,
  BridgeMessageV1,
  BridgeMessageType,
} from '../bridge-message.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const raw = readFileSync(join(__dirname, 'bridge-message-golden.json'), 'utf-8');
const golden = JSON.parse(raw);

for (const v of golden.vectors) {
  const m = v.message;
  const msg: BridgeMessageV1 = {
    protocolVersion: m.protocolVersion,
    messageType: m.messageType as BridgeMessageType,
    sourceDomain: m.sourceDomain,
    destinationDomain: m.destinationDomain,
    sourceChainId: m.sourceChainId,
    destinationChainId: m.destinationChainId,
    canonicalAssetId: m.canonicalAssetId,
    sourceLocalAssetId: m.sourceLocalAssetId,
    destinationLocalAssetId: m.destinationLocalAssetId,
    amount: BigInt(m.amount),
    sourceNullifierHash: m.sourceNullifierHash,
    destinationCommitment: m.destinationCommitment,
    sourceRoot: m.sourceRoot,
    sourceLeafIndex: m.sourceLeafIndex,
    sourceTxHash: m.sourceTxHash,
    sourceBlockNumber: m.sourceBlockNumber,
    sourceFinalityBlock: m.sourceFinalityBlock,
    nonce: m.nonce,
    deadline: m.deadline,
    relayerFee: BigInt(m.relayerFee),
    recipientStealthMetadataHash: m.recipientStealthMetadataHash,
    memoHash: m.memoHash,
    reserved0: m.reserved0,
    reserved1: m.reserved1,
  };
  const hash = hashBridgeMessageV1(msg);
  v.expectedHash = hash;
  console.log(`${v.name}`);
  console.log(`  Hash: ${hash}`);
}

writeFileSync(join(__dirname, 'bridge-message-golden.json'), JSON.stringify(golden, null, 2));
console.log('\nUpdated bridge-message-golden.json with computed hashes.');
