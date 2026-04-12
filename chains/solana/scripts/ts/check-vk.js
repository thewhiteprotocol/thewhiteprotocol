const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const conn = new Connection('https://api.devnet.solana.com');
  const depositVk = new PublicKey('BkTmdwbkeX5keYhGxTR5Nim3sxAyayFBGcvhMtndBqcj');
  
  const info = await conn.getAccountInfo(depositVk);
  if (info === null) {
    console.log('VK account not found');
    return;
  }
  
  console.log('VK account exists, data length:', info.data.length);
  
  const data = info.data;
  const offset = 44;
  const alphaG1X = data.slice(offset, offset + 32);
  const alphaG1Y = data.slice(offset + 32, offset + 64);
  
  console.log('On-chain alpha_g1.x:', alphaG1X.toString('hex'));
  console.log('On-chain alpha_g1.y:', alphaG1Y.toString('hex'));
}

main().catch(console.error);
