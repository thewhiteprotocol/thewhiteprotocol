/**
 * Compute Unit Measurement Test for Bridge Instructions
 *
 * This test measures the compute unit consumption of:
 * 1. `bridge_withdraw` (proof verification + token transfer + nullifier spend)
 * 2. `bridge_mint` (token transfer + pending buffer insertion)
 *
 * Prerequisites:
 * - Local validator or devnet deployment with pool initialized
 * - Verification key uploaded for Withdraw proof type
 * - Asset vault registered
 * - BridgeConfig initialized with this program's Store PDA as authority
 *
 * Usage:
 *   anchor test --skip-build tests/cu-measure-bridge.ts
 *
 * The test uses `simulateTransaction` to get CU consumption without
 * actually executing state-changing transactions.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { WhiteProtocol } from "../target/types/white_protocol";

// Use the same provider setup as other tests
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.WhiteProtocol as Program<WhiteProtocol>;
const connection = provider.connection;

/**
 * Simulate a transaction and return compute unit consumption.
 */
async function simulateCU(
  ixs: TransactionInstruction[],
  signers: anchor.web3.Signer[]
): Promise<number | null> {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...ixs
  );
  tx.feePayer = provider.wallet.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);

  const simulation = await connection.simulateTransaction(tx, {
    replaceRecentBlockhash: true,
    commitment: "processed",
  });

  if (simulation.value.err) {
    console.error("Simulation failed:", simulation.value.err);
    return null;
  }

  return simulation.value.unitsConsumed ?? null;
}

/**
 * Measure CU for bridge_withdraw.
 *
 * NOTE: This is a template. In practice you need:
 * - A valid Groth16 proof
 * - A known merkle root
 * - An unspent nullifier
 * - The bridge authority (Store PDA) must sign
 */
async function measureBridgeWithdraw() {
  console.log("\n=== Measuring bridge_withdraw CU ===");

  // TODO: Replace with actual test accounts
  const poolConfig = PublicKey.default;
  const merkleTree = PublicKey.default;
  const vkAccount = PublicKey.default;
  const assetVault = PublicKey.default;
  const vaultTokenAccount = PublicKey.default;
  const recipientTokenAccount = PublicKey.default;
  const bridgeAuthority = provider.wallet.publicKey; // In prod: Store PDA

  // Dummy proof (256 bytes)
  const proofData = Buffer.alloc(256, 0);
  const merkleRoot = Buffer.alloc(32, 0);
  const nullifierHash = Buffer.alloc(32, 1);
  const recipient = provider.wallet.publicKey;
  const amount = new anchor.BN(1_000_000);
  const assetId = Buffer.alloc(32, 2);
  const publicDataHash = Buffer.alloc(32, 3);

  const ix = await program.methods
    .bridgeWithdraw(
      Array.from(proofData),
      Array.from(merkleRoot),
      Array.from(nullifierHash),
      recipient,
      amount,
      Array.from(assetId),
      Array.from(publicDataHash)
    )
    .accounts({
      bridgeAuthority,
      bridgeConfig: PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_config"), poolConfig.toBuffer()],
        program.programId
      )[0],
      poolConfig,
      merkleTree,
      vkAccount,
      assetVault,
      vaultTokenAccount,
      recipientTokenAccount,
      spentNullifier: PublicKey.findProgramAddressSync(
        [Buffer.from("spent_nullifier"), poolConfig.toBuffer(), nullifierHash],
        program.programId
      )[0],
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .instruction();

  const cu = await simulateCU([ix], []);
  console.log(`bridge_withdraw CU consumed: ${cu ?? "FAILED"}`);
  return cu;
}

/**
 * Measure CU for bridge_mint.
 *
 * NOTE: This is a template. In practice you need:
 * - A funded bridge token account
 * - BridgeConfig initialized
 */
async function measureBridgeMint() {
  console.log("\n=== Measuring bridge_mint CU ===");

  const poolConfig = PublicKey.default;
  const merkleTree = PublicKey.default;
  const pendingBuffer = PublicKey.default;
  const assetVault = PublicKey.default;
  const vaultTokenAccount = PublicKey.default;
  const bridgeTokenAccount = PublicKey.default;
  const mint = PublicKey.default;
  const bridgeAuthority = provider.wallet.publicKey;

  const commitment = Buffer.alloc(32, 4);
  const assetId = Buffer.alloc(32, 2);
  const amount = new anchor.BN(1_000_000);

  const ix = await program.methods
    .bridgeMint(amount, Array.from(commitment), Array.from(assetId))
    .accounts({
      bridgeAuthority,
      bridgeConfig: PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_config"), poolConfig.toBuffer()],
        program.programId
      )[0],
      poolConfig,
      merkleTree,
      pendingBuffer,
      assetVault,
      vaultTokenAccount,
      bridgeTokenAccount,
      mint,
      commitmentIndex: PublicKey.findProgramAddressSync(
        [Buffer.from("commitment"), poolConfig.toBuffer(), commitment],
        program.programId
      )[0],
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .instruction();

  const cu = await simulateCU([ix], []);
  console.log(`bridge_mint CU consumed: ${cu ?? "FAILED"}`);
  return cu;
}

async function main() {
  console.log("White Protocol Bridge CU Measurement");
  console.log("=====================================");
  console.log(`Program ID: ${program.programId}`);
  console.log(`RPC: ${connection.rpcEndpoint}`);

  await measureBridgeWithdraw();
  await measureBridgeMint();

  console.log("\n=== Expected CU Budget ===");
  console.log("Solana max CU per tx: 1,400,000");
  console.log("Typical Groth16 verify: ~300,000–500,000 CU");
  console.log("Token transfer: ~4,000 CU");
  console.log("Merkle root check: ~10,000 CU");
  console.log("Pending buffer insertion: ~20,000–50,000 CU");
  console.log(" bridge_withdraw estimated total: ~400,000–700,000 CU");
  console.log(" bridge_mint estimated total: ~50,000–100,000 CU");
  console.log("\nIf bridge_withdraw + LZ CPI exceeds limit, split into:");
  console.log("  1. User calls bridge_withdraw (proof verification)");
  console.log("  2. Relayer calls bridge_out (LZ send) separately");
}

main().catch(console.error);
