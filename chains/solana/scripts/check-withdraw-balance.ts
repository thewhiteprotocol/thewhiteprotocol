import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT } from '@solana/spl-token';

const RPC = 'https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343';
const recipient = new PublicKey('Cstwei2C1AH7Cf97vbCJd7CQjJPHuynPCYHniadnnDWR');

(async () => {
  const connection = new Connection(RPC, 'confirmed');
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, recipient);
  
  const balance = await connection.getTokenAccountBalance(ata);
  console.log('Recipient wSOL ATA:', ata.toString());
  console.log('Balance:', balance.value.uiAmount, 'SOL');
  console.log('Raw amount:', balance.value.amount, 'lamports');
  console.log('Expected: 100000000 lamports (0.1 SOL)');
  console.log('Match:', balance.value.amount === '100000000' ? '✅ YES' : '❌ NO');
})();
