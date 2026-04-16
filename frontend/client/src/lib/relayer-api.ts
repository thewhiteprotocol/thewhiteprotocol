/**
 * The White Protocol v2 Relayer API Client - Hardened Production Version
 * 
 * Features:
 * - Automatic retry with exponential backoff
 * - Connection health tracking
 * - Request deduplication for concurrent calls
 * - Detailed error types
 * - Offline detection
 * - Request cancellation support
 * 
 * Place this file at: client/src/lib/relayer-api.ts
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const RELAYER_API_URL =
  ((import.meta.env.VITE_RELAYER_API_URL as string | undefined) ?? 'https://thewhiteprotocol.onrender.com/api')
    .trim()
    .replace(/\/+$/, '');

// HTTPS security check - warn but don't break local dev
if (RELAYER_API_URL && !RELAYER_API_URL.startsWith('https://') && !RELAYER_API_URL.includes('localhost') && !RELAYER_API_URL.includes('127.0.0.1')) {
  console.error('[SECURITY] Relayer API URL must use HTTPS in production');
}

// Dev-only logger - never logs in production
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
const devLog = (...args: any[]) => { if (isDev) devLog(...args); };

const CONFIG = {
  /** Request timeout in milliseconds */
  REQUEST_TIMEOUT_MS: 120000, // 2 minutes for proof generation

  /** Maximum retry attempts */
  MAX_RETRIES: 3,

  /** Base delay for exponential backoff (ms) */
  RETRY_BASE_DELAY_MS: 1000,

  /** Maximum backoff delay (ms) */
  RETRY_MAX_DELAY_MS: 10000,

  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL_MS: 30000,

  /** Consider unhealthy after N consecutive failures */
  UNHEALTHY_THRESHOLD: 3,
};

// =============================================================================
// TYPES
// =============================================================================

export interface CommitmentResult {
  commitment: string;
  commitmentHex: string;
  nullifierHash: string;
  nullifierHashHex: string;
}

export interface AssetIdResult {
  assetId: string;
  assetIdHex: string;
  mint: string;
  relayerFee?: string;
  assetId?: string;
  changeCommitment?: string;
}

export interface ProofResult {
  proofData: string;
  publicSignals: string[];
  proofTimeMs: number;
}

export interface PoolState {
  poolConfig: string;
  programId: string;
  merkle: {
    address: string;
    root: string;
    rootHex: string;
    nextLeafIndex: number;
    treeDepth: number;
  };
  pending: {
    address: string;
    count: number;
    commitments: string[];
  };
}

export interface MerkleProofResult {
  leafIndex: number;
  merkleRoot: string;
  merkleRootHex: string;
  pathElements: string[];
  pathIndices: number[];
}

export interface WithdrawQuote {
  amount: string;
  fee: string;
  feeBps: number;
  netAmount: string;
}

export interface WithdrawResult {
  success: boolean;
  signature?: string;
  error?: string;
}

export interface PoseidonHashResult {
  hash: string;
  hashHex: string;
}

export interface PubkeyScalarResult {
  pubkey: string;
  scalar: string;
  scalarHex: string;
}

export interface RelayerHealth {
  status: string;
  timestamp: number;
  proofVerificationEnabled: boolean;
  rpcLatencyMs?: number;
  proofQueueSize?: number;
  proofQueueMax?: number;
}

export interface RelayerStatus {
  active: boolean;
  feeBps: number;
  operator: string;
  totalTransactions: number;
  totalFeesEarned: string;
  supportedAssets: string[];
  proofVerificationEnabled: boolean;
  stats?: {
    uptime: number;
    requests: number;
    proofs: number;
    errors: number;
  };
}

export type ErrorCode = 
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'OFFLINE'
  | 'UNHEALTHY'
  | 'CANCELLED';

// =============================================================================
// ERROR CLASS
// =============================================================================

export class RelayerApiError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public statusCode: number = 0,
    public details?: unknown,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'RelayerApiError';
  }

  static fromResponse(status: number, data: unknown): RelayerApiError {
    const message = (data as { error?: string })?.error || `Request failed with status ${status}`;

    if (status === 429) {
      return new RelayerApiError(message, 'RATE_LIMITED', status, data, true);
    }
    if (status === 400) {
      return new RelayerApiError(message, 'VALIDATION_ERROR', status, data, false);
    }
    if (status >= 500) {
      return new RelayerApiError(message, 'SERVER_ERROR', status, data, true);
    }

    return new RelayerApiError(message, 'SERVER_ERROR', status, data, false);
  }
}

// =============================================================================
// CONNECTION STATE MANAGER
// =============================================================================

class ConnectionManager {
  private healthy = true;
  private consecutiveFailures = 0;
  private lastHealthCheck = 0;
  private healthCheckPromise: Promise<boolean> | null = null;
  private listeners: Set<(healthy: boolean) => void> = new Set();

  isHealthy(): boolean {
    return this.healthy;
  }

  markSuccess(): void {
    this.consecutiveFailures = 0;
    if (!this.healthy) {
      this.healthy = true;
      this.notifyListeners();
    }
  }

  markFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CONFIG.UNHEALTHY_THRESHOLD && this.healthy) {
      this.healthy = false;
      this.notifyListeners();
    }
  }

  onHealthChange(callback: (healthy: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(cb => cb(this.healthy));
  }

  async checkHealth(): Promise<boolean> {
    const now = Date.now();

    // Debounce health checks
    if (now - this.lastHealthCheck < CONFIG.HEALTH_CHECK_INTERVAL_MS) {
      return this.healthy;
    }

    // Deduplicate concurrent health checks
    if (this.healthCheckPromise) {
      return this.healthCheckPromise;
    }

    this.healthCheckPromise = this.performHealthCheck();

    try {
      return await this.healthCheckPromise;
    } finally {
      this.healthCheckPromise = null;
      this.lastHealthCheck = Date.now();
    }
  }

  private async performHealthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${RELAYER_API_URL}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        this.markSuccess();
        return true;
      }

      this.markFailure();
      return false;
    } catch {
      this.markFailure();
      return false;
    }
  }
}

const connectionManager = new ConnectionManager();

// =============================================================================
// REQUEST DEDUPLICATION
// =============================================================================

const pendingRequests = new Map<string, Promise<unknown>>();

function getRequestKey(endpoint: string, body?: unknown): string {
  return `${endpoint}:${body ? JSON.stringify(body) : ''}`;
}

// =============================================================================
// CORE API REQUEST FUNCTION
// =============================================================================

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  retryCount = 0
): Promise<T> {
  // Check if offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new RelayerApiError('No internet connection', 'OFFLINE', 0, null, true);
  }

  // Check connection health for non-health endpoints
  if (!endpoint.includes('/health') && !connectionManager.isHealthy()) {
    // Try a quick health check before failing
    const healthy = await connectionManager.checkHealth();
    if (!healthy) {
      throw new RelayerApiError(
        'Relayer service is currently unavailable',
        'UNHEALTHY',
        0,
        null,
        true
      );
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

  const url = `${RELAYER_API_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = { error: 'Invalid JSON response' };
    }

    if (!response.ok || (data as { success?: boolean })?.success === false) {
      const error = RelayerApiError.fromResponse(response.status, data);

      // Retry if retryable and under limit
      if (error.retryable && retryCount < CONFIG.MAX_RETRIES) {
        const delay = Math.min(
          CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, retryCount),
          CONFIG.RETRY_MAX_DELAY_MS
        );

        devLog(`[RelayerAPI] Retrying in ${delay}ms (attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));

        return apiRequest<T>(endpoint, options, retryCount + 1);
      }

      connectionManager.markFailure();
      throw error;
    }

    connectionManager.markSuccess();
    return data as T;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof RelayerApiError) {
      throw error;
    }

    if ((error as Error).name === 'AbortError') {
      const timeoutError = new RelayerApiError('Request timed out', 'TIMEOUT', 408, null, true);

      if (retryCount < CONFIG.MAX_RETRIES) {
        devLog(`[RelayerAPI] Timeout, retrying (attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
        return apiRequest<T>(endpoint, options, retryCount + 1);
      }

      connectionManager.markFailure();
      throw timeoutError;
    }

    const networkError = new RelayerApiError(
      `Network error: ${(error as Error).message}`,
      'NETWORK_ERROR',
      0,
      null,
      true
    );

    if (retryCount < CONFIG.MAX_RETRIES) {
      const delay = CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
      devLog(`[RelayerAPI] Network error, retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      return apiRequest<T>(endpoint, options, retryCount + 1);
    }

    connectionManager.markFailure();
    throw networkError;
  }
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Generate note commitment from secret note data
 */
export async function generateCommitment(
  secret: string,
  nullifier: string,
  amount: string,
  assetId: string
): Promise<CommitmentResult> {
  devLog('[RelayerAPI] Generating commitment...');

  const result = await apiRequest<{ success: true } & CommitmentResult>(
    '/generate-commitment',
    {
      method: 'POST',
      body: JSON.stringify({ secret, nullifier, amount, assetId }),
    }
  );

  return {
    commitment: result.commitment,
    commitmentHex: result.commitmentHex,
    nullifierHash: result.nullifierHash,
    nullifierHashHex: result.nullifierHashHex,
  };
}

/**
 * Compute asset ID from mint address
 */
export async function computeAssetId(mint: string): Promise<AssetIdResult> {
  devLog('[RelayerAPI] Computing asset ID for mint:', mint);

  const result = await apiRequest<{ success: true } & AssetIdResult>(
    '/compute-asset-id',
    {
      method: 'POST',
      body: JSON.stringify({ mint }),
    }
  );

  return {
    assetId: result.assetId,
    changeCommitment: result.changeCommitment,
    assetIdHex: result.assetIdHex,
    mint: result.mint,
  };
}

/**
 * Generate deposit proof
 */
export async function generateDepositProof(
  secret: string,
  nullifier: string,
  commitment: string,
  amount: string,
  assetId: string
): Promise<ProofResult> {
  devLog('[RelayerAPI] Generating deposit proof...');

  const result = await apiRequest<{ success: true } & ProofResult>(
    '/deposit-proof',
    {
      method: 'POST',
      body: JSON.stringify({ secret, nullifier, commitment, amount, assetId }),
    }
  );

  devLog(`[RelayerAPI] Deposit proof generated in ${result.proofTimeMs}ms`);

  const proofCandidate =
    (result as any).proofData ??
    (result as any).proof ??
    (result as any).proof_json ??
    (result as any).proofBytes;

  const proofHex = normalizeProofDataToHex256(proofCandidate);
  if (proofHex.length !== 512) {
    throw new Error(`normalizeProofDataToHex256 produced invalid hex length: ${proofHex.length} (expected 512)`);
  }

  return {
    proofData: proofHex,
    publicSignals: (result as any).publicSignals,
    proofTimeMs: (result as any).proofTimeMs,
  };
}

/**
 * Generate withdraw proof (heavy operation - queued on server)
 */
export async function generateWithdrawProof(params: {
  merkleRoot: string;
  nullifierHash?: string;
  assetId: string;
  recipient: string;
  amount: string;
  relayer?: string;
  relayerFee?: string;
  publicDataHash?: string;
  secret: string;
  nullifier: string;
  leafIndex: number;
  merklePath: string[];
  merklePathIndices: number[];
  noteAmount?: string;
}): Promise<ProofResult> {
  devLog('[RelayerAPI] Generating withdraw proof (this may take 30-60 seconds)...');

  const result = await apiRequest<{ success: true } & ProofResult>(
    '/withdraw-proof',
    {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        relayer: params.relayer || '0',
        relayerFee: params.relayerFee || '0',
        publicDataHash: params.publicDataHash || '0',
        noteAmount: params.noteAmount || params.amount,
      }),
    }
  );

  devLog(`[RelayerAPI] Withdraw proof generated in ${result.proofTimeMs}ms`);

  return {
    proofData: result.proofData,
    publicSignals: result.publicSignals,
    proofTimeMs: result.proofTimeMs,
    nullifierHash: result.nullifierHash,
    relayerFee: result.relayerFee,
    assetId: result.assetId,
    changeCommitment: result.changeCommitment,
    changeNote: (result as any).changeNote || null,
  };
}

/**
 * Get current pool state
 */
export async function getPoolState(): Promise<PoolState> {
  devLog('[RelayerAPI] Fetching pool state...');

  // Deduplicate concurrent calls
  const key = getRequestKey('/pool-state');

  if (pendingRequests.has(key)) {
    return pendingRequests.get(key) as Promise<PoolState>;
  }

  const promise = apiRequest<{ success: true } & PoolState>('/pool-state', { method: 'GET' })
    .then(result => ({
      poolConfig: result.poolConfig,
      programId: result.programId,
      merkle: result.merkle,
      pending: result.pending,
    }))
    .finally(() => pendingRequests.delete(key));

  pendingRequests.set(key, promise);
  return promise;
}

/**
 * Get merkle proof for a leaf
 */
export async function getMerkleProof(leafIndex: number): Promise<MerkleProofResult> {
  devLog('[RelayerAPI] Fetching merkle proof for leaf:', leafIndex);

  const result = await apiRequest<{ success: true } & MerkleProofResult>(
    `/merkle/proof/${leafIndex}`,
    { method: 'GET' }
  );

  return {
    leafIndex: result.leafIndex,
    merkleRoot: result.merkleRoot,
    merkleRootHex: result.merkleRootHex,
    pathElements: result.pathElements,
    pathIndices: result.pathIndices,
  };
}

/**
 * Insert commitment into merkle tree (tracking only)
 */
export async function insertMerkleLeaf(
  commitment: string,
  leafIndex?: number
): Promise<{
  leafIndex: number;
  newMerkleRoot: string;
  newMerkleRootHex: string;
  totalLeaves: number;
}> {
  devLog('[RelayerAPI] Inserting commitment into merkle tree...');

  const result = await apiRequest<{
    success: true;
    leafIndex: number;
    newMerkleRoot: string;
    newMerkleRootHex: string;
    totalLeaves: number;
  }>('/merkle/insert', {
    method: 'POST',
    body: JSON.stringify({ commitment, leafIndex }),
  });

  return {
    leafIndex: result.leafIndex,
    newMerkleRoot: result.newMerkleRoot,
    newMerkleRootHex: result.newMerkleRootHex,
    totalLeaves: result.totalLeaves,
  };
}

/**
 * Get withdrawal fee quote
 */
export async function getWithdrawQuote(amount: string): Promise<WithdrawQuote> {
  devLog('[RelayerAPI] Getting withdraw quote for amount:', amount);

  const result = await apiRequest<WithdrawQuote>(
    `/quote?amount=${encodeURIComponent(amount)}`,
    { method: 'GET' }
  );

  return result;
}

/**
 * Submit withdrawal to relayer
 */
export async function submitWithdrawal(params: {
  proofData: string;
  merkleRoot: string;
  nullifierHash: string;
  recipient: string;
  amount: string;
  assetId: string;
  mint: string;
  relayerFee?: string;
  assetId?: string;
  changeCommitment?: string;
}): Promise<WithdrawResult> {
  devLog('[RelayerAPI] Submitting withdrawal...');

  const result = await apiRequest<WithdrawResult>('/withdraw', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  return result;
}

/**
 * Compute Poseidon hash
 */
export async function poseidonHash(inputs: string[]): Promise<PoseidonHashResult> {
  const result = await apiRequest<{ success: true } & PoseidonHashResult>(
    '/poseidon-hash',
    {
      method: 'POST',
      body: JSON.stringify({ inputs }),
    }
  );

  return {
    hash: result.hash,
    hashHex: result.hashHex,
  };
}

/**
 * Convert pubkey to scalar for circuit inputs
 */
export async function pubkeyToScalar(pubkey: string): Promise<PubkeyScalarResult> {
  const result = await apiRequest<{ success: true } & PubkeyScalarResult>(
    '/pubkey-to-scalar',
    {
      method: 'POST',
      body: JSON.stringify({ pubkey }),
    }
  );

  return {
    pubkey: result.pubkey,
    scalar: result.scalar,
    scalarHex: result.scalarHex,
  };
}

/**
 * Check relayer health
 */
export async function checkHealth(): Promise<RelayerHealth> {
  const result = await apiRequest<RelayerHealth>('/health', { method: 'GET' });
  return result;
}

/**
 * Get relayer status
 */
export async function getRelayerStatus(): Promise<RelayerStatus> {
  const result = await apiRequest<RelayerStatus>('/status', { method: 'GET' });
  return result;
}

/**
 * Get note status by commitment
 */
export async function getNoteStatus(commitment: string): Promise<{
  status: 'pending' | 'settled' | 'unknown';
  commitment: string;
}> {
  const result = await apiRequest<{
    status: 'pending' | 'settled' | 'unknown';
    commitment: string;
  }>(`/note/${encodeURIComponent(commitment)}`, { method: 'GET' });

  return result;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate random secret and nullifier (client-side)
 */
export function generateSecrets(): { secret: string; nullifier: string } {
  const secretBytes = new Uint8Array(31);
  const nullifierBytes = new Uint8Array(31);

  crypto.getRandomValues(secretBytes);
  crypto.getRandomValues(nullifierBytes);

  let secret = 0n;
  let nullifier = 0n;

  for (let i = 0; i < 31; i++) {
    secret = (secret << 8n) | BigInt(secretBytes[i]);
    nullifier = (nullifier << 8n) | BigInt(nullifierBytes[i]);
  }

  return {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
  };
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const raw = (hex ?? "").trim();
  const h = raw.startsWith("0x") ? raw.slice(2) : raw;

  if (h.length === 0) return new Uint8Array();

  if (h.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${h.length}`);
  }
  if (!/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error("Invalid hex string");
  }

  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function to32BE(x: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function parseProofBigint(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) throw new Error("Invalid numeric proof field");
    return BigInt(Math.trunc(v));
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("0x") || t.startsWith("0X")) return BigInt(t);
    return BigInt(t);
  }
  throw new Error("Unsupported proof field type");
}

function packGroth16ProofTo256Bytes(proof: any): Uint8Array {
  const pa = proof?.pi_a ?? proof?.a;
  const pb = proof?.pi_b ?? proof?.b;
  const pc = proof?.pi_c ?? proof?.c;

  if (!pa || !pb || !pc) throw new Error("Unrecognized Groth16 proof shape (missing a/b/c)");

  const ax = parseProofBigint(pa[0]);
  const ay = parseProofBigint(pa[1]);

  const bx0 = parseProofBigint(pb[0][0]);
  const bx1 = parseProofBigint(pb[0][1]);
  const by0 = parseProofBigint(pb[1][0]);
  const by1 = parseProofBigint(pb[1][1]);

  const cx = parseProofBigint(pc[0]);
  const cy = parseProofBigint(pc[1]);

  const parts = [ax, ay, bx0, bx1, by0, by1, cx, cy];
  const out = new Uint8Array(256);
  let off = 0;
  for (const x of parts) {
    out.set(to32BE(x), off);
    off += 32;
  }
  if (out.length !== 256) throw new Error("Packed proof is not 256 bytes");
  return out;
}

function normalizeProofDataToHex256(proofData: unknown): string {
  if (proofData == null) throw new Error("Missing proofData");

  // If relayer returns a proof object (or JSON string), pack it.
  if (typeof proofData === "object") {
    const packed = packGroth16ProofTo256Bytes(proofData as any);
    return bytesToHex(packed);
  }

  if (typeof proofData !== "string") {
    throw new Error(`Unsupported proofData type: ${typeof proofData}`);
  }

  const t = proofData.trim();
  if (t.length === 0) throw new Error("Empty proofData");

  // JSON string -> pack
  if (t.startsWith("{") || t.startsWith("[")) {
    const parsed = JSON.parse(t);
    const packed = packGroth16ProofTo256Bytes(parsed);
    return bytesToHex(packed);
  }

  // Hex string -> validate length
  const hex = t.startsWith("0x") ? t.slice(2) : t;
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 256) {
      throw new Error(`Invalid proof hex length: ${hex.length} chars (${bytes.length} bytes), expected 512 chars (256 bytes)`);
    }
    return bytesToHex(bytes);
  }

  // Base64 -> decode and validate
  const bytes = base64ToBytes(t);
  if (bytes.length !== 256) {
    throw new Error(`Invalid proof base64 decoded length: ${bytes.length} bytes, expected 256`);
  }
  return bytesToHex(bytes);
}


// =============================================================================
// HIGH-LEVEL CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a new note for deposit
 */
export async function createDepositNote(
  mint: string,
  amount: string
): Promise<{
  secret: string;
  nullifier: string;
  commitment: string;
  commitmentHex: string;
  nullifierHash: string;
  assetId: string;
  assetIdHex: string;
  proofData: string;
  proofTimeMs: number;
}> {
  devLog('[RelayerAPI] Creating deposit note...');

  // Step 1: Generate random secrets (client-side)
  const { secret, nullifier } = generateSecrets();
  devLog('[RelayerAPI] Generated secrets');

  // Step 2: Compute asset ID
  const assetIdResult = await computeAssetId(mint);
  devLog('[RelayerAPI] Computed asset ID');

  // Step 3: Generate commitment
  const commitmentResult = await generateCommitment(
    secret,
    nullifier,
    amount,
    assetIdResult.assetId
  );
  devLog('[RelayerAPI] Generated commitment');

  // Step 4: Generate deposit proof
  const proofResult = await generateDepositProof(
    secret,
    nullifier,
    commitmentResult.commitment,
    amount,
    assetIdResult.assetId
  );
  devLog('[RelayerAPI] Generated deposit proof');

  return {
    secret,
    nullifier,
    commitment: commitmentResult.commitment,
    commitmentHex: commitmentResult.commitmentHex,
    nullifierHash: commitmentResult.nullifierHash,
    assetId: assetIdResult.assetId,
    assetIdHex: assetIdResult.assetIdHex,
    proofData: proofResult.proofData,
    proofTimeMs: proofResult.proofTimeMs,
  };
}

/**
 * Prepare withdrawal with proof generation
 */
export async function prepareWithdrawal(
  note: {
    secret: string;
    nullifier: string;
    amount: string;
    assetId: string;
    nullifierHash: string;
  },
  recipient: string,
  relayer: string,
  leafIndex: number,
  withdrawAmount?: string
): Promise<{
  proofData: string;
  merkleRoot: string;
  nullifierHash: string;
  fee: string;
  netAmount: string;
  proofTimeMs: number;
  changeNote?: { secret: string; nullifier: string; amount: string; assetId: string; commitment: string } | null;
}> {
  devLog('[RelayerAPI] Preparing withdrawal...');

  // Step 1: Get merkle proof
  const merkleProof = await getMerkleProof(leafIndex);
  devLog('[RelayerAPI] Got merkle proof');

  // Step 2: Get fee quote (based on actual withdrawal amount)
  const effectiveAmount = withdrawAmount || note.amount;
  const quote = await getWithdrawQuote(effectiveAmount);
  devLog('[RelayerAPI] Got fee quote:', quote);

  // Step 3: Convert pubkeys to scalars
  // Relayer computes scalars server-side now
  // (scalars computed from base58 pubkeys on server)
  devLog('[RelayerAPI] Sending base58 pubkeys to relayer');

  // Step 4: Generate withdraw proof
  const proofResult = await generateWithdrawProof({
    merkleRoot: merkleProof.merkleRoot,
    nullifierHash: note.nullifierHash,
    relayerFee: quote.fee,
    assetId: note.assetId,
    amount: effectiveAmount,
    noteAmount: note.amount,
    relayer: relayer,       // Send base58 pubkey, relayer computes scalar
    recipient: recipient,  // Send base58 pubkey, relayer computes scalar
    publicDataHash: '0',
    nullifier: note.nullifier,
    secret: note.secret,
    leafIndex,
    merklePath: merkleProof.pathElements,
    merklePathIndices: merkleProof.pathIndices,
  });
  devLog('[RelayerAPI] Generated withdraw proof');

  return {
    proofData: proofResult.proofData,
    merkleRoot: merkleProof.merkleRoot,
    nullifierHash: proofResult.nullifierHash || note.nullifierHash,
    relayerFee: proofResult.relayerFee || quote.fee,
    assetId: proofResult.assetId || note.assetId,
    changeCommitment: proofResult.changeCommitment || "0",
    fee: quote.fee,
    netAmount: quote.netAmount,
    changeNote: proofResult.changeNote || null,
    proofTimeMs: proofResult.proofTimeMs,
  };
}

/**
 * Build unsigned deposit transaction
 */
export async function buildDepositTx(params: {
  amount: string;
  commitment: string;
  assetIdHex: string;
  proofData: string;
  depositorPubkey: string;
  mint: string;
  relayerFee?: string;
  assetId?: string;
  changeCommitment?: string;
}): Promise<{
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const result = await apiRequest<{
    success: true;
    transaction: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }>('/build-deposit-tx', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  return {
    transaction: result.transaction,
    blockhash: result.blockhash,
    lastValidBlockHeight: result.lastValidBlockHeight,
  };
}

// =============================================================================
// CONNECTION MANAGEMENT EXPORTS
// =============================================================================

/**
 * Subscribe to connection health changes
 */
export function onConnectionHealthChange(callback: (healthy: boolean) => void): () => void {
  return connectionManager.onHealthChange(callback);
}

/**
 * Check if connection is currently healthy
 */
export function isConnectionHealthy(): boolean {
  return connectionManager.isHealthy();
}

/**
 * Manually trigger a health check
 */
export async function performHealthCheck(): Promise<boolean> {
  return connectionManager.checkHealth();
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default {
  // Core functions
  generateCommitment,
  computeAssetId,
  generateDepositProof,
  generateWithdrawProof,
  getPoolState,
  getMerkleProof,
  insertMerkleLeaf,
  getWithdrawQuote,
  submitWithdrawal,
  poseidonHash,
  pubkeyToScalar,
  checkHealth,
  getRelayerStatus,
  getNoteStatus,

  // Helpers
  generateSecrets,
  hexToBytes,
  bytesToHex,

  // High-level
  createDepositNote,
  prepareWithdrawal,
  buildDepositTx,

  // Connection management
  onConnectionHealthChange,
  isConnectionHealthy,
  performHealthCheck,

  // Error class
  RelayerApiError,
};