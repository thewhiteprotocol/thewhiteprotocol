/**
 * E2E Withdrawal via Production Relayer
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { Prover } from '../sdk/src/proof/prover';
import { computeNullifierHash, initPoseidon } from '../sdk/src/crypto/poseidon';
import * as fs from 'fs';
import * as path from 'path';

const RPC = 'https://api.devnet.solana.com';
const RELAYER_URL = 'https://relayer.thewhiteprotocol.com';
const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  E2E WITHDRAWAL VIA PRODUCTION RELAYER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await initPoseidon();

  // Load note
  const notePath = path.join(__dirname, 'e2e-deposit-note.json');
  if (!fs.existsSync(notePath)) {
    console.error('❌ Note file not found:', notePath);
    console.error('   Run e2e-01-deposit.ts first.');
    process.exit(1);
  }
  const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
  console.log('📝 Note loaded:');
  console.log('   Commitment:', note.commitment);
  console.log('   Amount:', note.amount);

  // Determine leaf index — settled deposits are at index 0 after reset
  const leafIndex = 0;
  console.log('   Leaf index:', leafIndex);

  // Query relayer for Merkle proof
  console.log('\n🌳 Fetching Merkle proof from relayer...');
  const proofRes = await fetch(`${RELAYER_URL}/api/merkle/proof/${leafIndex}`);
  const proofJson = await proofRes.json();
  if (!proofJson.success) {
    console.error('❌ Failed to fetch Merkle proof:', proofJson);
    process.exit(1);
  }

  const merkleRoot = BigInt(proofJson.merkleRoot);
  const merkleProof = {
    pathElements: proofJson.pathElements.map((e: string) => BigInt(e)),
    pathIndices: proofJson.pathIndices.map((i: number) => i),
  };
  console.log('   Merkle root:', merkleRoot.toString(16).slice(0, 16) + '...');

  // Generate recipient (random for test)
  const recipient = Keypair.generate();
  console.log('\n👤 Recipient:', recipient.publicKey.toString());

  // Compute nullifier hash
  const secret = BigInt(note.secret);
  const nullifier = BigInt(note.nullifier);
  const nullifierHash = computeNullifierHash(nullifier, secret, BigInt(leafIndex));
  console.log('🔐 Nullifier hash:', nullifierHash.toString(16).slice(0, 16) + '...');

  // Generate withdraw proof
  const prover = new Prover();
  const relayerPubkey = new PublicKey('8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey');
  const feeBps = 50n;
  const relayerFee = (BigInt(note.amount) * feeBps) / 10000n;
  console.log('   Relayer fee:', relayerFee.toString(), 'lamports');

  console.log('\n🔐 Generating withdraw proof...');
  const withdrawProof = await prover.generateWithdrawProof({
    merkleRoot,
    nullifierHash,
    assetId: BigInt(note.assetId),
    amount: BigInt(note.amount),
    recipient: recipient.publicKey,
    relayer: relayerPubkey,
    relayerFee,
    publicDataHash: 0n,
    secret,
    nullifier,
    leafIndex: BigInt(leafIndex),
    merkleProof,
  });
  console.log('   Proof generated:', withdrawProof.proofData.length, 'bytes');

  // Submit to relayer
  const payload = {
    proofData: Buffer.from(withdrawProof.proofData).toString('hex'),
    merkleRoot: merkleRoot.toString(16).padStart(64, '0'),
    nullifierHash: nullifierHash.toString(16).padStart(64, '0'),
    recipient: recipient.publicKey.toBase58(),
    amount: note.amount,
    assetId: BigInt(note.assetId).toString(16).padStart(64, '0'),
    mint: NATIVE_MINT.toBase58(),
    chain: 'solana',
  };

  console.log('\n📤 Submitting to relayer...');
  const res = await fetch(`${RELAYER_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  console.log('   Response:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('\n✅ WITHDRAWAL SUCCESSFUL');
    console.log('   Tx:', result.signature);

    // Save withdrawal result
    fs.writeFileSync(
      path.join(__dirname, 'e2e-withdraw-result.json'),
      JSON.stringify({ ...payload, result }, null, 2)
    );
  } else {
    console.log('\n❌ WITHDRAWAL FAILED');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
