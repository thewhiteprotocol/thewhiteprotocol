import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT, getAssociatedTokenAddressSync, createCloseAccountInstruction } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));
const ata = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
console.log('Closing ATA:', ata.toBase58());
const tx = new Transaction().add(createCloseAccountInstruction(ata, authority.publicKey, authority.publicKey));
sendAndConfirmTransaction(connection, tx, [authority]).then(sig => {
  console.log('Closed:', sig);
}).catch(err => {
  console.error('Error:', err.message);
});
