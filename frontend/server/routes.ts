import type { Express } from "express";
import type { Server } from "http";
import { Connection, PublicKey } from "@solana/web3.js";

// ✅ CORRECT POOL ADDRESSES - matches relayer
const CONFIG = {
  PROGRAM_ID: 'C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW',
  POOL_CONFIG: 'EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS',
  MERKLE_TREE: '2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD',
  PENDING_BUFFER: '7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw',
  RPC_URL: 'https://api.devnet.solana.com',
  TREE_DEPTH: 20,
} as const;

const HELIUS_API_KEY = (process.env.HELIUS_API_KEY ?? '').trim();
const RPC_URL = HELIUS_API_KEY.length > 0
  ? ('https://devnet.helius-rpc.com/?api-key=' + encodeURIComponent(HELIUS_API_KEY))
  : CONFIG.RPC_URL;

// In-memory storage for settled commitments
const settledCommitments: Map<string, { leafIndex: number; settledAt: number }> = new Map();

// Helper to read on-chain merkle tree
async function fetchMerkleTreeState(connection: Connection): Promise<{
  root: string;
  nextLeafIndex: number;
}> {
  const accountInfo = await connection.getAccountInfo(new PublicKey(CONFIG.MERKLE_TREE));
  if (!accountInfo) throw new Error('Merkle tree not found');
  
  const data = accountInfo.data;
  const rootBytes = data.slice(8, 40);
  let root = 0n;
  for (let i = 0; i < 32; i++) {
    root = (root << 8n) | BigInt(rootBytes[i]);
  }
  
  const nextLeafIndex = data.readUInt32LE(40);
  
  return { root: root.toString(16), nextLeafIndex };
}

// Helper to read pending buffer
async function fetchPendingBuffer(connection: Connection): Promise<{
  pendingCount: number;
  commitments: string[];
}> {
  const accountInfo = await connection.getAccountInfo(new PublicKey(CONFIG.PENDING_BUFFER));
  if (!accountInfo) throw new Error('Pending buffer not found');
  
  const data = accountInfo.data;
  const pendingCount = data.readUInt32LE(40);
  
  const commitments: string[] = [];
  for (let i = 0; i < pendingCount; i++) {
    const start = 44 + i * 32;
    const commitmentBytes = data.slice(start, start + 32);
    let commitment = 0n;
    for (let j = 0; j < 32; j++) {
      commitment = (commitment << 8n) | BigInt(commitmentBytes[j]);
    }
    commitments.push(commitment.toString());
  }
  
  return { pendingCount, commitments };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const connection = new Connection(RPC_URL, 'confirmed');

  // GET /api/config
  app.get('/api/config', (req, res) => {
    res.json({
      success: true,
      config: {
        PROGRAM_ID: CONFIG.PROGRAM_ID,
        POOL_CONFIG: CONFIG.POOL_CONFIG,
        MERKLE_TREE: CONFIG.MERKLE_TREE,
        PENDING_BUFFER: CONFIG.PENDING_BUFFER,
        RPC_URL,
        TREE_DEPTH: CONFIG.TREE_DEPTH,
      }
    });
  });

  // GET /api/pool/status
  app.get('/api/pool/status', async (req, res) => {
    try {
      const [merkleState, pendingState] = await Promise.all([
        fetchMerkleTreeState(connection),
        fetchPendingBuffer(connection),
      ]);
      
      res.json({
        success: true,
        pool: {
          programId: CONFIG.PROGRAM_ID,
          poolConfig: CONFIG.POOL_CONFIG,
          merkleTree: CONFIG.MERKLE_TREE,
        },
        merkle: {
          root: merkleState.root,
          nextLeafIndex: merkleState.nextLeafIndex,
          settledCount: merkleState.nextLeafIndex,
        },
        pending: {
          count: pendingState.pendingCount,
          commitments: pendingState.commitments,
        },
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/note/:commitment
  app.get('/api/note/:commitment', async (req, res) => {
    try {
      const { commitment } = req.params;
      
      const cached = settledCommitments.get(commitment);
      if (cached) {
        return res.json({
          success: true,
          status: 'settled',
          leafIndex: cached.leafIndex,
          settledAt: cached.settledAt,
        });
      }
      
      const pendingState = await fetchPendingBuffer(connection);
      const isPending = pendingState.commitments.includes(commitment);
      
      if (isPending) {
        return res.json({
          success: true,
          status: 'pending',
          position: pendingState.commitments.indexOf(commitment),
          pendingTotal: pendingState.pendingCount,
        });
      }
      
      const merkleState = await fetchMerkleTreeState(connection);
      
      res.json({
        success: true,
        status: 'unknown',
        message: 'Commitment not found in pending buffer. May already be settled or not deposited.',
        merkleNextIndex: merkleState.nextLeafIndex,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/health
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  return httpServer;
}
