"use client";

import { groth16 } from "snarkjs";
import {
  computeCommitment,
  computeNullifierHash,
  poseidonHash,
  poseidonHash2,
  pubkeyToScalar,
  initializePoseidon,
  formatProofForOnChain,
  MERKLE_TREE_DEPTH,
} from "./crypto";

const CIRCUIT_BASE = "/circuits";

export interface DepositProofInput {
  secret: bigint;
  nullifier: bigint;
  commitment: bigint;
  amount: bigint;
  assetId: bigint;
}

export interface WithdrawProofInput {
  secret: bigint;
  nullifier: bigint;
  amount: bigint;
  assetId: bigint;
  leafIndex: bigint;
  merkleRoot: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  recipient: bigint;
  relayer: bigint;
  relayerFee: bigint;
}

export async function generateDepositProof(
  input: DepositProofInput
): Promise<{ proof: any; publicSignals: bigint[] }> {
  await initializePoseidon();
  const wasmPath = `${CIRCUIT_BASE}/deposit/deposit.wasm`;
  const zkeyPath = `${CIRCUIT_BASE}/deposit/deposit.zkey`;

  const witness = {
    secret: input.secret.toString(),
    nullifier: input.nullifier.toString(),
    commitment: input.commitment.toString(),
    amount: input.amount.toString(),
    asset_id: input.assetId.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(witness, wasmPath, zkeyPath);
  return { proof, publicSignals: publicSignals.map((s) => BigInt(s)) };
}

export async function generateWithdrawProof(
  input: WithdrawProofInput
): Promise<{ proof: any; publicSignals: bigint[] }> {
  await initializePoseidon();
  const wasmPath = `${CIRCUIT_BASE}/withdraw/withdraw.wasm`;
  const zkeyPath = `${CIRCUIT_BASE}/withdraw/withdraw.zkey`;

  const witness = {
    secret: input.secret.toString(),
    nullifier: input.nullifier.toString(),
    amount: input.amount.toString(),
    asset_id: input.assetId.toString(),
    leaf_index: input.leafIndex.toString(),
    merkle_root: input.merkleRoot.toString(),
    merkle_path: input.pathElements.map((e) => e.toString()),
    merkle_path_indices: input.pathIndices,
    recipient: input.recipient.toString(),
    relayer: input.relayer.toString(),
    relayer_fee: input.relayerFee.toString(),
    public_data_hash: "0",
  };

  const { proof, publicSignals } = await groth16.fullProve(witness, wasmPath, zkeyPath);
  return { proof, publicSignals: publicSignals.map((s) => BigInt(s)) };
}

export { computeCommitment, computeNullifierHash, poseidonHash, poseidonHash2, pubkeyToScalar, formatProofForOnChain, MERKLE_TREE_DEPTH };
