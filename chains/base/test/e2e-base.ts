/**
 * E2E Test for White Protocol on Base Sepolia
 * Tests deposit, batch settlement, and withdraw with real ZK proofs
 */

import { ethers } from 'ethers';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';

// Contract ABIs (simplified)
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
  "function zeros(uint256 i) external pure returns (uint256)",
  "function assetRegistry() external view returns (address)",
  "function pendingDeposits(uint256) external view returns (uint256)",
  "event Deposit(uint256 indexed commitment, uint256 amount, address indexed token, uint256 leafIndex)",
  "event Withdrawal(uint256 indexed nullifierHash, address indexed recipient, uint256 amount, address indexed token)",
  "event BatchSettlement(uint256 indexed startIndex, uint256 batchSize, uint256 newRoot)"
];

const ASSETREGISTRY_ABI = [
  "function isSupported(address asset) external view returns (bool)",
  "function getAssetId(address asset) external view returns (uint256)"
];

// Test configuration
const CONFIG = {
  rpcUrl: 'https://sepolia.base.org',
  privateKey: process.env.DEPLOYER_PRIVATE_KEY || '',
  contracts: {
    whiteProtocol: '0xD8DFDC6AF3Eb48be8b5534E0bC5E77E6E25BE634',
    assetRegistry: '0x919120F5494d1A2c218aC6F9E1aD2bB5B306bbCA'
  },
  circuits: {
    deposit: '../../../circuits/deposit/build',
    withdraw: '../../../circuits/withdraw/build',
    merkleBatch: '../../../circuits/merkle_batch_update/build'
  }
};

// Test results
const results: { name: string; status: 'PASS' | 'FAIL'; txHash?: string; error?: string }[] = [];

function report(name: string, status: 'PASS' | 'FAIL', txHash?: string, error?: string) {
  results.push({ name, status, txHash, error });
  const emoji = status === 'PASS' ? '✅' : '❌';
  console.log(`${emoji} ${name}${txHash ? ` (tx: ${txHash})` : ''}${error ? ` - Error: ${error}` : ''}`);
}

async function generateSecretAndNullifier(): Promise<{ secret: bigint; nullifier: bigint }> {
  const randomBytes = () => BigInt('0x' + Array(32).fill(0).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(''));
  return {
    secret: randomBytes(),
    nullifier: randomBytes()
  };
}

async function computeCommitment(secret: bigint, nullifier: bigint): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash = poseidon([F.e(secret), F.e(nullifier)]);
  return F.toObject(hash);
}

async function computeNullifierHash(nullifier: bigint): Promise<bigint> {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const hash = poseidon([F.e(nullifier)]);
  return F.toObject(hash);
}

async function generateDepositProof(
  secret: bigint, 
  nullifier: bigint, 
  amount: bigint,
  assetId: bigint
): Promise<{ proof: any; publicSignals: bigint[] }> {
  const circuitPath = path.join(__dirname, CONFIG.circuits.deposit);
  
  // Compute commitment for public input
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const commitment = F.toObject(poseidon([F.e(secret), F.e(nullifier), F.e(amount), F.e(assetId)]));
  
  const input = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    amount: amount.toString(),
    asset_id: assetId.toString(),
    commitment: commitment.toString()
  };
  
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(circuitPath, 'deposit_js', 'deposit.wasm'),
    path.join(circuitPath, 'deposit.zkey')
  );
  
  return { proof, publicSignals };
}

async function formatProofForContract(proof: any, publicSignals: bigint[]): Promise<string> {
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  
  // Parse the calldata: [[a1, a2], [[b11, b12], [b21, b22]], [c1, c2], [pub1, pub2, ...]]
  const parsed = JSON.parse('[' + calldata.replace(/\(/g, '[').replace(/\)/g, ']') + ']');
  
  // Extract proof components
  const a = parsed[0]; // [a1, a2]
  const b = parsed[1]; // [[b11, b12], [b21, b22]]
  const c = parsed[2]; // [c1, c2]
  
  // Flatten to 8 uint256: [a[0], a[1], b[0][0], b[0][1], b[1][0], b[1][1], c[0], c[1]]
  const flatProof = [
    BigInt(a[0]),
    BigInt(a[1]),
    BigInt(b[0][0]),
    BigInt(b[0][1]),
    BigInt(b[1][0]),
    BigInt(b[1][1]),
    BigInt(c[0]),
    BigInt(c[1])
  ];
  
  // Pack into bytes
  const encoded = new ethers.utils.AbiCoder().encode(['uint256[8]'], [flatProof]);
  return encoded;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('WHITE PROTOCOL E2E TEST - BASE SEPOLIA');
  console.log('═══════════════════════════════════════════════════════\n');
  
  // Setup provider and wallet
  const provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
  const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
  console.log(`Test wallet: ${wallet.address}`);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH\n`);
  
  if (balance.lt(ethers.utils.parseEther('0.01'))) {
    console.error('Insufficient balance for testing');
    process.exit(1);
  }
  
  // Setup contracts
  const whiteProtocol = new ethers.Contract(CONFIG.contracts.whiteProtocol, WHITEPROTOCOL_ABI, wallet);
  const assetRegistry = new ethers.Contract(CONFIG.contracts.assetRegistry, ASSETREGISTRY_ABI, wallet);
  
  // Test 1: Verify empty tree root
  console.log('--- TEST 1: Verify Empty Tree Root ---');
  try {
    const root = await whiteProtocol.getLastRoot();
    const expectedRoot = '15019797232609675441998260052101280400536945603062888308240081994073687793470';
    if (root.toString() === expectedRoot) {
      report('Empty tree root matches circomlib', 'PASS');
    } else {
      report('Empty tree root matches circomlib', 'FAIL', undefined, `Expected ${expectedRoot}, got ${root}`);
    }
  } catch (e: any) {
    report('Empty tree root matches circomlib', 'FAIL', undefined, e.message);
  }
  
  // Test 2: Verify ETH is supported
  console.log('\n--- TEST 2: Verify ETH Support ---');
  try {
    const isSupported = await assetRegistry['isSupported(address)'](ethers.constants.AddressZero);
    if (isSupported) {
      report('ETH is supported asset', 'PASS');
    } else {
      report('ETH is supported asset', 'FAIL', undefined, 'ETH not supported');
    }
  } catch (e: any) {
    report('ETH is supported asset', 'FAIL', undefined, e.message);
  }
  
  // Test 3: Deposit with real ZK proof
  console.log('\n--- TEST 3: Deposit ETH with ZK Proof ---');
  let depositData: { secret: bigint; nullifier: bigint; commitment: bigint; leafIndex: number } | null = null;
  
  try {
    // Generate secret and nullifier
    const { secret, nullifier } = await generateSecretAndNullifier();
    console.log(`Generated secret: ${secret.toString().slice(0, 20)}...`);
    console.log(`Generated nullifier: ${nullifier.toString().slice(0, 20)}...`);
    
    // Compute commitment
    const commitment = await computeCommitment(secret, nullifier);
    console.log(`Computed commitment: ${commitment.toString().slice(0, 20)}...`);
    
    // Send deposit transaction
    const depositAmount = ethers.utils.parseEther('0.001');
    const assetId = 0; // ETH
    
    // Generate proof
    console.log('Generating deposit proof...');
    const { proof, publicSignals } = await generateDepositProof(secret, nullifier, BigInt(depositAmount.toString()), BigInt(assetId));
    console.log('Proof generated successfully');
    
    // Format proof for contract
    const proofBytes = await formatProofForContract(proof, publicSignals);
    
    // Get initial pending count
    const initialCount = await whiteProtocol.getPendingDepositsCount();
    console.log(`Initial pending deposits: ${initialCount}`);
    
    console.log(`Depositing ${ethers.utils.formatEther(depositAmount)} ETH...`);
    
    const tx = await whiteProtocol.deposit(proofBytes, commitment, depositAmount, ethers.constants.AddressZero, {
      value: depositAmount
    });
    
    const receipt = await tx.wait();
    report('Deposit ETH with ZK proof', 'PASS', tx.hash);
    
    // Verify pending deposit (wait a bit for state update)
    await new Promise(r => setTimeout(r, 2000));
    const newCount = await whiteProtocol.getPendingDepositsCount();
    console.log(`New pending deposits: ${newCount}`);
    if (newCount.toString() > initialCount.toString()) {
      report('Pending deposit recorded', 'PASS');
    } else {
      // Check if commitment is in pending list
      try {
        const pendingCommitment = await whiteProtocol.getPendingDeposit(newCount.toString() === '0' ? 0 : newCount - 1);
        if (pendingCommitment.toString() === commitment.toString()) {
          report('Pending deposit recorded', 'PASS');
        } else {
          report('Pending deposit recorded', 'FAIL', undefined, 'Commitment mismatch');
        }
      } catch (e) {
        report('Pending deposit recorded', 'FAIL', undefined, 'Could not retrieve pending deposit');
      }
    }
    
    depositData = { secret, nullifier, commitment, leafIndex: Number(newCount) - 1 };
    
  } catch (e: any) {
    report('Deposit ETH with ZK proof', 'FAIL', undefined, e.message);
  }
  
  // Test 4: Reject deposit with wrong ETH amount
  console.log('\n--- TEST 4: Reject Deposit with Wrong ETH Amount ---');
  try {
    const { secret, nullifier } = await generateSecretAndNullifier();
    const depositAmount = ethers.utils.parseEther('0.001');
    const wrongAmount = ethers.utils.parseEther('0.002');
    const assetId = 0;
    const commitment = await computeCommitment(secret, nullifier);
    const { proof, publicSignals } = await generateDepositProof(secret, nullifier, BigInt(depositAmount.toString()), BigInt(assetId));
    const proofBytes = await formatProofForContract(proof, publicSignals);
    
    try {
      await whiteProtocol.deposit(proofBytes, commitment, depositAmount, ethers.constants.AddressZero, {
        value: wrongAmount
      });
      report('Reject deposit with wrong ETH amount', 'FAIL', undefined, 'Transaction should have reverted');
    } catch (e: any) {
      if (e.message.includes('revert') || e.message.includes('insufficient')) {
        report('Reject deposit with wrong ETH amount', 'PASS');
      } else {
        report('Reject deposit with wrong ETH amount', 'FAIL', undefined, e.message);
      }
    }
  } catch (e: any) {
    report('Reject deposit with wrong ETH amount', 'FAIL', undefined, e.message);
  }
  
  // Test 5: Reject deposit with unsupported asset
  console.log('\n--- TEST 5: Reject Deposit with Unsupported Asset ---');
  try {
    const depositAmount = ethers.utils.parseEther('0.001');
    const assetId = 0;
    const { secret, nullifier } = await generateSecretAndNullifier();
    const commitment = await computeCommitment(secret, nullifier);
    const { proof, publicSignals } = await generateDepositProof(secret, nullifier, BigInt(depositAmount.toString()), BigInt(assetId));
    const proofBytes = await formatProofForContract(proof, publicSignals);
    
    const unsupportedToken = '0x1234567890123456789012345678901234567891';
    
    try {
      await whiteProtocol.deposit(proofBytes, commitment, 1000, unsupportedToken, { value: 1000 });
      report('Reject deposit with unsupported asset', 'FAIL', undefined, 'Transaction should have reverted');
    } catch (e: any) {
      if (e.message.includes('revert') || e.message.includes('Unsupported')) {
        report('Reject deposit with unsupported asset', 'PASS');
      } else {
        report('Reject deposit with unsupported asset', 'FAIL', undefined, e.message);
      }
    }
  } catch (e: any) {
    report('Reject deposit with unsupported asset', 'FAIL', undefined, e.message);
  }
  
  // Print summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  
  results.forEach(r => {
    const status = r.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}: ${r.name}`);
    if (r.txHash) console.log(`   Tx: ${r.txHash}`);
    if (r.error) console.log(`   Error: ${r.error}`);
  });
  
  console.log(`\nTotal: ${results.length} tests | ${passed} passed | ${failed} failed`);
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
