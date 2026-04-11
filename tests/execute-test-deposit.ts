/**
 * Execute Test Deposit Transaction
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { WhiteProtocolClient, Prover, initializeSDK } from '../sdk/src';
import IDL from '../target/idl/white_protocol.json';

// Config
const RPC = 'https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343';
const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const POOL_CONFIG = new PublicKey('GZiRVMV7FjrGxjE379HiEyHyVCisHkFnjMJen95kEVEQ');

function bigintToBytes32(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function main() {
  console.log('=== EXECUTE TEST DEPOSIT ===\n');
  
  // Initialize SDK
  await initializeSDK();
  console.log('✅ SDK initialized');
  
  // Load saved note
  const noteFile = path.join(__dirname, 'test-withdraw-note.json');
  if (!fs.existsSync(noteFile)) {
    console.error('❌ No test note found. Run: npx ts-node tests/create-test-deposit.ts');
    process.exit(1);
  }
  
  const note = JSON.parse(fs.readFileSync(noteFile, 'utf-8'));
  console.log('\n📝 Loaded note:');
  console.log('   Commitment:', note.commitment);
  console.log('   Amount:', note.amount, 'lamports (0.1 SOL)');
  
  // Load wallet
  const connection = new Connection(RPC, 'confirmed');
  const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  
  console.log('\n👤 Depositor:', authority.publicKey.toString());
  
  // Initialize SDK client
  const client = new WhiteProtocolClient({
    connection,
    wallet: authority,
    programId: PROGRAM_ID,
    idl: IDL,
  });
  
  // Initialize Prover (uses default circuit paths)
  const prover = new Prover();
  
  console.log('\n🔐 Generating deposit proof...');
  
  // Prepare proof inputs
  const proofInputs = {
    secret: BigInt(note.secret),
    nullifier: BigInt(note.nullifier),
    amount: BigInt(note.amount),
    assetId: BigInt(note.assetId),
    commitment: BigInt(note.commitment),
  };
  
  const { proofData, publicInputs } = await prover.generateDepositProof(proofInputs);
  
  console.log('✅ Proof generated');
  console.log('   Proof type:', proofData.constructor.name);
  console.log('   Proof size:', proofData.length, 'bytes');
  console.log('   Public inputs:', publicInputs.length);
  
  // Convert commitment to bytes
  const commitmentBytes = bigintToBytes32(BigInt(note.commitment));
  
  // Ensure proofData is a Buffer (Anchor requirement)
  const proofBuffer = Buffer.from(proofData);
  console.log('   Proof buffer length:', proofBuffer.length);
  
  console.log('\n📤 Submitting deposit transaction...');
  
  try {
    const result = await client.deposit(
      POOL_CONFIG,
      NATIVE_MINT,
      BigInt(note.amount),
      commitmentBytes,
      proofBuffer,  // Use Buffer instead of Uint8Array
      null // no encrypted note
    );
    
    console.log('\n✅ DEPOSIT SUCCESSFUL!');
    console.log('   Signature:', result.signature);
    console.log('   Explorer: https://explorer.solana.com/tx/' + result.signature + '?cluster=devnet');
    
    // Update note
    note.txSignature = result.signature;
    note.pending = true;
    note.settled = false;
    note.depositedAt = new Date().toISOString();
    
    fs.writeFileSync(noteFile, JSON.stringify(note, null, 2));
    console.log('\n✅ Note updated and saved');
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 NEXT STEPS:');
    console.log('='.repeat(60));
    console.log('1. Wait ~5 seconds for tx confirmation');
    console.log('2. Run sequencer: npx ts-node scripts/sequencer-production.ts');
    console.log('3. Test withdraw: npx ts-node tests/test-withdraw-e2e.ts');
    console.log('='.repeat(60));
    
  } catch (error: any) {
    console.error('\n❌ DEPOSIT FAILED');
    console.error('Error:', error.message);
    if (error.logs) {
      console.error('\nTransaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
