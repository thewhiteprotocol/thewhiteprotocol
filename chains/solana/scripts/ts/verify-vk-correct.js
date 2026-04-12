const { Connection, PublicKey } = require('@solana/web3.js');
const snarkjs = require('snarkjs');

async function main() {
  const conn = new Connection('https://api.devnet.solana.com');
  const depositVk = new PublicKey('BkTmdwbkeX5keYhGxTR5Nim3sxAyayFBGcvhMtndBqcj');
  const info = await conn.getAccountInfo(depositVk);
  
  const vk = await snarkjs.zKey.exportVerificationKey('../../circuits/build/deposit.zkey');
  const data = info.data;
  
  console.log('=== ALPHA_G1 (offset 41) ===');
  const localAlphaX = BigInt(vk.vk_alpha_1[0]).toString(16).padStart(64, '0');
  const onchainAlphaX = data.slice(41, 73).toString('hex');
  console.log('Local:   ', localAlphaX);
  console.log('On-chain:', onchainAlphaX);
  console.log('Match:', localAlphaX === onchainAlphaX);
  
  console.log('\n=== BETA_G2 (offset 105) ===');
  const localBetaXImag = BigInt(vk.vk_beta_2[0][1]).toString(16).padStart(64, '0');
  const localBetaXReal = BigInt(vk.vk_beta_2[0][0]).toString(16).padStart(64, '0');
  const onchainBetaXImag = data.slice(105, 137).toString('hex');
  const onchainBetaXReal = data.slice(137, 169).toString('hex');
  
  console.log('x_imag local:   ', localBetaXImag);
  console.log('x_imag on-chain:', onchainBetaXImag);
  console.log('x_imag match:', localBetaXImag === onchainBetaXImag);
  
  console.log('x_real local:   ', localBetaXReal);
  console.log('x_real on-chain:', onchainBetaXReal);
  console.log('x_real match:', localBetaXReal === onchainBetaXReal);
}

main().catch(console.error);
