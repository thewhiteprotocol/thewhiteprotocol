/**
 * E2E Test for White Protocol on BSC Testnet
 * Tests deposit, batch settlement, and withdraw for BNB, WBNB, and USDT
 */

import { ethers } from 'ethers';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

// ─── Configuration ───
const RPC_URL = process.env.BSC_TESTNET_RPC_URL;
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';

const DEPLOYMENT_PATH = path.join(__dirname, '../../deployments/bsc-testnet.json');

const CIRCUITS = {
  deposit: '../../../circuits/deposit/build',
  withdraw: '../../../circuits/withdraw/build',
  merkleBatch: '../../../circuits/merkle_batch_update/build',
};

// Contract ABIs (minimal)
const WHITEPROTOCOL_ABI = [
  "function deposit(bytes calldata proof, uint256 commitment, uint256 amount, address token) external payable",
  "function withdraw(bytes calldata proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external",
  "function settleBatch(bytes calldata proof, uint256 oldRoot, uint256 newRoot, uint256 startIndex, uint256 batchSize, uint256 commitmentsHash) external",
  "function getLastRoot() external view returns (uint256)",
  "function nextLeafIndex() external view returns (uint256)",
  "function isKnownRoot(uint256 root) external view returns (bool)",
  "function isSpent(uint256 nullifierHash) external view returns (bool)",
  "function getPendingDepositsCount() external view returns (uint256)",
  "function getPendingDeposit(uint256 index) external view returns (uint256)",
  "function pendingDeposits(uint256) external view returns (uint256)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function mint(address to, uint256 amount) external", // may not exist on all test tokens
];

// ─── Test State ───
interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  txHash?: string;
  error?: string;
}

const results: TestResult[] = [];

function report(name: string, status: 'PASS' | 'FAIL' | 'SKIP', txHash?: string, error?: string) {
  results.push({ name, status, txHash, error });
  const emoji = status === 'PASS' ? '✅' : status === 'SKIP' ? '⏭️' : '❌';
  const statusStr = status === 'SKIP' ? ` (SKIP: ${error})` : `${error ? ` - Error: ${error}` : ''}`;
  console.log(`${emoji} ${name}${txHash ? ` (tx: ${txHash})` : ''}${statusStr}`);
}

function randomBigInt(bytes: number): bigint {
  return BigInt('0x' + crypto.randomBytes(bytes).toString('hex'));
}

async function computeZeros(): Promise<bigint[]> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= 20; i++) {
    zeros[i] = F.toObject(poseidon([F.e(zeros[i - 1]), F.e(zeros[i - 1])]));
  }
  return zeros;
}

async function computeCommitment(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  return F.toObject(poseidon([F.e(secret), F.e(nullifier), F.e(amount), F.e(assetId)]));
}

async function computeNullifierHash(nullifier: bigint, secret: bigint, leafIndex: number): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const inner = poseidon([F.e(nullifier), F.e(secret)]);
  return F.toObject(poseidon([inner, F.e(leafIndex)]));
}

async function computeNewRoot(commitment: bigint, zeros: bigint[]): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  let current = F.toObject(poseidon([F.e(commitment), F.e(zeros[0])]));
  for (let i = 1; i < 20; i++) {
    current = F.toObject(poseidon([F.e(current), F.e(zeros[i])]));
  }
  return current;
}

async function computeCommitmentsHash(commitment: bigint): Promise<bigint> {
  const hexStr = commitment.toString(16).padStart(64, '0');
  const buffer = Buffer.from(hexStr, 'hex');
  const hash = crypto.createHash('sha256').update(buffer).digest();
  const hashBigInt = BigInt('0x' + hash.toString('hex'));
  const mask = (BigInt(1) << BigInt(253)) - BigInt(1);
  return hashBigInt & mask;
}

async function formatProof(proof: any, publicSignals: any[]): Promise<string> {
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const parsed = JSON.parse('[' + calldata.replace(/\(/g, '[').replace(/\)/g, ']') + ']');
  const a = parsed[0];
  const b = parsed[1];
  const c = parsed[2];
  const flatProof = [
    BigInt(a[0]), BigInt(a[1]),
    BigInt(b[0][0]), BigInt(b[0][1]),
    BigInt(b[1][0]), BigInt(b[1][1]),
    BigInt(c[0]), BigInt(c[1])
  ];
  return new ethers.utils.AbiCoder().encode(['uint256[8]'], [flatProof]);
}

async function generateDepositProof(secret: bigint, nullifier: bigint, amount: bigint, assetId: bigint, commitment: bigint): Promise<{ proof: any; publicSignals: any[] }> {
  const circuitPath = path.join(__dirname, CIRCUITS.deposit);
  const input = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    amount: amount.toString(),
    asset_id: assetId.toString(),
    commitment: commitment.toString(),
  };
  return snarkjs.groth16.fullProve(
    input,
    path.join(circuitPath, 'deposit_js', 'deposit.wasm'),
    path.join(circuitPath, 'deposit.zkey')
  );
}

async function generateWithdrawProof(
  secret: bigint,
  nullifier: bigint,
  amount: bigint,
  assetId: bigint,
  leafIndex: number,
  merkleRoot: bigint,
  nullifierHash: bigint,
  pathElements: bigint[]
): Promise<{ proof: any; publicSignals: any[] }> {
  const circuitPath = path.join(__dirname, CIRCUITS.withdraw);
  const input = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    amount: amount.toString(),
    asset_id: assetId.toString(),
    leaf_index: leafIndex.toString(),
    merkle_root: merkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    merkle_path: pathElements.map(e => e.toString()),
    merkle_path_indices: Array(20).fill('0'),
    recipient: '0',
    relayer: '0',
    relayer_fee: '0',
    public_data_hash: '0',
  };
  return snarkjs.groth16.fullProve(
    input,
    path.join(circuitPath, 'withdraw_js', 'withdraw.wasm'),
    path.join(circuitPath, 'withdraw.zkey')
  );
}

async function generateBatchProof(
  oldRoot: bigint,
  newRoot: bigint,
  startIndex: number,
  commitmentsHash: bigint,
  commitment: bigint,
  pathElements: string[]
): Promise<{ proof: any; publicSignals: any[] }> {
  const circuitPath = path.join(__dirname, CIRCUITS.merkleBatch);
  const input = {
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    startIndex: startIndex.toString(),
    batchSize: '1',
    commitmentsHash: commitmentsHash.toString(),
    commitments: [commitment.toString()],
    pathElements: [pathElements],
  };
  return snarkjs.groth16.fullProve(
    input,
    path.join(circuitPath, 'merkle_batch_update_js', 'merkle_batch_update.wasm'),
    path.join(circuitPath, 'merkle_batch_update.zkey')
  );
}

// ─── Asset Test Runner ───
async function runAssetTest(
  name: string,
  whiteProtocol: ethers.Contract,
  wallet: ethers.Wallet,
  provider: ethers.providers.JsonRpcProvider,
  asset: {
    token: string; // address or 'native'
    amount: string;
    assetId: bigint;
    decimals: number;
  }
): Promise<void> {
  const zeros = await computeZeros();
  const depositAmount = ethers.utils.parseUnits(asset.amount, asset.decimals);
  const secret = randomBigInt(31);
  const nullifier = randomBigInt(31);
  const commitment = await computeCommitment(secret, nullifier, BigInt(depositAmount.toString()), asset.assetId);

  // ── DEPOSIT ──
  console.log(`\n--- ${name}: Deposit ---`);
  let depositTxHash: string;
  try {
    const { proof, publicSignals } = await generateDepositProof(secret, nullifier, BigInt(depositAmount.toString()), asset.assetId, commitment);
    const proofBytes = await formatProof(proof, publicSignals);

    const txOptions: any = {};
    if (asset.token === 'native') {
      txOptions.value = depositAmount;
    }

    const tx = await whiteProtocol.deposit(
      proofBytes,
      commitment,
      depositAmount,
      asset.token === 'native' ? ethers.constants.AddressZero : asset.token,
      txOptions
    );
    await tx.wait();
    depositTxHash = tx.hash;
    console.log(`  Deposit tx: ${tx.hash}`);

    // Approve if ERC20
    if (asset.token !== 'native') {
      const tokenContract = new ethers.Contract(asset.token, ERC20_ABI, wallet);
      const approveTx = await tokenContract.approve(whiteProtocol.address, depositAmount);
      await approveTx.wait();
      console.log(`  Approve tx: ${approveTx.hash}`);
    }

    report(`${name}: Deposit`, 'PASS', depositTxHash);
  } catch (e: any) {
    report(`${name}: Deposit`, 'FAIL', undefined, e.message);
    throw e;
  }

  // ── SETTLE ──
  console.log(`\n--- ${name}: Settlement ---`);
  let settleTxHash: string;
  let settledRoot: bigint;
  try {
    const oldRoot = await whiteProtocol.getLastRoot();
    const startIndex = await whiteProtocol.nextLeafIndex();
    const newRoot = await computeNewRoot(commitment, zeros);
    const commitmentsHash = await computeCommitmentsHash(commitment);
    const pathElements = zeros.slice(0, 20).map(z => z.toString());

    const { proof, publicSignals } = await generateBatchProof(oldRoot, newRoot, Number(startIndex), commitmentsHash, commitment, pathElements);
    const proofBytes = await formatProof(proof, publicSignals);

    const tx = await whiteProtocol.settleBatch(proofBytes, oldRoot, newRoot, startIndex, 1, commitmentsHash);
    await tx.wait();
    settleTxHash = tx.hash;
    settledRoot = newRoot;
    console.log(`  Settlement tx: ${tx.hash}`);

    const finalRoot = await whiteProtocol.getLastRoot();
    if (finalRoot.toString() !== newRoot.toString()) {
      throw new Error(`Root mismatch after settlement`);
    }
    report(`${name}: Settlement`, 'PASS', settleTxHash);
  } catch (e: any) {
    report(`${name}: Settlement`, 'FAIL', undefined, e.message);
    throw e;
  }

  // ── WITHDRAW ──
  console.log(`\n--- ${name}: Withdraw ---`);
  let withdrawTxHash: string;
  try {
    const leafIndex = 0; // fresh tree assumption
    const nullifierHash = await computeNullifierHash(nullifier, secret, leafIndex);
    const pathElements = zeros.slice(0, 20);

    const { proof, publicSignals } = await generateWithdrawProof(
      secret, nullifier, BigInt(depositAmount.toString()), asset.assetId, leafIndex, settledRoot, nullifierHash, pathElements
    );
    const proofBytes = await formatProof(proof, publicSignals);

    const tx = await whiteProtocol.withdraw(
      proofBytes,
      nullifierHash,
      settledRoot,
      wallet.address,
      asset.token === 'native' ? ethers.constants.AddressZero : asset.token,
      depositAmount,
      0,
      ethers.constants.AddressZero
    );
    await tx.wait();
    withdrawTxHash = tx.hash;
    console.log(`  Withdraw tx: ${tx.hash}`);

    const isSpent = await whiteProtocol.isSpent(nullifierHash);
    if (!isSpent) {
      throw new Error('Nullifier not marked as spent');
    }
    report(`${name}: Withdraw`, 'PASS', withdrawTxHash);
  } catch (e: any) {
    report(`${name}: Withdraw`, 'FAIL', undefined, e.message);
    throw e;
  }
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  WHITE PROTOCOL E2E TEST - BSC TESTNET');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (!RPC_URL) {
    console.log('⏭️  Skipping: BSC_TESTNET_RPC_URL not set');
    process.exit(0);
  }

  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    console.log('⏭️  Skipping: Deployment artifact not found at ' + DEPLOYMENT_PATH);
    console.log('     Deploy to BSC testnet first: npm run deploy:bsc-testnet');
    process.exit(0);
  }

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf-8'));
  const whiteProtocolAddress = deployment.contracts?.WhiteProtocol;
  if (!whiteProtocolAddress) {
    console.log('⏭️  Skipping: WhiteProtocol address missing in deployment artifact');
    process.exit(0);
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const whiteProtocol = new ethers.Contract(whiteProtocolAddress, WHITEPROTOCOL_ABI, wallet);

  console.log(`Deployer: ${wallet.address}`);
  console.log(`Contract: ${whiteProtocolAddress}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.utils.formatEther(balance)} BNB\n`);

  if (balance.lt(ethers.utils.parseEther('0.05'))) {
    console.error('❌ Insufficient balance. Need at least 0.05 tBNB for gas.');
    console.log('   Get tBNB from: https://www.bnbchain.org/en/testnet-faucet');
    process.exit(1);
  }

  // Verify empty root matches cross-chain invariant
  const emptyRoot = '15019797232609675441998260052101280400536945603062888308240081994073687793470';
  const currentRoot = await whiteProtocol.getLastRoot();
  if (currentRoot.toString() !== emptyRoot) {
    console.log(`⚠️  Tree not empty (current root: ${currentRoot.toString().slice(0, 30)}...)`);
    console.log('   This E2E test assumes a fresh empty tree. Run on a fresh deploy or reset tree.');
    process.exit(1);
  }
  console.log('✅ Empty root matches cross-chain invariant\n');

  // ── BNB (Native) ──
  try {
    await runAssetTest('BNB', whiteProtocol, wallet, provider, {
      token: 'native',
      amount: '0.001',
      assetId: BigInt(0),
      decimals: 18,
    });
  } catch (e: any) {
    console.error(`BNB test failed: ${e.message}`);
  }

  // Reset tree for next asset (need fresh state)
  console.log('\n⚠️  NOTE: WBNB and USDT tests require a fresh tree state.');
  console.log('   In a full CI environment, each asset test should run against a fresh deploy.');
  console.log('   For local testing, re-deploy between asset tests.\n');

  // ── WBNB ──
  const wrappedNative = deployment.supportedAssets?.wrappedNative;
  if (wrappedNative && wrappedNative !== 'null') {
    try {
      await runAssetTest('WBNB', whiteProtocol, wallet, provider, {
        token: wrappedNative,
        amount: '0.001',
        assetId: BigInt(0), // asset registry assigns IDs; 0 is placeholder
        decimals: 18,
      });
    } catch (e: any) {
      console.error(`WBNB test failed: ${e.message}`);
    }
  } else {
    report('WBNB', 'SKIP', undefined, 'No wrappedNative address in deployment');
  }

  // ── USDT ──
  const usdt = deployment.supportedAssets?.usdt;
  if (usdt && usdt !== 'null') {
    // Check if mintable
    const usdtContract = new ethers.Contract(usdt, ERC20_ABI, wallet);
    let canMint = false;
    try {
      // Check if mint selector exists by calling it with 0 amount to self
      await usdtContract.callStatic.mint(wallet.address, 0);
      canMint = true;
    } catch {
      canMint = false;
    }

    if (canMint) {
      try {
        const mintTx = await usdtContract.mint(wallet.address, ethers.utils.parseUnits('10', 18));
        await mintTx.wait();
        console.log('Minted 10 test USDT');

        await runAssetTest('USDT', whiteProtocol, wallet, provider, {
          token: usdt,
          amount: '1',
          assetId: BigInt(0),
          decimals: 18,
        });
      } catch (e: any) {
        console.error(`USDT test failed: ${e.message}`);
      }
    } else {
      report('USDT', 'SKIP', undefined, 'USDT is not mintable on this testnet. Acquire test USDT manually (e.g., swap on PancakeSwap testnet) and re-run.');
    }
  } else {
    report('USDT', 'SKIP', undefined, 'No USDT address in deployment');
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  results.forEach(r => {
    const status = r.status === 'PASS' ? '✅ PASS' : r.status === 'SKIP' ? '⏭️ SKIP' : '❌ FAIL';
    console.log(`${status}: ${r.name}`);
    if (r.txHash) console.log(`   Tx: ${r.txHash}`);
    if (r.error && r.status !== 'SKIP') console.log(`   Error: ${r.error}`);
  });

  console.log(`\nTotal: ${results.length} tests | ${passed} passed | ${failed} failed | ${skipped} skipped`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
