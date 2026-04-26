/**
 * E2E Withdrawal via Production Relayer (fixed recipient for reproducibility)
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { Prover } from '../sdk/src/proof/prover';
import { computeNullifierHash, initPoseidon } from '../sdk/src/crypto/poseidon';
import * as fs from 'fs';
import * as path from 'path';

const RELAYER_URL = 'https://relayer.thewhiteprotocol.com';

// Use depositor wallet as recipient for simplicity
const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
const recipient = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  E2E WITHDRAWAL VIA PRODUCTION RELAYER (FIXED RECIPIENT)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await initPoseidon();

  const notePath = path.join(__dirname, 'e2e-deposit-note.json');
  const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));

  const leafIndex = 0;
  const proofRes = await fetch(`${RELAYER_URL}/api/merkle/proof/${leafIndex}`);
  const proofJson = await proofRes.json();

  const merkleRoot = BigInt(proofJson.merkleRoot);
  const merkleProof = {
    pathElements: proofJson.pathElements.map((e: string) => BigInt(e)),
    pathIndices: proofJson.pathIndices.map((i: number) => i),
  };

  const secret = BigInt(note.secret);
  const nullifier = BigInt(note.nullifier);
  const nullifierHash = computeNullifierHash(nullifier, secret, BigInt(leafIndex));
  // Use the ACTUAL production relayer operator from /status
  const relayerPubkey = new PublicKey('E5JRitRpw769cfmwNqBU2ohz4FszMLJ5tX3ti6teMMWR');
  const relayerFee = (BigInt(note.amount) * 50n) / 10000n;

  console.log('Recipient:', recipient.publicKey.toBase58());

  const prover = new Prover();
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

  // Save payload for debugging
  fs.writeFileSync(path.join(__dirname, 'e2e-withdraw-payload.json'), JSON.stringify(payload, null, 2));
  console.log('Payload saved to e2e-withdraw-payload.json');

  console.log('\n📤 Submitting to relayer...');
  const res = await fetch(`${RELAYER_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  console.log('Response:', JSON.stringify(result, null, 2));

  if (result.success) {
    console.log('\n✅ WITHDRAWAL SUCCESSFUL');
    console.log('Tx:', result.signature);
    fs.writeFileSync(path.join(__dirname, 'e2e-withdraw-result.json'), JSON.stringify({ ...payload, result }, null, 2));
  } else {
    console.log('\n❌ WITHDRAWAL FAILED');
  }
}

main().catch(console.error);
