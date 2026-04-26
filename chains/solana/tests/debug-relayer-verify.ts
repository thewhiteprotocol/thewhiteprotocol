import * as fs from 'fs';
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';
import * as snarkjs from 'snarkjs';

const BN254_FIELD_ORDER = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex: odd length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error(`Invalid hex character at position ${i * 2}`);
    bytes[i] = byte;
  }
  return bytes;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function pubkeyToScalar(pubkey: PublicKey): bigint {
  const bytes = pubkey.toBytes();
  const scalarBytes = new Uint8Array(32);
  scalarBytes[0] = 0;
  scalarBytes.set(bytes.slice(0, 31), 1);
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(scalarBytes[i]);
  }
  return result;
}

function validateFieldElement(value: bigint, name: string): void {
  if (value < 0n) throw new Error(`${name} is negative: ${value}`);
  if (value >= BN254_FIELD_ORDER) throw new Error(`${name} exceeds field order: ${value}`);
}

interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

function deserializeGroth16Proof(proofData: Uint8Array): Groth16Proof {
  if (proofData.length !== 256) throw new Error(`Invalid proof data length: expected 256, got ${proofData.length}`);
  const slice = (start: number, end: number) => proofData.slice(start, end);
  const a0 = bytesToBigInt(slice(0, 32)).toString();
  const a1 = bytesToBigInt(slice(32, 64)).toString();
  const b01 = bytesToBigInt(slice(64, 96)).toString();
  const b00 = bytesToBigInt(slice(96, 128)).toString();
  const b11 = bytesToBigInt(slice(128, 160)).toString();
  const b10 = bytesToBigInt(slice(160, 192)).toString();
  const c0 = bytesToBigInt(slice(192, 224)).toString();
  const c1 = bytesToBigInt(slice(224, 256)).toString();
  return {
    pi_a: [a0, a1, '1'],
    pi_b: [[b00, b01], [b10, b11], ['1', '0']],
    pi_c: [c0, c1, '1'],
    protocol: 'groth16',
    curve: 'bn128',
  };
}

async function main() {
  const payloadPath = path.join(__dirname, 'e2e-withdraw-payload.json');
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

  console.log('=== PAYLOAD ===');
  console.log(JSON.stringify(payload, null, 2));

  const proofData = hexToBytes(payload.proofData);
  const merkleRoot = hexToBytes(payload.merkleRoot);
  const nullifierHash = hexToBytes(payload.nullifierHash);
  const assetId = hexToBytes(payload.assetId);
  const recipient = new PublicKey(payload.recipient);
  const amount = BigInt(payload.amount);
  const relayer = new PublicKey('8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey');
  const relayerFee = (amount * 50n) / 10000n;

  console.log('\n=== PARSED VALUES ===');
  console.log('merkleRoot hex:', payload.merkleRoot);
  console.log('nullifierHash hex:', payload.nullifierHash);
  console.log('assetId hex:', payload.assetId);
  console.log('recipient:', recipient.toBase58());
  console.log('amount:', amount.toString());
  console.log('relayer:', relayer.toBase58());
  console.log('relayerFee:', relayerFee.toString());

  const merkleRootScalar = bytesToBigInt(merkleRoot);
  const nullifierHashScalar = bytesToBigInt(nullifierHash);
  const assetIdScalar = bytesToBigInt(assetId);
  const recipientScalar = pubkeyToScalar(recipient);
  const relayerScalar = pubkeyToScalar(relayer);
  const publicDataHashScalar = 0n;

  console.log('\n=== SCALARS ===');
  console.log('merkleRootScalar:', merkleRootScalar.toString());
  console.log('nullifierHashScalar:', nullifierHashScalar.toString());
  console.log('assetIdScalar:', assetIdScalar.toString());
  console.log('recipientScalar:', recipientScalar.toString());
  console.log('relayerScalar:', relayerScalar.toString());
  console.log('amount:', amount.toString());
  console.log('relayerFee:', relayerFee.toString());
  console.log('publicDataHashScalar:', publicDataHashScalar.toString());

  validateFieldElement(merkleRootScalar, 'merkleRoot');
  validateFieldElement(nullifierHashScalar, 'nullifierHash');
  validateFieldElement(assetIdScalar, 'assetId');
  validateFieldElement(recipientScalar, 'recipient');
  validateFieldElement(relayerScalar, 'relayer');
  validateFieldElement(publicDataHashScalar, 'publicDataHash');
  validateFieldElement(amount, 'amount');
  validateFieldElement(relayerFee, 'relayerFee');

  const publicSignals = [
    merkleRootScalar.toString(),
    nullifierHashScalar.toString(),
    assetIdScalar.toString(),
    recipientScalar.toString(),
    amount.toString(),
    relayerScalar.toString(),
    relayerFee.toString(),
    publicDataHashScalar.toString(),
  ];

  console.log('\n=== PUBLIC SIGNALS ===');
  publicSignals.forEach((s, i) => console.log(`[${i}]: ${s}`));

  const proof = deserializeGroth16Proof(proofData);
  console.log('\n=== PROOF ===');
  console.log('pi_a:', proof.pi_a);
  console.log('pi_b[0]:', proof.pi_b[0]);
  console.log('pi_b[1]:', proof.pi_b[1]);
  console.log('pi_c:', proof.pi_c);

  const vkey = JSON.parse(fs.readFileSync('../../circuits/withdraw/build/withdraw_vk.json', 'utf8'));

  console.log('\n=== VERIFYING ===');
  try {
    const result = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    console.log('Result:', result);
  } catch (err) {
    console.log('Error:', err);
  }
}

main().catch(console.error);
