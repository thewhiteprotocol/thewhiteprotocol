import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const POOL_CONFIG = new PublicKey('uUhux7yXzGuA1rCNBQyaTrWuEW6yYUUTSAFnDVaefqw');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Simple keccak256 using js-sha3
const keccak256 = require('js-sha3').keccak256;

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load wallet
  const keypairPath = process.env.ANCHOR_WALLET || "/home/vscode/.config/solana/id.json";
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')))
  );
  console.log('Authority:', keypair.publicKey.toString());
  
  // Load IDL
  const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf-8'));
  
  const provider = new AnchorProvider(
    connection,
    new Wallet(keypair),
    { commitment: 'confirmed' }
  );
  
  const program = new Program(idl, provider);
  
  // Compute asset ID (matches relayer: prefix + mint, first byte = 0)
  const mintBuffer = WSOL_MINT.toBuffer();
  const prefix = Buffer.from('white:asset_id:v1');
  const combined = Buffer.concat([prefix, mintBuffer]);
  const hashHex = keccak256(combined);
  const hashBuffer = Buffer.from(hashHex, 'hex');
  const assetId = Buffer.alloc(32);
  assetId[0] = 0x00;
  hashBuffer.copy(assetId, 1, 0, 31);
  console.log('Asset ID:', Buffer.from(assetId).toString('hex'));
  
  // Derive PDAs
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_v2'), POOL_CONFIG.toBuffer(), Buffer.from(assetId)],
    PROGRAM_ID
  );
  console.log('Asset Vault PDA:', assetVault.toString());
  
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_token'), assetVault.toBuffer()],
    PROGRAM_ID
  );
  console.log('Vault Token Account PDA:', vaultTokenAccount.toString());
  
  // Register asset
  console.log('\nRegistering wrapped SOL...');
  try {
    const tx = await (program.methods as any)
      .registerAsset(Array.from(assetId))
      .accounts({
        authority: keypair.publicKey,
        poolConfig: POOL_CONFIG,
        assetVault: assetVault,
        mint: WSOL_MINT,
        vaultTokenAccount: vaultTokenAccount,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        systemProgram: new PublicKey('11111111111111111111111111111111'),
        rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
      })
      .rpc();
    
    console.log('✅ Asset registered! TX:', tx);
  } catch (e: any) {
    console.error('❌ Failed:', e.message);
    if (e.logs) console.log('Logs:', e.logs);
  }
}

main().catch(console.error);
