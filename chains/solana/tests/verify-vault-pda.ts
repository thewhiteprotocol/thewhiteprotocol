import { Connection, PublicKey } from '@solana/web3.js';
async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const PROGRAM_ID = new PublicKey('C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
  const POOL_CONFIG = new PublicKey('EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
  const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const { deriveAssetId } = await import('../sdk/src/crypto/keccak');
  const assetIdBytes = deriveAssetId(NATIVE_MINT);

  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetIdBytes],
    PROGRAM_ID
  );
  console.log('AssetVault:', assetVault.toBase58());

  const [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_token'), assetVault.toBuffer()],
    PROGRAM_ID
  );
  console.log('Vault Token Account (PDA):', vaultTokenAccountPda.toBase58());

  const info = await connection.getAccountInfo(assetVault);
  if (!info) { console.log('AssetVault not found'); process.exit(1); }
  const onChainTokenAccount = new PublicKey(info.data.slice(104, 136));
  console.log('Vault Token Account (on-chain):', onChainTokenAccount.toBase58());
  console.log('Match:', onChainTokenAccount.equals(vaultTokenAccountPda));
}
main();
