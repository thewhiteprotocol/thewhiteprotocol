/**
 * Chain-agnostic proof generation and verification using snarkjs
 */

import { groth16, Groth16Proof } from 'snarkjs';
import { ProofType, CIRCUIT_PATHS } from './constants.js';
import { ProofData } from './types.js';
import { formatProofForOnChain, parseProofFromOnChain } from './crypto.js';

export interface CircuitInputs {
  [key: string]: string | string[] | string[][] | number | bigint;
}

/**
 * Generate a Groth16 proof using snarkjs
 */
export async function generateProof(
  proofType: ProofType,
  inputs: Record<string, string | number | bigint | (string | bigint)[] | (string | bigint)[][]>
): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
  const paths = CIRCUIT_PATHS[proofType];
  if (!paths) {
    throw new Error(`Unknown proof type: ${proofType}`);
  }
  
  // Convert all inputs to strings for snarkjs
  const stringInputs: Record<string, any> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      if (Array.isArray(value[0])) {
        // 2D array
        stringInputs[key] = (value as any[][]).map(arr => 
          arr.map(v => BigInt(v).toString())
        );
      } else {
        // 1D array
        stringInputs[key] = (value as any[]).map(v => BigInt(v).toString());
      }
    } else {
      stringInputs[key] = BigInt(value as any).toString();
    }
  }
  
  const { proof, publicSignals } = await groth16.fullProve(
    stringInputs,
    paths.wasm,
    paths.zkey
  );
  
  return { proof, publicSignals };
}

/**
 * Verify a Groth16 proof
 */
export async function verifyProof(
  proofType: ProofType,
  proof: Groth16Proof,
  publicSignals: string[]
): Promise<boolean> {
  const paths = CIRCUIT_PATHS[proofType];
  if (!paths) {
    throw new Error(`Unknown proof type: ${proofType}`);
  }
  
  // Load verification key
  const vkey = await import('fs').then(fs => 
    JSON.parse(fs.readFileSync(paths.vkey, 'utf8'))
  );
  
  return await groth16.verify(vkey, publicSignals, proof);
}

/**
 * Generate and serialize proof for on-chain submission
 */
export async function generateSerializedProof(
  proofType: ProofType,
  inputs: Record<string, string | number | bigint | (string | bigint)[] | (string | bigint)[][]>
): Promise<ProofData> {
  const { proof, publicSignals } = await generateProof(proofType, inputs);
  
  const proofData = formatProofForOnChain(proof);
  const publicInputs = publicSignals.map(s => BigInt(s));
  
  return { proofData, publicInputs };
}

/**
 * Export verification key as Solidity contract
 */
export async function exportSolidityVerifier(
  proofType: ProofType,
  outputPath: string
): Promise<void> {
  const paths = CIRCUIT_PATHS[proofType];
  if (!paths) {
    throw new Error(`Unknown proof type: ${proofType}`);
  }
  
  const fs = await import('fs');
  const verifierCode = await groth16.exportSolidityCallData(
    { pi_a: [], pi_b: [], pi_c: [], protocol: 'groth16', curve: 'bn128' } as any, // Empty proof - just need template
    []
  );
  
  // Generate proper verifier contract
  const template = await groth16.exportSolidityCallData(
    { pi_a: ['0', '0'], pi_b: [['0', '0'], ['0', '0']], pi_c: ['0', '0'], protocol: 'groth16', curve: 'bn128' } as any,
    ['0']
  );
  
  // For now, use snarkjs CLI to generate full verifier
  // This is a placeholder - actual implementation would use snarkjs API
  fs.writeFileSync(outputPath, `// Run: snarkjs zkey export solidityverifier ${paths.zkey} ${outputPath}`);
}

/**
 * Proof generator class for convenience
 */
export class ProofGenerator {
  private circuitCache: Map<ProofType, { wasm: string; zkey: string }> = new Map();
  
  constructor() {
    // Pre-load circuit paths
    for (const [type, paths] of Object.entries(CIRCUIT_PATHS)) {
      this.circuitCache.set(Number(type) as ProofType, {
        wasm: paths.wasm,
        zkey: paths.zkey,
      });
    }
  }
  
  /**
   * Generate deposit proof
   */
  async generateDepositProof(inputs: {
    secret: bigint;
    nullifier: bigint;
    amount: bigint;
    assetId: bigint;
    commitment: bigint;
  }): Promise<ProofData> {
    return generateSerializedProof(ProofType.Deposit, {
      secret: inputs.secret,
      nullifier: inputs.nullifier,
      amount: inputs.amount,
      asset_id: inputs.assetId,
      commitment: inputs.commitment,
    });
  }
  
  /**
   * Generate withdraw proof
   */
  async generateWithdrawProof(inputs: {
    merkleRoot: bigint;
    nullifierHash: bigint;
    assetId: bigint;
    recipient: bigint;
    amount: bigint;
    relayer: bigint;
    relayerFee: bigint;
    publicDataHash: bigint;
    secret: bigint;
    nullifier: bigint;
    leafIndex: number;
    merklePath: bigint[];
    merklePathIndices: number[];
  }): Promise<ProofData> {
    return generateSerializedProof(ProofType.Withdraw, {
      merkle_root: inputs.merkleRoot,
      nullifier_hash: inputs.nullifierHash,
      asset_id: inputs.assetId,
      recipient: inputs.recipient,
      amount: inputs.amount,
      relayer: inputs.relayer,
      relayer_fee: inputs.relayerFee,
      public_data_hash: inputs.publicDataHash,
      secret: inputs.secret,
      nullifier: inputs.nullifier,
      leaf_index: inputs.leafIndex,
      merkle_path: inputs.merklePath,
      merkle_path_indices: inputs.merklePathIndices as unknown as (string | bigint)[],
    });
  }
  
  /**
   * Generate Merkle batch update proof
   */
  async generateMerkleBatchProof(inputs: {
    oldRoot: bigint;
    newRoot: bigint;
    startIndex: number;
    batchSize: number;
    commitmentsHash: bigint;
    commitments: bigint[];
    pathElements: bigint[][];
  }): Promise<ProofData> {
    return generateSerializedProof(ProofType.MerkleBatchUpdate, {
      oldRoot: inputs.oldRoot,
      newRoot: inputs.newRoot,
      startIndex: inputs.startIndex,
      batchSize: inputs.batchSize,
      commitmentsHash: inputs.commitmentsHash,
      commitments: inputs.commitments,
      pathElements: inputs.pathElements,
    });
  }
}

// Re-export for convenience
export { formatProofForOnChain, parseProofFromOnChain };
