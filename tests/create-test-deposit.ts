/**
 * Create Test Deposit for Withdraw Testing
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getOrCreateAssociatedTokenAccount, createSyncNativeInstruction } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import IDL from '../target/idl/white_protocol.json';

const circomlibjs = require('circomlibjs');

// Config
const RPC = 'https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343';
const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const POOL_CONFIG = new PublicKey('GZiRVMV7FjrGxjE379HiEyHyVCisHkFnjMJen95kEVEQ');
const MERKLE_TREE = new PublicKey('GCG4QojHbjs15ucxHfW9G1bFzYyYZGzsvWRNEAj6pckk');
const PENDING_BUFFER = new PublicKey('6xMy76sHFVCvFewzL6FaSDts4fd1K86QwXVNy6RyhhL2');

// Test amount: 0.1 SOL
const TEST_AMOUNT = 0.1 * 1e9; // 100,000,000 lamports

let poseidon: any, F: any;

async function initPoseidon() {
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((x: bigint) => F.e(x)));
  return F.toObject(hash);
}

function computeAssetId(mint: PublicKey): Buffer {
  const keccak = require('js-sha3').keccak256;
  const prefix = Buffer.from('white:asset_id:v1');
  const combined = Buffer.concat([prefix, mint.toBuffer()]);
  const hash = Buffer.from(keccak(combined), 'hex');
  const assetId = Buffer.alloc(32);
  assetId[0] = 0x00;
  hash.copy(assetId, 1, 0, 31);
  return assetId;
}

function randomField(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let bn = 0n;
  for (let i = 0; i < 31; i++) {
    bn = (bn << 8n) | BigInt(bytes[i]);
  }
  return bn;
}

async function main() {
  console.log('=== CREATE TEST DEPOSIT ===\n');
  
  await initPoseidon();
  
  const connection = new Connection(RPC, 'confirmed');
  const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  
  console.log('Depositor:', authority.publicKey.toString());
  
  // Generate note secrets
  const secret = randomField();
  const nullifier = randomField();
  const amount = BigInt(TEST_AMOUNT);
  const assetId = computeAssetId(NATIVE_MINT);
  const assetIdBigInt = BigInt('0x' + assetId.toString('hex'));
  
  console.log('\n📝 Note Details:');
  console.log('   Secret:', secret.toString());
  console.log('   Nullifier:', nullifier.toString());
  console.log('   Amount:', amount.toString(), '(0.1 SOL)');
  console.log('   Asset ID:', assetIdBigInt.toString());
  
  // Compute commitment
  const commitment = poseidonHash([secret, nullifier, amount, assetIdBigInt]);
  console.log('   Commitment:', commitment.toString());
  
  // For now, just save the note - we'll add deposit transaction in next step
  const note = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    amount: amount.toString(),
    assetId: assetIdBigInt.toString(),
    commitment: commitment.toString(),
    mint: NATIVE_MINT.toString(),
    createdAt: new Date().toISOString(),
    settled: false,
    leafIndex: null // Will be set after deposit + settle
  };
  
  const noteFile = path.join(__dirname, 'test-withdraw-note.json');
  fs.writeFileSync(noteFile, JSON.stringify(note, null, 2));
  
  console.log('\n✅ Test note saved to:', noteFile);
  console.log('\n⚠️  NOTE: Deposit transaction not implemented yet');
  console.log('This is just the note preparation step.');
  console.log('\nNext: Implement actual deposit transaction');
}

main().catch(console.error);
