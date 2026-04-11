import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WhiteProtocol } from "../target/types/white_protocol";
import { ProofType } from "../sdk/src/types";
import { 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { assert } from "chai";
import * as fs from "fs";
import { groth16 } from "snarkjs";
import { keccak256 } from "js-sha3";

// Import SDK functions
import { 
  findPoolConfigPda,
  findMerkleTreePda,
  findAssetVaultPda,
  findVerificationKeyPda,
  createNote,
} from "../sdk/src";

// Compute asset ID matching on-chain logic
function computeAssetId(mint: PublicKey): Uint8Array {
  const prefix = Buffer.from('white:asset_id:v1');
  const mintBytes = mint.toBuffer();
  const input = Buffer.concat([prefix, mintBytes]);
  const hash = keccak256.arrayBuffer(input);
  const hashBytes = new Uint8Array(hash);
  const out = new Uint8Array(32);
  out[0] = 0;
  out.set(hashBytes.slice(0, 31), 1);
  return out;
}

// Convert 32-byte array to BigInt (for circuit input)
function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '0x';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return BigInt(hex);
}

describe("Deposit & Withdraw Integration", () => {
  const authorityKeypairPath = process.env.HOME + "/.config/solana/test-authority.json";
  const authorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(authorityKeypairPath, "utf-8")))
  );
  
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.WhiteProtocol as Program<WhiteProtocol>;
  const authority = authorityKeypair;

  let poolConfig: PublicKey;
  let merkleTree: PublicKey;
  let assetVault: PublicKey;
  let vaultTokenAccount: PublicKey;
  let depositVk: PublicKey;
  let relayerRegistry: PublicKey;
  let complianceConfig: PublicKey;
  
  const WRAPPED_SOL = NATIVE_MINT;
  let assetId: Uint8Array;
  let assetIdBigInt: bigint;

  before("Initialize Pool & Setup", async () => {
    console.log("Authority:", authority.publicKey.toString());
    console.log("Program ID:", program.programId.toString());
    
    const balance = await provider.connection.getBalance(authority.publicKey);
    console.log("Authority balance:", balance / LAMPORTS_PER_SOL, "SOL");
    
    [poolConfig] = findPoolConfigPda(program.programId, authority.publicKey);
    [merkleTree] = findMerkleTreePda(program.programId, poolConfig);
    
    [relayerRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("relayer_registry"), poolConfig.toBuffer()],
      program.programId
    );
    [complianceConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("compliance"), poolConfig.toBuffer()],
      program.programId
    );
    
    // Compute asset ID for wSOL
    assetId = computeAssetId(WRAPPED_SOL);
    assetIdBigInt = bytesToBigInt(assetId);
    console.log("Asset ID (hex):", Buffer.from(assetId).toString('hex'));
    console.log("Asset ID (bigint):", assetIdBigInt.toString());
    
    [assetVault] = findAssetVaultPda(program.programId, poolConfig, assetId);
    
    [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token"), assetVault.toBuffer()],
      program.programId
    );
    
    [depositVk] = findVerificationKeyPda(program.programId, poolConfig, ProofType.Deposit);

    console.log("Pool Config:", poolConfig.toString());
    console.log("Merkle Tree:", merkleTree.toString());
    console.log("Asset Vault:", assetVault.toString());
    console.log("Deposit VK:", depositVk.toString());
    
    // Check if pool exists
    const poolInfo = await provider.connection.getAccountInfo(poolConfig);
    if (!poolInfo) {
      console.log("⚠️  Pool not found. Initializing new pool...");
      const tx = await program.methods
        .initializePoolV2(20, 100)
        .accounts({
          authority: authority.publicKey,
          poolConfig,
          merkleTree,
          relayerRegistry,
          complianceConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log("✅ Pool initialized:", tx);
    } else {
      console.log("✅ Pool already exists");
    }
    
    // Check if asset vault exists
    const vaultInfo = await provider.connection.getAccountInfo(assetVault);
    if (!vaultInfo) {
      console.log("⚠️  Asset vault not found. Registering wSOL asset...");
      const tx = await program.methods
        .registerAsset(Array.from(assetId) as any)
        .accounts({
          authority: authority.publicKey,
          poolConfig,
          mint: WRAPPED_SOL,
          assetVault,
          vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      console.log("✅ Asset registered:", tx);
    } else {
      console.log("✅ Asset vault already exists");
    }
    
    // Check if deposit VK is set
    const vkInfo = await provider.connection.getAccountInfo(depositVk);
    if (!vkInfo) {
      console.log("⚠️  Deposit VK not found. Setting verification key...");
      
      const vkJson = JSON.parse(fs.readFileSync("./circuits/build/deposit_vk.json", "utf-8"));
      
      function pointToBytes(point: string[]): number[] {
        const x = BigInt(point[0]);
        const y = BigInt(point[1]);
        const xBytes = x.toString(16).padStart(64, '0');
        const yBytes = y.toString(16).padStart(64, '0');
        return [...Buffer.from(xBytes, 'hex'), ...Buffer.from(yBytes, 'hex')];
      }
      
      function g2PointToBytes(point: string[][]): number[] {
        const x0 = BigInt(point[0][0]);
        const x1 = BigInt(point[0][1]);
        const y0 = BigInt(point[1][0]);
        const y1 = BigInt(point[1][1]);
        return [
          ...Buffer.from(x1.toString(16).padStart(64, '0'), 'hex'), // x1 FIRST (imaginary)
          ...Buffer.from(x0.toString(16).padStart(64, '0'), 'hex'), // x0 (real)
          ...Buffer.from(y1.toString(16).padStart(64, '0'), 'hex'), // y1 FIRST (imaginary)
          ...Buffer.from(y0.toString(16).padStart(64, '0'), 'hex'), // y0 (real)
        ];
      }
      
      const alphaG1 = pointToBytes(vkJson.vk_alpha_1);
      const betaG2 = g2PointToBytes(vkJson.vk_beta_2);
      const gammaG2 = g2PointToBytes(vkJson.vk_gamma_2);
      const deltaG2 = g2PointToBytes(vkJson.vk_delta_2);
      
      const ic: number[][] = vkJson.IC.map((p: string[]) => pointToBytes(p));
      
      const tx = await program.methods
        .setVerificationKeyV2(
          { deposit: {} },
          Buffer.from(alphaG1),
          Buffer.from(betaG2),
          Buffer.from(gammaG2),
          Buffer.from(deltaG2),
          ic.map(arr => Buffer.from(arr))
        )
        .accounts({
          authority: authority.publicKey,
          poolConfig,
          vkAccount: depositVk,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
      
      console.log("✅ Deposit VK set:", tx);
    } else {
      console.log("✅ Deposit VK already exists");
    }
  });

  it("Deposits wSOL into shielded pool", async function() {
    const depositAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
    
    // Generate note with ACTUAL asset_id (must match what on-chain expects)
    const note = await createNote(BigInt(depositAmount.toString()), assetIdBigInt);
    
    // Convert commitment to 32 bytes
    const commitmentBytes = new Uint8Array(32);
    const commitmentHex = note.commitment.toString(16).padStart(64, '0');
    const commitmentBuffer = Buffer.from(commitmentHex, 'hex');
    commitmentBytes.set(commitmentBuffer);
    
    console.log("Note commitment:", note.commitment.toString());
    console.log("Commitment bytes (hex):", Buffer.from(commitmentBytes).toString('hex'));

    const wasmPath = "./circuits/build/deposit_js/deposit.wasm";
    const zkeyPath = "./circuits/build/deposit.zkey";
    
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
      console.warn("⚠️  Circuit files not found. Skipping proof generation.");
      this.skip();
      return;
    }

    // Generate ZK proof with ACTUAL asset_id
    const proofInput = {
      secret: note.secret.toString(),
      nullifier: note.nullifier.toString(),
      amount: note.amount.toString(),
      asset_id: assetIdBigInt.toString(), // Use actual asset_id!
      commitment: note.commitment.toString(),
    };

    console.log("Generating ZK proof with asset_id:", assetIdBigInt.toString());
    const { proof, publicSignals } = await groth16.fullProve(
      proofInput,
      wasmPath,
      zkeyPath
    );
    console.log("✅ Proof generated");
    console.log("Public signals:", publicSignals);

    // Format proof for on-chain verification (256 bytes)
    const proofData = new Uint8Array(256);
    
    function bigIntToBytes32(bi: bigint): Uint8Array {
      const hex = bi.toString(16).padStart(64, '0');
      return Uint8Array.from(Buffer.from(hex, 'hex'));
    }
    
    const proofA = proof.pi_a.slice(0, 2).map((x: string) => BigInt(x));
    const proofB = proof.pi_b.slice(0, 2).map((p: string[]) => p.map((x: string) => BigInt(x)));
    const proofC = proof.pi_c.slice(0, 2).map((x: string) => BigInt(x));
    
    // Pack A (64 bytes)
    proofData.set(bigIntToBytes32(proofA[0]), 0);
    proofData.set(bigIntToBytes32(proofA[1]), 32);
    // Pack B (128 bytes) - x1 FIRST (imaginary), then x0 (real)
    proofData.set(bigIntToBytes32(proofB[0][1]), 64);   // x_imag
    proofData.set(bigIntToBytes32(proofB[0][0]), 96);   // x_real
    proofData.set(bigIntToBytes32(proofB[1][1]), 128);  // y_imag
    proofData.set(bigIntToBytes32(proofB[1][0]), 160);  // y_real
    // Pack C (64 bytes)
    proofData.set(bigIntToBytes32(proofC[0]), 192);
    proofData.set(bigIntToBytes32(proofC[1]), 224);

    const userTokenAccount = getAssociatedTokenAddressSync(
      WRAPPED_SOL,
      authority.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    console.log("User token account:", userTokenAccount.toString());
    console.log("Vault token account:", vaultTokenAccount.toString());

    const preInstructions = [];
    
    const userAtaInfo = await provider.connection.getAccountInfo(userTokenAccount);
    if (!userAtaInfo) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          userTokenAccount,
          authority.publicKey,
          WRAPPED_SOL
        )
      );
    }
    
    preInstructions.push(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: userTokenAccount,
        lamports: depositAmount.toNumber() + 10000,
      }),
      createSyncNativeInstruction(userTokenAccount)
    );

    console.log("Submitting deposit transaction...");
    
    const tx = await program.methods
      .depositMasp(
        depositAmount,
        Array.from(commitmentBytes),
        Array.from(assetId),
        Buffer.from(proofData),
        null
      )
      .accounts({
        depositor: authority.publicKey,
        poolConfig,
        authority: authority.publicKey,
        merkleTree,
        assetVault,
        vaultTokenAccount,
        userTokenAccount,
        mint: WRAPPED_SOL,
        depositVk,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .signers([authority])
      .rpc();

    console.log("✅ Deposit TX:", tx);

    const treeAccount = await program.account.merkleTreeV2.fetch(merkleTree);
    assert(treeAccount.nextLeafIndex > 0, "Merkle tree should have leaves");
    
    console.log("✅ Deposit verified! Leaf index:", treeAccount.nextLeafIndex);
  });

  it("Withdraws from shielded pool with ZK proof", async function() {
    console.log("⚠️  Withdraw test requires merkle proof from relayer");
    this.skip();
  });
});
