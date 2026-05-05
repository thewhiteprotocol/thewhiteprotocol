/**
 * Redeploy WhiteProtocol on Base Sepolia with PR-010H fix
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://base-sepolia-rpc.publicnode.com';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

function loadArtifact(name: string): { abi: any[]; bytecode: string } {
  const file = path.join(__dirname, '../../out', name + '.sol', name + '.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function linkBytecode(bytecode: string, libraryName: string, libraryAddress: string): string {
  const placeholderRegex = /__[\$][a-f0-9]{34}[\$]__/g;
  const addressPadded = libraryAddress.toLowerCase().replace(/^0x/, '').padStart(40, '0');
  return bytecode.replace(placeholderRegex, addressPadded);
}

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  const oldArtifact = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../deployments/base-sepolia-pr010g-backup.json'), 'utf8')
  );

  // Existing deployed contracts
  const POSEIDON_T3 = '0xeb7c3A1f37CBB1681E515d0B9682d12E66D312Ce';
  const ASSET_REGISTRY = '0xB4B46638a9EA2F2D1e425630181404249bBa1503';
  const BRIDGE_OUTBOX = '0x7eaFB77E2F05Bf0EbCb8F1A51B187BbcdBCb985D';

  console.log('Redeploying WhiteProtocol...');
  const wpArtifact = loadArtifact('WhiteProtocol');
  const linkedBytecode = linkBytecode(wpArtifact.bytecode, 'PoseidonT3', POSEIDON_T3);
  const wpFactory = new ethers.ContractFactory(wpArtifact.abi, linkedBytecode, wallet);
  const whiteProtocol = await wpFactory.deploy(
    wallet.address,
    oldArtifact.contracts.DepositVerifier,
    oldArtifact.contracts.WithdrawVerifier,
    oldArtifact.contracts.MerkleBatchVerifier,
    ASSET_REGISTRY
  );
  await whiteProtocol.deployed();
  console.log('New WhiteProtocol:', whiteProtocol.address);

  // Transfer AssetRegistry ownership from old WP to deployer, then to new WP
  const registryAbi = ['function owner() view returns (address)', 'function transferOwnership(address) external'];
  const registry = new ethers.Contract(ASSET_REGISTRY, registryAbi, wallet);
  const currentOwner = await registry.owner();
  console.log('AssetRegistry current owner:', currentOwner);

  // If owner is not deployer, we can't transfer. Let's check.
  // The old WP was owner. We need to call transferOwnership from old WP... but we can't.
  // So we need to deploy a new AssetRegistry too.
  if (currentOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.log('AssetRegistry owned by old WhiteProtocol. Deploying new AssetRegistry...');
    const arArtifact = loadArtifact('AssetRegistry');
    const arFactory = new ethers.ContractFactory(arArtifact.abi, arArtifact.bytecode, wallet);
    const newRegistry = await arFactory.deploy(wallet.address);
    await newRegistry.deployed();
    console.log('New AssetRegistry:', newRegistry.address);

    const txDomain = await newRegistry.configureDomain(33554434, 2);
    await txDomain.wait();

    // Now deploy WhiteProtocol again with new registry
    const wpFactory2 = new ethers.ContractFactory(wpArtifact.abi, linkedBytecode, wallet);
    const wp2 = await wpFactory2.deploy(
      wallet.address,
      oldArtifact.contracts.DepositVerifier,
      oldArtifact.contracts.WithdrawVerifier,
      oldArtifact.contracts.MerkleBatchVerifier,
      newRegistry.address
    );
    await wp2.deployed();
    console.log('WhiteProtocol with new registry:', wp2.address);

    const txSetDomain = await wp2.setDomainId(33554434);
    await txSetDomain.wait();

    const txTransfer = await newRegistry.transferOwnership(wp2.address);
    await txTransfer.wait();

    const txAsset = await wp2.addSupportedAsset(ethers.constants.AddressZero, false, 18, ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1000'));
    await txAsset.wait();

    const txRelayer = await wp2.registerRelayer(wallet.address);
    await txRelayer.wait();

    // Update BridgeOutbox whiteProtocol
    const outboxAbi = ['function setWhiteProtocol(address) external'];
    const outbox = new ethers.Contract(BRIDGE_OUTBOX, outboxAbi, wallet);
    const txOutbox = await outbox.setWhiteProtocol(wp2.address);
    await txOutbox.wait();

    const txWP = await wp2.setBridgeOutbox(BRIDGE_OUTBOX);
    await txWP.wait();

    console.log('Redeployment complete!');
    console.log('WhiteProtocol:', wp2.address);
    console.log('AssetRegistry:', newRegistry.address);

    // Update artifact
    const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../../deployments/base-sepolia.json'), 'utf8'));
    artifact.contracts.WhiteProtocol = wp2.address;
    artifact.contracts.AssetRegistry = newRegistry.address;
    fs.writeFileSync(path.join(__dirname, '../../deployments/base-sepolia.json'), JSON.stringify(artifact, null, 2));
  } else {
    // Owner is deployer, can reuse
    const txSetDomain = await whiteProtocol.setDomainId(33554434);
    await txSetDomain.wait();

    const txTransfer = await registry.transferOwnership(whiteProtocol.address);
    await txTransfer.wait();

    const txAsset = await whiteProtocol.addSupportedAsset(ethers.constants.AddressZero, false, 18, ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1000'));
    await txAsset.wait();

    const txRelayer = await whiteProtocol.registerRelayer(wallet.address);
    await txRelayer.wait();

    const outboxAbi = ['function setWhiteProtocol(address) external'];
    const outbox = new ethers.Contract(BRIDGE_OUTBOX, outboxAbi, wallet);
    const txOutbox = await outbox.setWhiteProtocol(whiteProtocol.address);
    await txOutbox.wait();

    const txWP = await whiteProtocol.setBridgeOutbox(BRIDGE_OUTBOX);
    await txWP.wait();

    console.log('Redeployment complete!');
    console.log('WhiteProtocol:', whiteProtocol.address);

    const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, '../../deployments/base-sepolia.json'), 'utf8'));
    artifact.contracts.WhiteProtocol = whiteProtocol.address;
    fs.writeFileSync(path.join(__dirname, '../../deployments/base-sepolia.json'), JSON.stringify(artifact, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
