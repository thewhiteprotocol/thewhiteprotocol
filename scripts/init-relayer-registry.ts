import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import IDL from '../target/idl/white_protocol.json';

const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343';
const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const POOL_CONFIG = new PublicKey('uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc');

async function main() {
  console.log('=== INITIALIZING POOL REGISTRIES ===\n');

  // Load authority keypair
  const authorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync('.keys/pool-authority-v9.json', 'utf8')))
  );
  console.log('Authority:', authorityKeypair.publicKey.toString());

  // Setup provider
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new Wallet(authorityKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as any, provider);

  // Derive PDAs
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('relayer_registry'), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [complianceConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('compliance'), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log('Relayer Registry PDA:', relayerRegistry.toString());
  console.log('Compliance Config PDA:', complianceConfig.toString());

  // Check if already initialized
  const registryInfo = await connection.getAccountInfo(relayerRegistry);
  if (registryInfo) {
    console.log('\n✓ Pool registries already initialized');
    return;
  }

  console.log('\n📝 Initializing pool registries...');

  try {
    const tx = await (program.methods as any)
      .initializePoolRegistries()
      .accounts({
        authority: authorityKeypair.publicKey,
        poolConfig: POOL_CONFIG,
        relayerRegistry,
        complianceConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('\n✅ Pool registries initialized!');
    console.log('   Signature:', tx);
    console.log('   Explorer: https://explorer.solana.com/tx/' + tx + '?cluster=devnet');
    
    // Verify
    const info = await connection.getAccountInfo(relayerRegistry);
    console.log('   Relayer registry exists:', !!info);
  } catch (error: any) {
    console.log('\n❌ Failed to initialize pool registries');
    console.log('Error:', error.message);
    if (error.logs) {
      console.log('\nLogs:');
      error.logs.forEach((log: string) => console.log('  ', log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
