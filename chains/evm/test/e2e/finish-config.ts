import { ethers } from 'ethers';

const RPC_URL = 'https://base-sepolia-rpc.publicnode.com';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY!;

const WHITEPROTOCOL = '0x2B79753b6aB1901540de5Ae384a841cC239381DE';
const BRIDGEOUTBOX = '0x7eaFB77E2F05Bf0EbCb8F1A51B187BbcdBCb985D';
const ASSET_ID = '0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70';

const BRIDGEOUTBOX_ABI = [
  'function enableRoute(uint32) external',
  'function supportAsset(bytes32) external',
  'function setOutflowCap(bytes32,uint128) external',
  'function setDailyOutflowCap(bytes32,uint128) external',
  'function setWhiteProtocol(address) external',
];

const WHITEPROTOCOL_ABI = [
  'function setBridgeOutbox(address) external',
];

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const outbox = new ethers.Contract(BRIDGEOUTBOX, BRIDGEOUTBOX_ABI, wallet);
  const wp = new ethers.Contract(WHITEPROTOCOL, WHITEPROTOCOL_ABI, wallet);

  console.log('Finishing BridgeOutbox configuration...');
  const tx1 = await outbox.enableRoute(33554435);
  await tx1.wait();
  console.log('Route enabled');

  const tx2 = await outbox.supportAsset(ASSET_ID);
  await tx2.wait();
  console.log('Asset supported');

  const tx3 = await outbox.setOutflowCap(ASSET_ID, ethers.utils.parseEther('1000'));
  await tx3.wait();
  console.log('Outflow cap set');

  const tx4 = await outbox.setDailyOutflowCap(ASSET_ID, ethers.utils.parseEther('1000'));
  await tx4.wait();
  console.log('Daily outflow cap set');

  const tx5 = await outbox.setWhiteProtocol(WHITEPROTOCOL);
  await tx5.wait();
  console.log('WhiteProtocol set on BridgeOutbox');

  const tx6 = await wp.setBridgeOutbox(BRIDGEOUTBOX);
  await tx6.wait();
  console.log('BridgeOutbox set on WhiteProtocol');

  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
