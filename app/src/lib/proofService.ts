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
  nullifierHash: bigint;
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

export interface WithdrawV2ProofInput {
  // Input note (being spent)
  secret: bigint;
  nullifier: bigint;
  inputAmount: bigint; // full note amount
  assetId: bigint;
  leafIndex: bigint;
  merkleRoot: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  // Withdrawal output
  withdrawAmount: bigint;
  recipient: bigint;
  relayer: bigint;
  relayerFee: bigint;
  // Change output (stays in pool)
  changeSecret: bigint;
  changeNullifier: bigint;
  changeAmount: bigint;
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
    nullifier_hash: input.nullifierHash.toString(),
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

export async function generateWithdrawV2Proof(
  input: WithdrawV2ProofInput
): Promise<{ proof: any; publicSignals: bigint[] }> {
  await initializePoseidon();
  const wasmPath = `${CIRCUIT_BASE}/withdraw_v2/withdraw_v2.wasm`;
  const zkeyPath = `${CIRCUIT_BASE}/withdraw_v2/withdraw_v2.zkey`;

  const nullifierHash0 = computeNullifierHash(input.nullifier, input.secret, Number(input.leafIndex));
  const changeCommitment = computeCommitment(input.changeSecret, input.changeNullifier, input.changeAmount, input.assetId);

  const witness = {
    // Public inputs
    schema_version: "2",
    merkle_root: input.merkleRoot.toString(),
    asset_id: input.assetId.toString(),
    nullifier_hash_0: nullifierHash0.toString(),
    nullifier_hash_1: "0",
    change_commitment: changeCommitment.toString(),
    recipient: input.recipient.toString(),
    amount: input.withdrawAmount.toString(),
    relayer: input.relayer.toString(),
    relayer_fee: input.relayerFee.toString(),
    public_data_hash: "0",
    reserved_0: "0",
    // Private inputs
    input_secret: input.secret.toString(),
    input_nullifier: input.nullifier.toString(),
    input_amount: input.inputAmount.toString(),
    leaf_index: input.leafIndex.toString(),
    merkle_path: input.pathElements.map((e) => e.toString()),
    merkle_path_indices: input.pathIndices,
    change_secret: input.changeSecret.toString(),
    change_nullifier: input.changeNullifier.toString(),
    change_amount: input.changeAmount.toString(),
  };

  const { proof, publicSignals } = await groth16.fullProve(witness, wasmPath, zkeyPath);
  return { proof, publicSignals: publicSignals.map((s) => BigInt(s)) };
}

export { computeCommitment, computeNullifierHash, poseidonHash, poseidonHash2, pubkeyToScalar, formatProofForOnChain, MERKLE_TREE_DEPTH };
