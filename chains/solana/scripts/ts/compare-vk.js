const { Connection, PublicKey } = require('@solana/web3.js');
const snarkjs = require('snarkjs');

async function main() {
  // Get on-chain VK
  const conn = new Connection('https://api.devnet.solana.com');
  const depositVk = new PublicKey('BkTmdwbkeX5keYhGxTR5Nim3sxAyayFBGcvhMtndBqcj');
  const info = await conn.getAccountInfo(depositVk);
  
  // Get local VK from zkey
  const vk = await snarkjs.zKey.exportVerificationKey('../../circuits/build/deposit.zkey');
  
  // Convert local alpha_g1.x to bytes (big-endian)
  const localAlphaX = BigInt(vk.vk_alpha_1[0]);
  const localAlphaXHex = localAlphaX.toString(16).padStart(64, '0');
  
  console.log('=== LOCAL VK (from zkey) ===');
  console.log('alpha_g1.x (hex):', localAlphaXHex);
  
  console.log('\n=== ON-CHAIN VK ===');
  const data = info.data;
  // Try different offsets to find alpha_g1
  for (let offset of [44, 45, 46, 47, 48, 64, 72, 80]) {
    const alphaX = data.slice(offset, offset + 32).toString('hex');
    console.log('offset ' + offset + ': ' + alphaX);
  }
  
  // Also check if local matches any of them
  console.log('\n=== MATCHING ===');
  const localBytes = Buffer.from(localAlphaXHex, 'hex');
  for (let offset = 0; offset < 200; offset++) {
    const chunk = data.slice(offset, offset + 32);
    if (chunk.equals(localBytes)) {
      console.log('MATCH at offset', offset);
    }
  }
}

main().catch(console.error);
