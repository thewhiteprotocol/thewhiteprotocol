import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { WhiteProtocolClient } from '../sdk/src/client';
import { Prover, pubkeyToScalar } from '../sdk/src/proof/prover';
import { MerkleTree } from '../sdk/src/merkle/tree';
import { computeNullifierHash, hashTwo, initPoseidon } from '../sdk/src/crypto/poseidon';
import * as fs from 'fs';
import * as path from 'path';
import IDL from '../target/idl/white_protocol.json';

const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343';
const POOL_CONFIG = new PublicKey('GZiRVMV7FjrGxjE379HiEyHyVCisHkFnjMJen95kEVEQ');
const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');

async function main() {
  console.log('=== E2E WITHDRAW TEST ===\n');

  // Initialize Poseidon
  await initPoseidon();
  console.log('✓ Poseidon initialized');

  // Load note
  const notePath = path.join(__dirname, 'test-withdraw-note.json');
  const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
  
  if (note.leafIndex === undefined) {
    console.log('❌ Note does not have leafIndex set');
    console.log('   Run: npx ts-node scripts/find-leaf-index.ts');
    process.exit(1);
  }
  
  console.log('\n📝 Loaded note:');
  console.log('   Commitment:', note.commitment);
  console.log('   Amount:', note.amount, 'lamports (0.1 SOL)');
  console.log('   Leaf Index:', note.leafIndex);
  console.log('   Deposit TX:', note.txSignature);
  
  // Load sequencer state to rebuild tree
  const statePath = path.join(__dirname, '../data/sequencer-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  
  console.log('\n🌳 Building Merkle tree from sequencer state...');
  console.log('   Commitments:', state.commitments.length);
  
  // Build tree
  const tree = new MerkleTree(20);
  for (const commitmentHex of state.commitments) {
    tree.insert(BigInt('0x' + commitmentHex));
  }
  
  const merkleRoot = tree.root; // Getter, not method
  console.log('   Root:', merkleRoot.toString(16).slice(0, 16) + '...');
  
  // Get merkle path
  const merklePath = tree.generateProof(note.leafIndex);
  console.log('   Path elements:', merklePath.pathElements.length);
  
  // Setup
  const connection = new Connection(RPC_URL, 'confirmed');
  const recipient = Keypair.generate();
  
  // Load depositor keypair (for relayer)
  const depositorKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('pool-authority-2.json', 'utf8')))
  );
  
  console.log('\n👤 Recipient:', recipient.publicKey.toString());
  console.log('🔄 Relayer:', depositorKeypair.publicKey.toString());
  
  // Compute nullifier hash
  const secret = BigInt(note.secret);
  const nullifier = BigInt(note.nullifier);
  const nullifierHash = computeNullifierHash(nullifier, secret, note.leafIndex);
  console.log('\n🔐 Computed nullifierHash:', nullifierHash.toString(16).slice(0, 16) + '...');
  
  // Compute public data hash
  const recipientScalar = pubkeyToScalar(recipient.publicKey);
  const relayerScalar = pubkeyToScalar(depositorKeypair.publicKey);
  const publicDataHash = 0n; // Must be zero to match on-chain (line 276 withdraw_masp.rs)
  console.log('🔐 Computed publicDataHash:', publicDataHash.toString(16).slice(0, 16) + '...');
  
  // Initialize SDK
  const client = new WhiteProtocolClient({
    connection,
    wallet: depositorKeypair,
    programId: PROGRAM_ID,
    idl: IDL,
  });
  
  console.log('\n✅ SDK initialized');
  
  // Generate withdraw proof
  console.log('\n🔐 Generating withdraw proof...');
  const prover = new Prover();
  
  const withdrawProof = await prover.generateWithdrawProof({
    // Public inputs
    merkleRoot,
    nullifierHash,
    assetId: BigInt(note.assetId),
    recipient: recipient.publicKey,
    amount: BigInt(note.amount),
    relayer: depositorKeypair.publicKey,
    relayerFee: 0n,
    publicDataHash,
    // Private inputs
    secret,
    nullifier,
    leafIndex: note.leafIndex,
    merkleProof: merklePath,
  });
  
  console.log('✅ Proof generated');
  console.log('   Proof size:', withdrawProof.proofData.length, 'bytes');
  console.log('   Public inputs:', withdrawProof.publicInputs.length);
  
  // Submit withdraw
  console.log('\n📤 Submitting withdraw transaction...');
  
  // Convert merkleRoot and nullifierHash to Uint8Array (little-endian)
  function bigintToBytes32(value: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[31 - i] = Number((value >> BigInt(i * 8)) & 0xFFn);
    }
    return bytes;
  }
  
  const merkleRootBytes = bigintToBytes32(merkleRoot);
  const nullifierHashBytes = bigintToBytes32(nullifierHash);
  
  try {
    const result = await client.withdraw(
      POOL_CONFIG,
      NATIVE_MINT,
      recipient.publicKey,
      BigInt(note.amount),
      merkleRootBytes,
      nullifierHashBytes,
      withdrawProof.proofData,
      0n
    );
    
    console.log('\n✅ WITHDRAW SUCCESSFUL!');
    console.log('   Signature:', result.signature);
    console.log('   Explorer: https://explorer.solana.com/tx/' + result.signature + '?cluster=devnet');
    
    // Check recipient balance
    await new Promise(resolve => setTimeout(resolve, 2000));
    const balance = await connection.getBalance(recipient.publicKey);
    console.log('\n💰 Recipient balance:', (balance / 1e9).toFixed(4), 'SOL');
    
  } catch (error: any) {
    console.log('\n❌ WITHDRAW FAILED');
    console.log('Error:', error.message);
    if (error.logs) {
      console.log('\nTransaction logs:');
      error.logs.forEach((log: string) => console.log('  ', log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
