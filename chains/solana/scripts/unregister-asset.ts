import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const POOL_CONFIG = new PublicKey('uUhux7yXzGuA1rCNBQyaTrWuEW6yYUUTSAFnDVaefqw');
const ASSET_VAULT = new PublicKey('Hxo8HEfd7HjD2SkfARopHm8sin7VcyKjAdFSMU26hUs5');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('/home/vscode/.config/solana/pool-authority-v4.json', 'utf-8')))
  );
  
  const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf-8'));
  const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: 'confirmed' });
  const program = new Program(idl, provider);
  
  // Get asset vault data to find vault token account
  const assetVaultData = await connection.getAccountInfo(ASSET_VAULT);
  const vaultTokenAccount = new PublicKey('DZRY6cr8W8qrPohDrL1BAYxyJzKcPMnYSTd2XmUHByUN');
  
  console.log('Unregistering asset...');
  const tx = await (program.methods as any)
    .unregisterAsset()
    .accounts({
      authority: keypair.publicKey,
      poolConfig: POOL_CONFIG,
      assetVault: ASSET_VAULT,
      vaultTokenAccount: vaultTokenAccount,
      tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    })
    .rpc();
  
  console.log('✅ Asset unregistered! TX:', tx);
}

main().catch(console.error);
