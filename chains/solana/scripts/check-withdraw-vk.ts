const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const POOL = new PublicKey('DPZe7uST1mBxzVkEm215epHjsM7Sa8VCXHr3pv4eLp8X');
const [withdrawVk] = PublicKey.findProgramAddressSync(
  [Buffer.from('vk_withdraw'), POOL.toBuffer()], PROGRAM_ID
);
provider.connection.getAccountInfo(withdrawVk).then(acc => {
  console.log('Withdraw VK exists:', acc ? 'YES' : 'NO');
  if (acc === null) console.log('Withdraw circuit/VK not deployed yet');
});
