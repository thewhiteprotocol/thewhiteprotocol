const { Connection, PublicKey } = require('@solana/web3.js');
const snarkjs = require('snarkjs');

async function main() {
  const conn = new Connection('https://api.devnet.solana.com');
  const depositVk = new PublicKey('BkTmdwbkeX5keYhGxTR5Nim3sxAyayFBGcvhMtndBqcj');
  const info = await conn.getAccountInfo(depositVk);
  
  // Get local VK
  const vk = await snarkjs.zKey.exportVerificationKey('../../circuits/build/deposit.zkey');
  
  // Convert local beta_g2 to expected byte format
  // snarkjs: vk_beta_2[axis][coeff] where coeff 0=real, 1=imaginary
  // On-chain expects: x_imag || x_real || y_imag || y_real
  const beta_x_imag = BigInt(vk.vk_beta_2[0][1]).toString(16).padStart(64, '0');
  const beta_x_real = BigInt(vk.vk_beta_2[0][0]).toString(16).padStart(64, '0');
  const beta_y_imag = BigInt(vk.vk_beta_2[1][1]).toString(16).padStart(64, '0');
  const beta_y_real = BigInt(vk.vk_beta_2[1][0]).toString(16).padStart(64, '0');
  
  console.log('=== LOCAL VK beta_g2 (expected on-chain format) ===');
  console.log('x_imag:', beta_x_imag.slice(0, 40) + '...');
  console.log('x_real:', beta_x_real.slice(0, 40) + '...');
  
  // On-chain: skip header (discriminator 8 + pool 32 + proof_type 1 + bump 1 + is_init 1 + padding 1 = 44)
  // Then: alpha_g1 (64) + beta_g2 (128) = beta starts at offset 108
  const betaOffset = 44 + 64;
  const onchainBetaXImag = info.data.slice(betaOffset, betaOffset + 32).toString('hex');
  const onchainBetaXReal = info.data.slice(betaOffset + 32, betaOffset + 64).toString('hex');
  
  console.log('\n=== ON-CHAIN VK beta_g2 ===');
  console.log('x_imag:', onchainBetaXImag.slice(0, 40) + '...');
  console.log('x_real:', onchainBetaXReal.slice(0, 40) + '...');
  
  console.log('\n=== MATCH? ===');
  console.log('x_imag matches:', beta_x_imag === onchainBetaXImag);
  console.log('x_real matches:', beta_x_real === onchainBetaXReal);
}

main().catch(console.error);
