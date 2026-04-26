import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { Prover } from '../sdk/src/proof/prover';
import { computeNullifierHash, initPoseidon } from '../sdk/src/crypto/poseidon';
import * as fs from 'fs';
import * as path from 'path';
import * as snarkjs from 'snarkjs';

const RELAYER_URL = 'https://relayer.thewhiteprotocol.com';

async function main() {
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

  const recipient = Keypair.generate().publicKey;
  const secret = BigInt(note.secret);
  const nullifier = BigInt(note.nullifier);
  const nullifierHash = computeNullifierHash(nullifier, secret, BigInt(leafIndex));
  const relayerPubkey = new PublicKey('8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey');
  const relayerFee = (BigInt(note.amount) * 50n) / 10000n;

  console.log('=== INPUTS ===');
  console.log('merkleRoot:', merkleRoot.toString());
  console.log('nullifierHash:', nullifierHash.toString());
  console.log('assetId:', note.assetId);
  console.log('recipient:', recipient.toBase58());
  console.log('amount:', note.amount);
  console.log('relayer:', relayerPubkey.toBase58());
  console.log('relayerFee:', relayerFee.toString());
  console.log('publicDataHash:', 0);
  console.log('secret:', secret.toString());
  console.log('nullifier:', nullifier.toString());
  console.log('leafIndex:', leafIndex);

  const prover = new Prover();
  const withdrawProof = await prover.generateWithdrawProof({
    merkleRoot,
    nullifierHash,
    assetId: BigInt(note.assetId),
    amount: BigInt(note.amount),
    recipient,
    relayer: relayerPubkey,
    relayerFee,
    publicDataHash: 0n,
    secret,
    nullifier,
    leafIndex: BigInt(leafIndex),
    merkleProof,
  });

  console.log('\n=== PUBLIC SIGNALS ===');
  withdrawProof.publicInputs.forEach((s, i) => console.log(`  [${i}]: ${s.toString()}`));

  // Try local verification with relayer's vkey
  const vkey = JSON.parse(fs.readFileSync('../../circuits/withdraw/build/withdraw_vk.json', 'utf8'));
  const proof = deserializeProof(withdrawProof.proofData);

  console.log('\n=== LOCAL VERIFICATION ===');
  const publicSignals = withdrawProof.publicInputs.map(s => s.toString());
  const result = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log('SDK local verify result:', result);

  // Now verify with relayer-style deserialization
  const proof2 = deserializeRelayerStyle(withdrawProof.proofData);
  const result2 = await snarkjs.groth16.verify(vkey, publicSignals, proof2);
  console.log('Relayer-style verify result:', result2);
}

function deserializeProof(data: Uint8Array) {
  const read = (off: number) => BigInt('0x' + Buffer.from(data.slice(off, off + 32)).toString('hex')).toString();
  return {
    pi_a: [read(0), read(32), '1'],
    pi_b: [
      [read(96), read(64)],
      [read(160), read(128)],
      ['1', '0'],
    ],
    pi_c: [read(192), read(224), '1'],
    protocol: 'groth16',
    curve: 'bn128',
  };
}

function deserializeRelayerStyle(data: Uint8Array) {
  const read = (off: number) => BigInt('0x' + Buffer.from(data.slice(off, off + 32)).toString('hex')).toString();
  return {
    pi_a: [read(0), read(32), '1'],
    pi_b: [
      [read(96), read(64)],  // b00, b01
      [read(160), read(128)], // b10, b11
      ['1', '0'],
    ],
    pi_c: [read(192), read(224), '1'],
    protocol: 'groth16',
    curve: 'bn128',
  };
}

main().catch(console.error);
