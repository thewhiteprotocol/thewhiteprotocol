const { Connection, PublicKey } = require('@solana/web3.js');
const snarkjs = require('snarkjs');

async function main() {
  const conn = new Connection('https://api.devnet.solana.com');
  const depositVk = new PublicKey('BkTmdwbkeX5keYhGxTR5Nim3sxAyayFBGcvhMtndBqcj');
  const info = await conn.getAccountInfo(depositVk);
  
  // Get local VK
  const vk = await snarkjs.zKey.exportVerificationKey('../../circuits/build/deposit.zkey');
  
  // Get first 32 bytes of local alpha_g1.x
  const localAlphaX = BigInt(vk.vk_alpha_1[0]).toString(16).padStart(64, '0');
  console.log('Local alpha_g1.x:', localAlphaX);
  
  // Search for it in account data
  const localBytes = Buffer.from(localAlphaX, 'hex');
  const data = info.data;
  
  console.log('\nAccount data length:', data.length);
  console.log('First 100 bytes (hex):');
  console.log(data.slice(0, 100).toString('hex'));
  
  // Find alpha_g1
  for (let i = 0; i < 100; i++) {
    if (data.slice(i, i + 32).equals(localBytes)) {
      console.log('\nFound alpha_g1.x at offset:', i);
      console.log('Header before alpha:', data.slice(0, i).toString('hex'));
      break;
    }
  }
  
  // Get local beta_g2 x_imag first 32 bytes
  const localBetaXImag = BigInt(vk.vk_beta_2[0][1]).toString(16).padStart(64, '0');
  console.log('\nLocal beta_g2.x_imag:', localBetaXImag);
  const betaBytes = Buffer.from(localBetaXImag, 'hex');
  
  for (let i = 0; i < 200; i++) {
    if (data.slice(i, i + 32).equals(betaBytes)) {
      console.log('Found beta_g2.x_imag at offset:', i);
      break;
    }
  }
}

main().catch(console.error);
