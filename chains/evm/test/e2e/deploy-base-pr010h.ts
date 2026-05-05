/**
 * PR-010H Base Sepolia Redeployment Script
 * Deploys new AssetRegistry, WhiteProtocol, and BridgeOutbox with PR-010H code.
 * Reuses existing verifier contracts.
 */

import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

const NETWORK = 'base-sepolia';
const RPC_URL = 'https://base-sepolia-rpc.publicnode.com';

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
if (!DEPLOYER_KEY) {
  console.error('DEPLOYER_PRIVATE_KEY env var required');
  process.exit(1);
}

// Load existing artifact for verifier addresses
const existingArtifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../deployments/base-sepolia-pr010g-backup.json'), 'utf8')
);

const VERIFIERS = {
  deposit: existingArtifact.contracts.DepositVerifier,
  withdraw: existingArtifact.contracts.WithdrawVerifier,
  merkleBatch: existingArtifact.contracts.MerkleBatchVerifier,
};

const DOMAIN_ID = 33554434;

// Contract ABIs and bytecode from Foundry output
function loadArtifact(name: string): { abi: any[]; bytecode: string } {
  const file = path.join(__dirname, '../../out', name + '.sol', name + '.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

function linkBytecode(bytecode: string, libraryName: string, libraryAddress: string): string {
  // Foundry placeholder format: __$<34_hex_chars>$__
  // We need to find and replace all occurrences
  const placeholderRegex = /__[\$][a-f0-9]{34}[\$]__/g;
  const addressPadded = libraryAddress.toLowerCase().replace(/^0x/, '').padStart(40, '0');
  return bytecode.replace(placeholderRegex, addressPadded);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PR-010H BASE SEPOLIA REDEPLOYMENT');
  console.log('═══════════════════════════════════════════════════════════\n');

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  console.log('Deployer:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', ethers.utils.formatEther(balance), 'ETH\n');

  // Load artifacts
  const poseidonArtifact = loadArtifact('PoseidonT3');
  const assetRegistryArtifact = loadArtifact('AssetRegistry');
  const whiteProtocolArtifact = loadArtifact('WhiteProtocol');
  const bridgeOutboxArtifact = loadArtifact('BridgeOutbox');

  // Deploy PoseidonT3 (needed for WhiteProtocol linking)
  console.log('Deploying PoseidonT3...');
  const poseidonFactory = new ethers.ContractFactory(poseidonArtifact.abi, poseidonArtifact.bytecode, wallet);
  const poseidonT3 = await poseidonFactory.deploy();
  await poseidonT3.deployed();
  console.log('PoseidonT3:', poseidonT3.address);

  // Deploy AssetRegistry
  console.log('Deploying AssetRegistry...');
  const assetRegistryFactory = new ethers.ContractFactory(assetRegistryArtifact.abi, assetRegistryArtifact.bytecode, wallet);
  const assetRegistry = await assetRegistryFactory.deploy(wallet.address);
  await assetRegistry.deployed();
  console.log('AssetRegistry:', assetRegistry.address);

  // Configure domain
  console.log('Configuring AssetRegistry domain...');
  const txDomain = await assetRegistry.configureDomain(DOMAIN_ID, 2);
  await txDomain.wait();
  console.log('Domain configured:', DOMAIN_ID);

  // Link and deploy WhiteProtocol
  console.log('Linking WhiteProtocol bytecode...');
  const linkedBytecode = linkBytecode(whiteProtocolArtifact.bytecode, 'PoseidonT3', poseidonT3.address);
  const whiteProtocolFactory = new ethers.ContractFactory(whiteProtocolArtifact.abi, linkedBytecode, wallet);
  const whiteProtocol = await whiteProtocolFactory.deploy(
    wallet.address,
    VERIFIERS.deposit,
    VERIFIERS.withdraw,
    VERIFIERS.merkleBatch,
    assetRegistry.address
  );
  await whiteProtocol.deployed();
  console.log('WhiteProtocol:', whiteProtocol.address);

  // Set domain ID on WhiteProtocol
  console.log('Setting WhiteProtocol domain ID...');
  const txSetDomain = await whiteProtocol.setDomainId(DOMAIN_ID);
  await txSetDomain.wait();

  // Transfer AssetRegistry ownership to WhiteProtocol
  console.log('Transferring AssetRegistry ownership...');
  const txTransfer = await assetRegistry.transferOwnership(whiteProtocol.address);
  await txTransfer.wait();

  // Add native asset
  console.log('Adding native asset...');
  const txAsset = await whiteProtocol.addSupportedAsset(ethers.constants.AddressZero, false, 18, ethers.utils.parseEther('0.001'), ethers.utils.parseEther('1000'));
  await txAsset.wait();

  // Register deployer as relayer
  console.log('Registering deployer as relayer...');
  const txRelayer = await whiteProtocol.registerRelayer(wallet.address);
  await txRelayer.wait();

  // Deploy BridgeOutbox
  console.log('Deploying BridgeOutbox...');
  const bridgeOutboxFactory = new ethers.ContractFactory(bridgeOutboxArtifact.abi, bridgeOutboxArtifact.bytecode, wallet);
  const bridgeOutbox = await bridgeOutboxFactory.deploy(wallet.address, DOMAIN_ID);
  await bridgeOutbox.deployed();
  console.log('BridgeOutbox:', bridgeOutbox.address);

  // Configure BridgeOutbox
  console.log('Configuring BridgeOutbox...');
  const ethDomainId = 33554435;
  const canonicalAssetId = await assetRegistry.getAssetId(ethers.constants.AddressZero);

  const txs = await Promise.all([
    bridgeOutbox.enableRoute(ethDomainId),
    bridgeOutbox.supportAsset(canonicalAssetId),
    bridgeOutbox.setMaxMessageAmount(canonicalAssetId, ethers.utils.parseEther('10')),
    bridgeOutbox.setOutflowCap(canonicalAssetId, ethers.utils.parseEther('1000')),
    bridgeOutbox.setDailyOutflowCap(canonicalAssetId, ethers.utils.parseEther('1000')),
  ]);
  for (const tx of txs) await tx.wait();
  console.log('BridgeOutbox routes/assets/caps configured');

  // Wire WhiteProtocol <-> BridgeOutbox
  console.log('Wiring WhiteProtocol <-> BridgeOutbox...');
  const txWire1 = await whiteProtocol.setBridgeOutbox(bridgeOutbox.address);
  await txWire1.wait();
  const txWire2 = await bridgeOutbox.setWhiteProtocol(whiteProtocol.address);
  await txWire2.wait();
  console.log('Wiring complete');

  // Verify empty root
  const emptyRoot = await whiteProtocol.getLastRoot();
  const expectedEmptyRoot = '15019797232609675441998260052101280400536945603062888308240081994073687793470';
  if (emptyRoot.toString() !== expectedEmptyRoot) {
    throw new Error(`Empty root mismatch: expected ${expectedEmptyRoot}, got ${emptyRoot}`);
  }
  console.log('Empty root verified:', emptyRoot.toString());

  // Save artifact
  const artifact = {
    chainId: 84532,
    contracts: {
      AssetRegistry: assetRegistry.address,
      DepositVerifier: VERIFIERS.deposit,
      MerkleBatchVerifier: VERIFIERS.merkleBatch,
      WhiteProtocol: whiteProtocol.address,
      WithdrawVerifier: VERIFIERS.withdraw,
    },
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    merkleState: {
      emptyRoot: emptyRoot.toHexString(),
      nextLeafIndex: 0,
    },
    network: 'base-sepolia',
    relayers: [wallet.address],
    supportedAssets: {
      native: '0x0000000000000000000000000000000000000000',
      usdc: null,
      usdt: null,
      wrappedNative: existingArtifact.supportedAssets.wrappedNative,
    },
    domainId: DOMAIN_ID,
    assetIdVersion: 2,
    active: true,
    generation: 'PR-010H',
    previousArtifact: 'deployments/base-sepolia-pr010g-backup.json',
    domainIdHex: '0x02000002',
    assetIdFormula: 'white:asset_id:v2',
    verifiedE2E: false,
    notes: 'PR-010H redeployment with bridgeOutV1 and source-nullifier binding',
    deploymentBlock: 0,
    bridgeV1: {
      BridgeOutbox: bridgeOutbox.address,
      BridgeInbox: existingArtifact.bridgeV1.BridgeInbox,
      signerSetVersion: 1,
      threshold: 2,
      signers: existingArtifact.bridgeV1.signers,
      deployedAt: Math.floor(Date.now() / 1000).toString(),
      canonicalAssetId: canonicalAssetId,
    },
  };

  const artifactPath = path.join(__dirname, '../../deployments/base-sepolia.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  console.log('\nArtifact saved to:', artifactPath);

  // Save bridge-v1 artifact
  const bridgeArtifact = {
    BridgeInbox: existingArtifact.bridgeV1.BridgeInbox,
    BridgeOutbox: bridgeOutbox.address,
    chainId: 84532,
    deployedAt: Math.floor(Date.now() / 1000).toString(),
    domainId: DOMAIN_ID,
    domainIdHex: '0x02000002',
    network: 'base-sepolia',
    signerSetVersion: 1,
    signers: existingArtifact.bridgeV1.signers,
    threshold: 2,
  };
  const bridgeArtifactPath = path.join(__dirname, '../../deployments/base-sepolia-bridge-v1.json');
  fs.writeFileSync(bridgeArtifactPath, JSON.stringify(bridgeArtifact, null, 2));
  console.log('Bridge artifact saved to:', bridgeArtifactPath);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  REDEPLOYMENT COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('WhiteProtocol:', whiteProtocol.address);
  console.log('AssetRegistry:', assetRegistry.address);
  console.log('BridgeOutbox:', bridgeOutbox.address);
  console.log('Canonical Asset ID:', canonicalAssetId);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
