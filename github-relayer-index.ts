/**
 * The White Protocol Relayer Service - Extended Entry Point
 * 
 * This file integrates:
 * - Original withdraw relayer (from relayer/src/index.ts)
 * - New API extensions for proof generation
 * 
 * Place this at: relayer/src/index.ts (replace existing)
 * 
 * @module relayer/index
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as fs from 'fs';
import * as path from 'path';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as snarkjs from 'snarkjs';

// Import API extensions
import { createApiExtensions, RelayerApiExtensions } from './api-extensions';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface RelayerConfig {
  rpcEndpoint: string;
  walletKeypair: Keypair;
  programId: PublicKey;
  poolConfig: PublicKey;
  feeBps: number;
  minWithdrawalAmount: bigint;
  maxWithdrawalAmount: bigint;
  port: number;
  withdrawVkPath: string;
  circuitsPath: string;
  treeDepth: number;
  corsOrigin: string;
}

const BN254_FIELD_ORDER = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function pubkeyToScalar(pubkey: PublicKey): bigint {
  const bytes = pubkey.toBytes();
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result % BN254_FIELD_ORDER;
}

function validateFieldElement(value: bigint, name: string): void {
  if (value < 0n) throw new Error(`${name} is negative: ${value}`);
  if (value >= BN254_FIELD_ORDER) throw new Error(`${name} exceeds field order: ${value}`);
}

interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

function deserializeGroth16Proof(proofData: Uint8Array): Groth16Proof {
  if (proofData.length !== 256) {
    throw new Error(`Invalid proof data length: expected 256 bytes, got ${proofData.length}`);
  }

  const slice = (start: number, end: number) => proofData.slice(start, end);

  const a0 = bytesToBigInt(slice(0, 32)).toString();
  const a1 = bytesToBigInt(slice(32, 64)).toString();
  const b01 = bytesToBigInt(slice(64, 96)).toString();
  const b00 = bytesToBigInt(slice(96, 128)).toString();
  const b11 = bytesToBigInt(slice(128, 160)).toString();
  const b10 = bytesToBigInt(slice(160, 192)).toString();
  const c0 = bytesToBigInt(slice(192, 224)).toString();
  const c1 = bytesToBigInt(slice(224, 256)).toString();

  return {
    pi_a: [a0, a1, '1'],
    pi_b: [[b00, b01], [b10, b11], ['1', '0']],
    pi_c: [c0, c1, '1'],
    protocol: 'groth16',
    curve: 'bn128',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// RELAYER SERVICE
// =============================================================================

class RelayerService {
  private config: RelayerConfig;
  private connection: Connection;
  private provider: AnchorProvider;
  private program: Program | null = null;
  private app: express.Application;
  private apiExtensions: RelayerApiExtensions | null = null;
  
  private totalTransactions: number = 0;
  private totalFeesEarned: bigint = 0n;
  private supportedAssets: Set<string> = new Set();
  private withdrawVk: any = null;

  constructor(config: RelayerConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcEndpoint, 'confirmed');
    
    // Load withdraw VK
    this.loadWithdrawVerificationKey();
    
    // Setup provider
    const wallet = {
      publicKey: config.walletKeypair.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.sign(config.walletKeypair);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach(tx => tx.sign(config.walletKeypair));
        return txs;
      },
    };
    
    this.provider = new AnchorProvider(this.connection, wallet as any, {
      commitment: 'confirmed',
    });
    
    // Setup Express
    this.app = express();
    this.setupMiddleware();
  }

  private loadWithdrawVerificationKey(): void {
    try {
      console.log(`Loading withdraw VK from: ${this.config.withdrawVkPath}`);
      const vkeyJson = fs.readFileSync(this.config.withdrawVkPath, 'utf8');
      this.withdrawVk = JSON.parse(vkeyJson);
      console.log('Withdraw VK loaded successfully');
    } catch (err) {
      console.warn('Withdraw VK not found, verification disabled');
    }
  }

  private setupMiddleware(): void {
    this.app.use(helmet());
    
    this.app.use(cors({
      origin: this.config.corsOrigin ? this.config.corsOrigin.split(',').map(s => s.trim()) : false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Sequencer-Token'],
    }));
    
    this.app.use(express.json({ limit: '2mb' }));
    
    // Rate limiting
    const globalLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 500,
      message: { error: 'Service temporarily unavailable' },
    });
    
    const perKeyLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: { error: 'Too many requests, please slow down' },
      keyGenerator: (req: Request) => {
        if (req.method === 'POST' && req.path === '/withdraw') {
          const body = req.body as any;
          if (body?.recipient) return `recipient:${body.recipient}`;
        }
        return req.ip || 'unknown';
      },
    });
    
    this.app.use(globalLimiter);
    this.app.use(perKeyLimiter);
    
    // Logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        proofVerificationEnabled: !!this.withdrawVk,
      });
    });
    
    // Relayer status
    this.app.get('/status', async (req: Request, res: Response) => {
      res.json({
        active: true,
        feeBps: this.config.feeBps,
        operator: this.config.walletKeypair.publicKey.toBase58(),
        totalTransactions: this.totalTransactions,
        totalFeesEarned: this.totalFeesEarned.toString(),
        supportedAssets: Array.from(this.supportedAssets),
        proofVerificationEnabled: !!this.withdrawVk,
      });
    });
    
    // Fee quote
    this.app.get('/quote', (req: Request, res: Response) => {
      const amount = BigInt(req.query.amount as string || '0');
      const fee = this.calculateFee(amount);
      res.json({
        amount: amount.toString(),
        fee: fee.toString(),
        feeBps: this.config.feeBps,
        netAmount: (amount - fee).toString(),
      });
    });
    
    // Withdrawal submission
    this.app.post('/withdraw', async (req: Request, res: Response) => {
      try {
        const result = await this.processWithdrawal(req.body);
        res.json(result);
      } catch (error: any) {
        console.error('Withdrawal error:', error);
        res.status(400).json({ success: false, error: error.message });
      }
    });
    
    // Supported assets
    this.app.get('/assets', (req: Request, res: Response) => {
      res.json({ assets: Array.from(this.supportedAssets) });
    });
    
    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      console.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  calculateFee(amount: bigint): bigint {
    return (amount * BigInt(this.config.feeBps)) / BigInt(10000);
  }

  private async processWithdrawal(request: any): Promise<any> {
    // Validate request
    this.validateWithdrawRequest(request);
    
    const amount = BigInt(request.amount);
    const fee = this.calculateFee(amount);
    
    if (amount < this.config.minWithdrawalAmount) {
      throw new Error(`Amount below minimum: ${this.config.minWithdrawalAmount}`);
    }
    if (amount > this.config.maxWithdrawalAmount) {
      throw new Error(`Amount above maximum: ${this.config.maxWithdrawalAmount}`);
    }
    
    const proofData = hexToBytes(request.proofData);
    const merkleRoot = hexToBytes(request.merkleRoot);
    const nullifierHash = hexToBytes(request.nullifierHash);
    const assetId = hexToBytes(request.assetId);
    const recipient = new PublicKey(request.recipient);
    const mint = new PublicKey(request.mint);
    
    // Verify proof locally if VK available
    if (this.withdrawVk) {
      const isValid = await this.verifyWithdrawProof({
        proofData,
        merkleRoot,
        nullifierHash,
        assetId,
        recipient,
        amount,
        relayer: this.config.walletKeypair.publicKey,
        relayerFee: fee,
      });
      
      if (!isValid) {
        throw new Error('Invalid withdrawal proof');
      }
    }
    
    // Check nullifier
    const isSpent = await this.checkNullifierSpent(nullifierHash);
    if (isSpent) {
      throw new Error('Nullifier already spent');
    }
    
    // Submit transaction
    const signature = await this.submitWithdrawalWithRetry({
      proofData,
      merkleRoot,
      nullifierHash,
      recipient,
      amount,
      fee,
      assetId,
      mint,
    });
    
    this.totalTransactions++;
    this.totalFeesEarned += fee;
    
    return { success: true, signature };
  }

  private validateWithdrawRequest(request: any): void {
    if (!request.proofData || request.proofData.length !== 512) {
      throw new Error('Invalid proof data length');
    }
    if (!request.merkleRoot || request.merkleRoot.length !== 64) {
      throw new Error('Invalid merkle root length');
    }
    if (!request.nullifierHash || request.nullifierHash.length !== 64) {
      throw new Error('Invalid nullifier hash length');
    }
    if (!request.recipient) {
      throw new Error('Missing recipient');
    }
    if (!request.amount || BigInt(request.amount) <= 0) {
      throw new Error('Invalid amount');
    }
    if (!request.assetId || request.assetId.length !== 64) {
      throw new Error('Invalid asset ID length');
    }
    if (!request.mint) {
      throw new Error('Missing mint');
    }
  }

  private async verifyWithdrawProof(params: any): Promise<boolean> {
    if (!this.withdrawVk) return true;
    
    try {
      const proof = deserializeGroth16Proof(params.proofData);
      
      const merkleRootScalar = bytesToBigInt(params.merkleRoot);
      const nullifierHashScalar = bytesToBigInt(params.nullifierHash);
      const assetIdScalar = bytesToBigInt(params.assetId);
      const recipientScalar = pubkeyToScalar(params.recipient);
      const relayerScalar = pubkeyToScalar(params.relayer);
      
      const publicSignals = [
        merkleRootScalar.toString(),
        nullifierHashScalar.toString(),
        assetIdScalar.toString(),
        recipientScalar.toString(),
        params.amount.toString(),
        relayerScalar.toString(),
        params.relayerFee.toString(),
        '0', // publicDataHash
      ];
      
      return await snarkjs.groth16.verify(this.withdrawVk, publicSignals, proof);
    } catch (err) {
      console.error('Proof verification error:', err);
      return false;
    }
  }

  private async checkNullifierSpent(nullifierHash: Uint8Array): Promise<boolean> {
    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('nullifier_v2'),
        this.config.poolConfig.toBuffer(),
        Buffer.from(nullifierHash),
      ],
      this.config.programId,
    );
    
    const accountInfo = await this.connection.getAccountInfo(nullifierPda);
    return accountInfo !== null;
  }

  private async submitWithdrawalWithRetry(params: any): Promise<string> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await this.submitWithdrawal(params);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`Attempt ${attempt} failed:`, lastError.message);
        
        if (this.isNonRetryableError(lastError)) throw lastError;
        
        if (attempt < 3) {
          await sleep(1000 * Math.pow(2, attempt - 1));
        }
      }
    }
    
    throw lastError || new Error('Transaction failed');
  }

  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return ['nullifier already spent', 'invalid proof', 'insufficient funds'].some(
      p => message.includes(p)
    );
  }

  private async submitWithdrawal(params: any): Promise<string> {
    // This is a placeholder - actual implementation would build and send the transaction
    // Using the Anchor program instance
    throw new Error('Transaction submission not implemented - requires IDL setup');
  }

  addSupportedAsset(assetId: string): void {
    if (!/^[0-9a-fA-F]{64}$/.test(assetId)) {
      throw new Error('Invalid asset ID format');
    }
    this.supportedAssets.add(assetId.toLowerCase());
  }

  async start(): Promise<void> {
    console.log('========================================');
    console.log('The White Protocol Relayer Service Initializing...');
    console.log('========================================');
    
    // Initialize API extensions
    console.log('Loading API extensions...');
    this.apiExtensions = await createApiExtensions({
      circuitsPath: this.config.circuitsPath,
      rpcEndpoint: this.config.rpcEndpoint,
      poolConfig: this.config.poolConfig,
      programId: this.config.programId,
      treeDepth: this.config.treeDepth,
    });
    
    // Setup routes
    this.setupRoutes();
    
    // Mount API extensions
    this.app.use('/api', this.apiExtensions.getRouter());
    
    // Start server
    this.app.listen(this.config.port, () => {
      console.log('========================================');
      console.log('The White Protocol Relayer Service Started');
      console.log('========================================');
      console.log(`Port: ${this.config.port}`);
      console.log(`Operator: ${this.config.walletKeypair.publicKey.toBase58()}`);
      console.log(`Fee: ${this.config.feeBps} bps`);
      console.log(`Proof verification: ${this.withdrawVk ? 'ENABLED' : 'DISABLED'}`);
      console.log(`API Extensions: ENABLED`);
      console.log('');
      console.log('Endpoints:');
      console.log('  GET  /health              - Health check');
      console.log('  GET  /status              - Relayer status');
      console.log('  GET  /quote?amount=X      - Fee quote');
      console.log('  POST /withdraw            - Submit withdrawal');
      console.log('  POST /api/generate-commitment  - Generate note commitment');
      console.log('  POST /api/compute-asset-id     - Compute asset ID');
      console.log('  POST /api/deposit-proof        - Generate deposit proof');
      console.log('  POST /api/withdraw-proof       - Generate withdraw proof');
      console.log('  GET  /api/pool-state           - Get pool state');
      console.log('  GET  /api/merkle/proof/:idx    - Get merkle proof');
      console.log('  POST /api/merkle/insert        - Insert into merkle tree');
      console.log('  POST /api/poseidon-hash        - Poseidon hash');
      console.log('  POST /api/pubkey-to-scalar     - Convert pubkey');
      console.log('========================================');
    });
  }
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

async function main(): Promise<void> {
  // Load keypair from environment or file
  let walletKeypair: Keypair;
  
  if (process.env.RELAYER_KEYPAIR) {
    walletKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(process.env.RELAYER_KEYPAIR))
    );
  } else if (process.env.RELAYER_KEYPAIR_PATH) {
    const keypairData = JSON.parse(
      fs.readFileSync(process.env.RELAYER_KEYPAIR_PATH, 'utf8')
    );
    walletKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  } else {
    console.error('ERROR: Set RELAYER_KEYPAIR or RELAYER_KEYPAIR_PATH');
    process.exit(1);
  }
  
  const config: RelayerConfig = {
    rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.devnet.solana.com',
    walletKeypair,
    programId: new PublicKey(
      process.env.PROGRAM_ID || 'HJmgwBBjojb2SdKPCW4DFNh2wRQzZ5mtD6ro2YocpZHj'
    ),
    poolConfig: new PublicKey(
      process.env.POOL_CONFIG || 'GZiRVMV7FjrGxjE379HiEyHyVCisHkFnjMJen95kEVEQ'
    ),
    feeBps: parseInt(process.env.FEE_BPS || '50', 10),
    minWithdrawalAmount: BigInt(process.env.MIN_WITHDRAWAL || '1000000'),
    maxWithdrawalAmount: BigInt(process.env.MAX_WITHDRAWAL || '1000000000000'),
    port: parseInt(process.env.PORT || '3001', 10),
    withdrawVkPath: process.env.WITHDRAW_VK_PATH || './circuits/build/withdraw_vk.json',
    circuitsPath: process.env.CIRCUITS_PATH || './circuits/build',
    treeDepth: parseInt(process.env.TREE_DEPTH || '20', 10),
    corsOrigin: process.env.CORS_ORIGIN || '',
  };
  
  const relayer = new RelayerService(config);
  
  // Add supported assets
  const supportedAssets = process.env.SUPPORTED_ASSETS?.split(',') || [];
  for (const asset of supportedAssets) {
    if (asset.trim()) {
      relayer.addSupportedAsset(asset.trim());
    }
  }
  
  await relayer.start();
}

// Run
main().catch(err => {
  console.error('Failed to start relayer:', err);
  process.exit(1);
});

export { RelayerService, RelayerConfig };
