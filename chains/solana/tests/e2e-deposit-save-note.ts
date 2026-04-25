/**
 * E2E Deposit with note save — for Group 9 verification
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, createSyncNativeInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { initializeSDK } from '../sdk/src';

const RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
const PENDING_DEPOSITS = new PublicKey('7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw');
const MERKLE_TREE = new PublicKey('2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD');

const TEST_AMOUNT = 0.01 * LAMPORTS_PER_SOL;

function randomField(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let bn = 0n;
  for (let i = 0; i < 31; i++) bn = (bn << 8n) | BigInt(bytes[i]);
  return bn;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  E2E DEPOSIT + SAVE NOTE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await initializeSDK();
  const connection = new Connection(RPC, 'confirmed');
  const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );

  console.log('👤 Depositor:', authority.publicKey.toString());
  const balance = await connection.getBalance(authority.publicKey);
  console.log('💰 Balance:', balance / LAMPORTS_PER_SOL, 'SOL');

  const secret = randomField();
  const nullifier = randomField();
  const amount = BigInt(TEST_AMOUNT);

  const { deriveAssetId } = await import('../sdk/src/crypto/keccak');
  const assetIdBytes = deriveAssetId(NATIVE_MINT);
  const assetIdBigInt = BigInt('0x' + Buffer.from(assetIdBytes).toString('hex'));

  const { hashFour } = await import('../sdk/src/crypto/poseidon');
  const commitment = hashFour(secret, nullifier, amount, assetIdBigInt);

  console.log('\n📝 Note:');
  console.log('   Secret:', secret.toString());
  console.log('   Nullifier:', nullifier.toString());
  console.log('   Amount:', amount.toString());
  console.log('   Asset ID:', assetIdBigInt.toString());
  console.log('   Commitment:', commitment.toString());

  // Save note
  const note = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    amount: amount.toString(),
    assetId: assetIdBigInt.toString(),
    commitment: commitment.toString(),
    asset: 'wSOL',
    chain: 'solana',
    timestamp: Date.now(),
  };
  const notePath = path.join(__dirname, 'e2e-note.json');
  fs.writeFileSync(notePath, JSON.stringify(note, null, 2));
  console.log('\n💾 Note saved to:', notePath);

  // Setup wSOL
  const depositorWSOL = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
  const ataInfo = await connection.getAccountInfo(depositorWSOL);
  const preInstructions = [];
  if (!ataInfo) {
    preInstructions.push(createAssociatedTokenAccountInstruction(
      authority.publicKey, depositorWSOL, authority.publicKey, NATIVE_MINT
    ));
  }
  preInstructions.push(
    SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: depositorWSOL, lamports: TEST_AMOUNT }),
    createSyncNativeInstruction(depositorWSOL)
  );

  // Anchor setup
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), { commitment: 'confirmed' });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as any, provider);

  const [assetVault] = PublicKey.findProgramAddressSync([Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes], PROGRAM_ID);
  const assetVaultData = await program.account.assetVault.fetch(assetVault);
  const vaultTokenAccount = assetVaultData.tokenAccount;
  const [depositVk] = PublicKey.findProgramAddressSync([Buffer.from('vk_deposit'), POOL_CONFIG.toBuffer()], PROGRAM_ID);
  const commitmentBytes = Buffer.from(commitment.toString(16).padStart(64, '0'), 'hex');
  const [commitmentIndex] = PublicKey.findProgramAddressSync([Buffer.from('commitment'), POOL_CONFIG.toBuffer(), commitmentBytes], PROGRAM_ID);

  // Generate proof
  let proofData: Buffer;
  try {
    const { Prover } = await import('../sdk/src/proof/prover');
    const prover = new Prover();
    const result = await prover.generateDepositProof({ secret, nullifier, amount, assetId: assetIdBigInt, commitment });
    proofData = Buffer.from(result.proofData);
    console.log('\n🔐 Proof generated:', proofData.length, 'bytes');
  } catch (e: any) {
    console.error('\n❌ Proof generation failed:', e.message);
    process.exit(1);
  }

  // Submit deposit
  const depositTx = await (program.methods as any)
    .depositMasp(new anchor.BN(amount.toString()), Array.from(commitmentBytes), Array.from(assetIdBytes), proofData, null)
    .accountsStrict({
      depositor: authority.publicKey,
      poolConfig: POOL_CONFIG,
      authority: authority.publicKey,
      merkleTree: MERKLE_TREE,
      pendingBuffer: PENDING_DEPOSITS,
      assetVault: assetVault,
      userTokenAccount: depositorWSOL,
      vaultTokenAccount: vaultTokenAccount,
      depositVk: depositVk,
      commitmentIndex: commitmentIndex,
      mint: NATIVE_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions(preInstructions)
    .rpc();

  console.log('\n✅ DEPOSIT SUCCESSFUL');
  console.log('   Tx:', depositTx);
  console.log('   Explorer: https://explorer.solana.com/tx/' + depositTx + '?cluster=devnet');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
