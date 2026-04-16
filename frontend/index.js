/**
 * pSOL v2 Relayer + Sequencer - Complete Production Service
 * All endpoints matching relayer-api.ts client
 */
const express = require('express');
const cors = require('cors');
const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const { keccak256 } = require('js-sha3');
const bs58 = require('bs58');
const { Connection, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const RPC_URL = 'https://api.devnet.solana.com';

// Circuit paths
const MERKLE_WASM = path.join(__dirname, 'circuits/build/merkle_batch_update/merkle_batch_update_js/merkle_batch_update.wasm');
const MERKLE_ZKEY = path.join(__dirname, 'circuits/build/merkle_batch_update/merkle_batch_update_final.zkey');
const WITHDRAW_WASM = path.join(__dirname, 'circuits/build/withdraw_v2_js/withdraw_v2.wasm');
const WITHDRAW_ZKEY = path.join(__dirname, 'circuits/build/withdraw_v2.zkey');

// Pool config
const POOL_CONFIG = {
  programId: 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
  poolConfig: 'uUhux7yXzGuA1rCNBQyaTrWuEW6yYUUTSAFnDVaefqw',
  merkleTree: 'Bq7iXcDo61quCH1AYccA5WM6x5iXJdZyXkgkbiomKtbq',
  pendingBuffer: '7NHFbLugnaS1BzGmu1pQFy32QScsZLtAm6TXX31AsBea',
  authority: 'BN4XFeCHfFut8ouDysMm4MrS8ppfXxtphVMqL2gnFkFm',
  treeDepth: 20,
  feeBps: 50 // 0.5% fee
};

// State
let poseidon = null;
let connection = null;
let merkleTreeState = { leaves: [], root: null };
let sequencerStatus = { running: false, lastRun: null, lastError: null, settledCount: 0 };
const TREE_DEPTH = 20;

// Initialize
async function initPoseidon() {
  if (!poseidon) {
    try {
      const circomlibjs = require('circomlibjs');
      poseidon = await circomlibjs.buildPoseidon();
      console.log('✓ Poseidon initialized');
    } catch (e) {
      const { buildPoseidon } = await import('circomlibjs');
      poseidon = await buildPoseidon();
      console.log('✓ Poseidon initialized (ESM)');
    }
  }
  return poseidon;
}

function initConnection() {
  if (!connection) {
    connection = new Connection(RPC_URL, 'confirmed');
  }
  return connection;
}

// Poseidon helpers
function poseidonHash(inputs) {
  const hash = poseidon(inputs.map(x => BigInt(x)));
  return poseidon.F.toString(hash);
}

function calculateEmptyRoot(depth) {
  let current = '0';
  for (let i = 0; i < depth; i++) {
    current = poseidonHash([current, current]);
  }
  return current;
}

function calculateTreeRoot(leaves) {
  if (!leaves || leaves.length === 0) return calculateEmptyRoot(TREE_DEPTH);
  const maxLeaves = 2 ** TREE_DEPTH;
  const paddedLeaves = [...leaves];
  while (paddedLeaves.length < maxLeaves) paddedLeaves.push('0');
  let layer = paddedLeaves;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const nextLayer = [];
    for (let i = 0; i < layer.length; i += 2) {
      nextLayer.push(poseidonHash([layer[i], layer[i + 1]]));
    }
    layer = nextLayer;
  }
  return layer[0];
}

function getMerklePath(leaves, index) {
  const maxLeaves = 2 ** TREE_DEPTH;
  const paddedLeaves = [...(leaves || [])];
  while (paddedLeaves.length < maxLeaves) paddedLeaves.push('0');
  let layer = paddedLeaves;
  const pathElements = [], pathIndices = [];
  let currentIndex = index;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    pathElements.push(layer[siblingIndex]);
    pathIndices.push(currentIndex % 2);
    const nextLayer = [];
    for (let i = 0; i < layer.length; i += 2) {
      nextLayer.push(poseidonHash([layer[i], layer[i + 1]]));
    }
    layer = nextLayer;
    currentIndex = Math.floor(currentIndex / 2);
  }
  return { pathElements, pathIndices };
}

function formatProofForSolana(proof) {
  const hexToBytes = (hex) => {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    return bytes;
  };
  const proofData = [];
  proofData.push(...hexToBytes(BigInt(proof.pi_a[0]).toString(16).padStart(64, '0')));
  proofData.push(...hexToBytes(BigInt(proof.pi_a[1]).toString(16).padStart(64, '0')));
  proofData.push(...hexToBytes(BigInt(proof.pi_b[0][1]).toString(16).padStart(64, '0')));
  proofData.push(...hexToBytes(BigInt(proof.pi_b[0][0]).toString(16).padStart(64, '0')));
  proofData.push(...hexToBytes(BigInt(proof.pi_b[1][1]).toString(16).padStart(64, '0')));
  proofData.push(...hexToBytes(BigInt(proof.pi_b[1][0]).toString(16).padStart(64, '0')));
  proofData.push(...hexToBytes(BigInt(proof.pi_c[0]).toString(16).padStart(64, '0')));
  proofData.push(...hexToBytes(BigInt(proof.pi_c[1]).toString(16).padStart(64, '0')));
  return Buffer.from(proofData);
}

function computeAssetIdFromMint(mint) {
  let mintBuffer;
  try {
    mintBuffer = Buffer.from(bs58.decode(mint));
  } catch {
    mintBuffer = Buffer.from(mint, 'hex');
  }
  const prefix = Buffer.from('psol:asset_id:v1');
  const combined = Buffer.concat([prefix, mintBuffer]);
  const hash = Buffer.from(keccak256.arrayBuffer(combined));
  const assetId = Buffer.alloc(32);
  assetId[0] = 0x00;
  hash.copy(assetId, 1, 0, 31);
  return assetId;
}

// Load tree state
function loadTreeState() {
  try {
    const statePath = path.join(__dirname, 'data/tree-state.json');
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      merkleTreeState.leaves = data.leaves || [];
      merkleTreeState.root = data.root;
    }
  } catch (e) {
    merkleTreeState.leaves = [];
  }
  if (!merkleTreeState.root) {
    merkleTreeState.root = calculateEmptyRoot(TREE_DEPTH);
  }
}

function saveTreeState() {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'tree-state.json'), JSON.stringify({
      leaves: merkleTreeState.leaves,
      root: merkleTreeState.root,
      updatedAt: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.error('Save state error:', e.message);
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'pSOL v2 Relayer + Sequencer',
    sequencer: sequencerStatus,
    pool: POOL_CONFIG
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), proofVerificationEnabled: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), proofVerificationEnabled: true });
});

// Status
app.get('/status', (req, res) => {
  res.json({
    active: true,
    feeBps: POOL_CONFIG.feeBps,
    operator: POOL_CONFIG.authority,
    totalTransactions: sequencerStatus.settledCount,
    totalFeesEarned: '0',
    supportedAssets: ['So11111111111111111111111111111111111111112', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'],
    proofVerificationEnabled: true
  });
});

app.get('/api/status', (req, res) => {

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
  res.json({

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
    active: true,

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
    feeBps: POOL_CONFIG.feeBps,

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
    operator: POOL_CONFIG.authority,

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
    totalTransactions: sequencerStatus.settledCount,

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
    totalFeesEarned: '0',

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
    supportedAssets: ['So11111111111111111111111111111111111111112', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'],

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
    proofVerificationEnabled: true

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
  });

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });
});

// Config endpoint for frontend
app.get('/config', (req, res) => {
  res.json({
    success: true,
    programId: process.env.PROGRAM_ID || 'BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb',
    poolConfig: process.env.POOL_CONFIG || 'FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj',
    mint: 'So11111111111111111111111111111111111111112',
    network: 'devnet',
    relayerPubkey: relayerKeypair?.publicKey?.toBase58() || null,
    feePercent: '0.5',
    minDeposit: '1000000',
    maxDeposit: '100000000000'
  });
});

app.get('/api/config', (req, res) => { req.url = '/config'; app.handle(req, res); });

// Pool state
app.get('/pool-state', async (req, res) => {
  try {
    const conn = initConnection();
    const merkleTreePubkey = new PublicKey(POOL_CONFIG.merkleTree);
    const pendingBufferPubkey = new PublicKey(POOL_CONFIG.pendingBuffer);
    
    const [merkleInfo, pendingInfo] = await Promise.all([
      conn.getAccountInfo(merkleTreePubkey),
      conn.getAccountInfo(pendingBufferPubkey)
    ]);
    
    const nextLeafIndex = merkleInfo ? merkleInfo.data.readUInt32LE(41) : 0;
    const rootHex = merkleInfo ? merkleInfo.data.slice(44, 76).toString('hex') : '0'.repeat(64);
    const pendingCount = pendingInfo ? pendingInfo.data.readUInt32LE(40) : 0;
    
    const commitments = [];
    if (pendingInfo && pendingCount > 0) {
      for (let i = 0; i < pendingCount; i++) {
        const offset = 44 + (i * 32);
        commitments.push(pendingInfo.data.slice(offset, offset + 32).toString('hex'));
      }
    }
    
    res.json({
      success: true,
      poolConfig: POOL_CONFIG.poolConfig,
      programId: POOL_CONFIG.programId,
      merkle: {
        address: POOL_CONFIG.merkleTree,
        root: BigInt('0x' + rootHex).toString(),
        rootHex,
        nextLeafIndex,
        treeDepth: POOL_CONFIG.treeDepth
      },
      pending: {
        address: POOL_CONFIG.pendingBuffer,
        count: pendingCount,
        commitments
      }
    });
  } catch (e) {
    console.error('Pool state error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/pool-state', async (req, res) => {
  req.url = '/pool-state';
  app.handle(req, res);
});

// Check commitment status - returns leafIndex if settled
app.get('/api/check-commitment-status', async (req, res) => {
  try {
    const { commitment } = req.query;
    if (!commitment) {
      return res.status(400).json({ success: false, error: 'Missing commitment parameter' });
    }

    // Convert commitment to hex if it's decimal
    let commitmentHex;
    if (/^[0-9]+$/.test(commitment)) {
      // Decimal - convert to hex
      commitmentHex = BigInt(commitment).toString(16).padStart(64, '0');
    } else {
      // Already hex
      commitmentHex = commitment.toLowerCase().replace('0x', '').padStart(64, '0');
    }

    // Get on-chain state
    const conn = rpcManager.getConnection();
    const merkleInfo = await conn.getAccountInfo(new PublicKey(CONFIG.MERKLE_TREE));
    const pendingInfo = await conn.getAccountInfo(new PublicKey(CONFIG.PENDING_BUFFER));

    if (!merkleInfo) {
      return res.status(500).json({ success: false, error: 'Failed to fetch merkle tree' });
    }

    const nextLeafIndex = merkleInfo.data.readUInt32LE(41);

    // Check if commitment is in pending buffer
    if (pendingInfo) {
      const pendingCount = pendingInfo.data.readUInt32LE(40);
      for (let i = 0; i < pendingCount; i++) {
        const offset = 44 + i * 32;
        if (pendingInfo.data.length >= offset + 32) {
          const pendingCommitment = pendingInfo.data.slice(offset, offset + 32).toString('hex');
          if (pendingCommitment === commitmentHex) {
            return res.json({
              success: true,
              status: 'pending',
              commitment: commitmentHex,
              leafIndex: undefined
            });
          }
        }
      }
    }

    // If not pending and nextLeafIndex > 0, it might be settled
    // We need to check the merkle tree history or assume it's settled if not in pending
    // For now, if not in pending buffer and we have leaves, assume settled
    // The actual leafIndex would need to be tracked separately or derived from events

    // Simple approach: if commitment not in pending, check if we can find it
    // For MVP: return as settled with leafIndex = nextLeafIndex - 1 as estimate
    // Better approach: track commitments in a database

    // Check if we have any leaves settled
    if (nextLeafIndex > 0) {
      // For now, we'll return that it's likely settled but we don't know exact index
      // The frontend should have stored the leafIndex when it received settlement confirmation
      return res.json({
        success: true,
        status: 'unknown',
        commitment: commitmentHex,
        message: 'Commitment not in pending buffer. May be settled or never deposited.',
        nextLeafIndex
      });
    }

    return res.json({
      success: true,
      status: 'not_found',
      commitment: commitmentHex
    });

  } catch (error) {
    console.error('Error checking commitment status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/check-commitment-status', (req, res) => {
  req.url = '/api/check-commitment-status';
  app.handle(req, res);
});

// Compute asset ID
app.post('/compute-asset-id', async (req, res) => {
  try {
    const { mint } = req.body;
    if (!mint) return res.status(400).json({ success: false, error: 'mint required' });
    
    const assetId = computeAssetIdFromMint(mint);
    res.json({
      success: true,
      assetId: BigInt('0x' + assetId.toString('hex')).toString(),
      assetIdHex: assetId.toString('hex'),
      mint
    });
  } catch (e) {
    console.error('Asset ID error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/compute-asset-id', (req, res) => {
  req.url = '/compute-asset-id';
  app.handle(req, res);
});

// Generate commitment
app.post('/generate-commitment', async (req, res) => {
  try {
    const { nullifier, secret, assetId, amount } = req.body;
    if (!nullifier || !secret || !assetId || amount === undefined) {
      return res.status(400).json({ success: false, error: 'nullifier, secret, assetId, amount required' });
    }
    
    await initPoseidon();
    const nullifierHash = poseidon([BigInt(nullifier)]);
    const commitment = poseidon([
      poseidon.F.toObject(nullifierHash),
      BigInt(secret),
      BigInt(assetId),
      BigInt(amount)
    ]);
    
    const commitmentStr = poseidon.F.toString(commitment);
    const nullifierHashStr = poseidon.F.toString(nullifierHash);
    
    res.json({
      success: true,
      commitment: commitmentStr,
      commitmentHex: BigInt(commitmentStr).toString(16).padStart(64, '0'),
      nullifierHash: nullifierHashStr,
      nullifierHashHex: BigInt(nullifierHashStr).toString(16).padStart(64, '0')
    });
  } catch (e) {
    console.error('Commitment error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/generate-commitment', (req, res) => {
  req.url = '/generate-commitment';
  app.handle(req, res);
});

// Deposit proof (pSOL doesn't require deposit proofs, commitment goes directly on-chain)
app.post('/deposit-proof', async (req, res) => {
  try {
    const startTime = Date.now();
    // pSOL v2 uses direct commitment submission, no ZK proof for deposits
    // Just return success with empty proof
    res.json({
      success: true,
      proofData: '',
      publicSignals: [],
      proofTimeMs: Date.now() - startTime
    });
  } catch (e) {
    console.error('Deposit proof error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/deposit-proof', (req, res) => {
  req.url = '/deposit-proof';
  app.handle(req, res);
});

// Build deposit transaction
app.post('/build-deposit-tx', async (req, res) => {
  try {
    const { amount, commitment, assetId, depositorPubkey, mint } = req.body;
    if (!amount || !commitment || !depositorPubkey || !mint) {
      return res.status(400).json({ success: false, error: 'amount, commitment, depositorPubkey, mint required' });
    }
    
    const conn = initConnection();
    const programId = new PublicKey(POOL_CONFIG.programId);
    const poolConfig = new PublicKey(POOL_CONFIG.poolConfig);
    const depositor = new PublicKey(depositorPubkey);
    const mintPubkey = new PublicKey(mint);
    
    // Compute asset ID if not provided
    const assetIdBuffer = assetId ? Buffer.from(assetId, 'hex') : computeAssetIdFromMint(mint);
    
    // Derive PDAs
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_v2'), poolConfig.toBuffer(), assetIdBuffer],
      programId
    );
    const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_token'), assetVault.toBuffer()],
      programId
    );
    const [pendingBuffer] = PublicKey.findProgramAddressSync(
      [Buffer.from('pending_deposits'), poolConfig.toBuffer()],
      programId
    );
    
    // Depositor's token account
    const depositorTokenAccount = getAssociatedTokenAddressSync(mintPubkey, depositor);
    
    // Build instruction - deposit discriminator
    const discriminator = Buffer.from([0xf8, 0xc6, 0x9e, 0x91, 0x6d, 0xec, 0x8b, 0x5b]); // deposit
    const amountBuffer = Buffer.alloc(8);
    amountBuffer.writeBigUInt64LE(BigInt(amount));
    const commitmentBuffer = Buffer.alloc(32);
    const commitmentBigInt = BigInt(commitment);
    for (let i = 0; i < 32; i++) {
      commitmentBuffer[i] = Number((commitmentBigInt >> BigInt(i * 8)) & 0xFFn);
    }
    
    const instructionData = Buffer.concat([discriminator, amountBuffer, commitmentBuffer, assetIdBuffer]);
    
    const ix = new anchor.web3.TransactionInstruction({
      programId,
      keys: [
        { pubkey: depositor, isSigner: true, isWritable: true },
        { pubkey: poolConfig, isSigner: false, isWritable: false },
        { pubkey: assetVault, isSigner: false, isWritable: true },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: depositorTokenAccount, isSigner: false, isWritable: true },
        { pubkey: pendingBuffer, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData
    });
    
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('finalized');
    
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    tx.add(ix);
    tx.recentBlockhash = blockhash;
    tx.feePayer = depositor;
    
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    
    res.json({
      success: true,
      transaction: serialized.toString('base64'),
      blockhash,
      lastValidBlockHeight
    });
  } catch (e) {
    console.error('Build deposit tx error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/build-deposit-tx', (req, res) => {
  req.url = '/build-deposit-tx';
  app.handle(req, res);
});

// Merkle proof
app.get('/merkle/proof/:leafIndex', async (req, res) => {
  try {
    const leafIndex = parseInt(req.params.leafIndex);
    await initPoseidon();
    
    // Sync state from chain
    const conn = initConnection();
    const merkleTreePubkey = new PublicKey(POOL_CONFIG.merkleTree);
    const merkleInfo = await conn.getAccountInfo(merkleTreePubkey);
    
    if (!merkleInfo) {
      return res.status(404).json({ success: false, error: 'Merkle tree not found' });
    }
    
    const nextLeafIndex = merkleInfo.data.readUInt32LE(41);
    if (leafIndex >= nextLeafIndex) {
      return res.status(400).json({ success: false, error: 'Leaf index out of bounds' });
    }
    
    const path = getMerklePath(merkleTreeState.leaves, leafIndex);
    const root = calculateTreeRoot(merkleTreeState.leaves);
    
    res.json({
      success: true,
      leafIndex,
      merkleRoot: root,
      merkleRootHex: BigInt(root).toString(16).padStart(64, '0'),
      pathElements: path.pathElements,
      pathIndices: path.pathIndices
    });
  } catch (e) {
    console.error('Merkle proof error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/merkle/proof/:leafIndex', (req, res) => {
  app._router.handle({ ...req, url: `/merkle/proof/${req.params.leafIndex}` }, res);
});

// Insert merkle leaf
app.post('/merkle/insert', async (req, res) => {
  try {
    const { commitment, leafIndex } = req.body;
    if (!commitment) {
      return res.status(400).json({ success: false, error: 'commitment required' });
    }
    
    await initPoseidon();
    
    const idx = leafIndex !== undefined ? leafIndex : merkleTreeState.leaves.length;
    if (idx === merkleTreeState.leaves.length) {
      merkleTreeState.leaves.push(commitment);
    } else {
      merkleTreeState.leaves[idx] = commitment;
    }
    
    merkleTreeState.root = calculateTreeRoot(merkleTreeState.leaves);
    saveTreeState();
    
    res.json({
      success: true,
      leafIndex: idx,
      newMerkleRoot: merkleTreeState.root,
      newMerkleRootHex: BigInt(merkleTreeState.root).toString(16).padStart(64, '0'),
      totalLeaves: merkleTreeState.leaves.length
    });
  } catch (e) {
    console.error('Merkle insert error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/merkle/insert', (req, res) => {
  req.url = '/merkle/insert';
  app.handle(req, res);
});

// Withdraw quote
app.get('/quote', (req, res) => {
  try {
    const amount = req.query.amount;
    if (!amount) {
      return res.status(400).json({ success: false, error: 'amount required' });
    }
    
    const amountBigInt = BigInt(amount);
    const fee = (amountBigInt * BigInt(POOL_CONFIG.feeBps)) / 10000n;
    const netAmount = amountBigInt - fee;
    
    res.json({
      amount: amount,
      fee: fee.toString(),
      feeBps: POOL_CONFIG.feeBps,
      netAmount: netAmount.toString()
    });
  } catch (e) {
    console.error('Quote error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/quote', (req, res) => {
  req.url = '/quote';
  app.handle(req, res);
});

// Withdraw proof
app.post('/withdraw-proof', async (req, res) => {
  try {
    const {
      merkleRoot, nullifierHash, assetId, recipient, amount,
      relayer, relayerFee, publicDataHash, secret, nullifier,
      leafIndex, merklePath, merklePathIndices
    } = req.body;
    
    await initPoseidon();
    
    // Compute nullifier hash if not provided
    const nullHash = nullifierHash || poseidon.F.toString(poseidon([BigInt(nullifier)]));
    
    const input = {
      schema_version: '2',
      merkle_root: merkleRoot,
      asset_id: assetId,
      nullifier_hash_0: nullHash,
      nullifier_hash_1: '0',
      change_commitment: '0',
      recipient: recipient,
      amount: amount,
      relayer: relayer || '0',
      relayer_fee: relayerFee || '0',
      public_data_hash: publicDataHash || '0',
      reserved_0: '0',
      input_secret: secret,
      input_nullifier: nullifier,
      input_amount: amount,
      leaf_index: leafIndex.toString(),
      merkle_path: merklePath,
      merkle_path_indices: merklePathIndices,
      change_secret: '0',
      change_nullifier: '0',
      change_amount: '0'
    };
    
    console.log('Generating withdraw proof...');
    const startTime = Date.now();
    
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WITHDRAW_WASM, WITHDRAW_ZKEY);
    const proofData = formatProofForSolana(proof);
    const proofTimeMs = Date.now() - startTime;
    
    console.log(`Withdraw proof generated in ${proofTimeMs}ms`);
    
    res.json({
      success: true,
      proofData: Buffer.from(proofData).toString('hex'),
      publicSignals,
      proofTimeMs
    });
  } catch (e) {
    console.error('Withdraw proof error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/withdraw-proof', (req, res) => {
  req.url = '/withdraw-proof';
  app.handle(req, res);
});

// Submit withdrawal
app.post('/withdraw', async (req, res) => {
  try {
    const { proofData, merkleRoot, nullifierHash, recipient, amount, assetId, mint } = req.body;
    
    // For now, return instructions for client-side submission
    // Full relayer submission would require signing with relayer key
    res.json({
      success: true,
      message: 'Withdrawal prepared. Client should submit transaction.',
      data: { proofData, merkleRoot, nullifierHash, recipient, amount, assetId, mint }
    });
  } catch (e) {
    console.error('Withdraw error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/withdraw', (req, res) => {
  req.url = '/withdraw';
  app.handle(req, res);
});

// Poseidon hash
app.post('/poseidon', async (req, res) => {
  try {
    const { inputs } = req.body;
    if (!inputs || !Array.isArray(inputs)) {
      return res.status(400).json({ success: false, error: 'inputs array required' });
    }
    await initPoseidon();
    const hash = poseidonHash(inputs);
    res.json({ hash, hashHex: BigInt(hash).toString(16).padStart(64, '0') });
  } catch (e) {
    console.error('Poseidon error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/poseidon-hash', async (req, res) => {
  try {
    const { inputs } = req.body;
    if (!inputs || !Array.isArray(inputs)) {
      return res.status(400).json({ success: false, error: 'inputs array required' });
    }
    await initPoseidon();
    const hash = poseidonHash(inputs);
    res.json({ success: true, hash, hashHex: BigInt(hash).toString(16).padStart(64, '0') });
  } catch (e) {
    console.error('Poseidon hash error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/poseidon', (req, res) => { req.url = '/poseidon'; app.handle(req, res); });
app.post('/api/poseidon-hash', (req, res) => { req.url = '/poseidon-hash'; app.handle(req, res); });

// Pubkey to scalar
app.post('/pubkey-to-scalar', async (req, res) => {
  try {
    const { pubkey } = req.body;
    if (!pubkey) {
      return res.status(400).json({ success: false, error: 'pubkey required' });
    }
    
    const pubkeyBuffer = Buffer.from(bs58.decode(pubkey));
    const scalar = BigInt('0x' + pubkeyBuffer.toString('hex'));
    
    res.json({
      success: true,
      pubkey,
      scalar: scalar.toString(),
      scalarHex: scalar.toString(16).padStart(64, '0')
    });
  } catch (e) {
    console.error('Pubkey to scalar error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/pubkey-to-scalar', (req, res) => { req.url = '/pubkey-to-scalar'; app.handle(req, res); });

// Note status
app.get('/note/:commitment', async (req, res) => {
  try {
    const { commitment } = req.params;
    const conn = initConnection();
    
    const pendingBufferPubkey = new PublicKey(POOL_CONFIG.pendingBuffer);
    const pendingInfo = await conn.getAccountInfo(pendingBufferPubkey);
    
    if (!pendingInfo) {
      return res.json({ status: 'unknown', commitment });
    }
    
    const pendingCount = pendingInfo.data.readUInt32LE(40);
    let foundInPending = false;
    
    for (let i = 0; i < pendingCount; i++) {
      const offset = 44 + (i * 32);
      const c = BigInt('0x' + pendingInfo.data.slice(offset, offset + 32).toString('hex')).toString();
      if (c === commitment) {
        foundInPending = true;
        break;
      }
    }
    
    // Check if in local tree state (settled)
    const inTree = merkleTreeState.leaves.includes(commitment);
    
    let status = 'unknown';
    if (foundInPending) status = 'pending';
    else if (inTree) status = 'settled';
    
    res.json({ status, commitment });
  } catch (e) {
    console.error('Note status error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/note/:commitment', (req, res) => {
  app._router.handle({ ...req, url: `/note/${req.params.commitment}` }, res);
});

// Routes list
app.get('/api/routes', (req, res) => {
  res.json({
    version: '2.0.0',
    routes: [
      'GET  /',
      'GET  /health',
      'GET  /status',
      'GET  /pool-state',
      'POST /compute-asset-id',
      'POST /generate-commitment',
      'POST /deposit-proof',
      'POST /build-deposit-tx',
      'GET  /merkle/proof/:leafIndex',
      'POST /merkle/insert',
      'GET  /quote',
      'POST /withdraw-proof',
      'POST /withdraw',
      'POST /poseidon',
      'POST /poseidon-hash',
      'POST /pubkey-to-scalar',
      'GET  /note/:commitment'
    ]
  });
});

// 404 for /api/*
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found', path: req.originalUrl });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// ============================================================================
// START
// ============================================================================

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🌐 pSOL v2 Relayer API on port ${PORT}`);
  
  await initPoseidon();
  initConnection();
  loadTreeState();
  
  console.log('✓ All systems initialized');
  console.log(`✓ Pool: ${POOL_CONFIG.poolConfig}`);
  console.log(`✓ Tree leaves: ${merkleTreeState.leaves.length}`);
  
  // Start sequencer
  console.log('\n🚀 Starting sequencer...');
  require('./src/sequencer.js');
});

module.exports = { updateStatus: (s) => Object.assign(sequencerStatus, s) };
