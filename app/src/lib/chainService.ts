"use client";

import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { AnchorProvider, Program, BN, Idl } from "@coral-xyz/anchor";
import { baseSepolia } from "wagmi/chains";
import { createPublicClient, http, parseAbi } from "viem";
import { CHAINS } from "@/config/chains";
import {
  SOLANA_PROGRAM_ID,
  SOLANA_POOL_CONFIG,
} from "@/config/solana";
import {
  BASE_PROTOCOL_ADDRESS,
} from "@/config/base";
import { MERKLE_TREE_DEPTH } from "./crypto";
import { IncrementalMerkleTree } from "./merkleTree";
import solanaIdl from "./solana_idl.json";

// ─── Base (EVM) Contract ABI ───
const WHITE_PROTOCOL_ABI = parseAbi([
  "function deposit(bytes memory proof, uint256 commitment, uint256 amount, address token) external payable",
  "function withdraw(bytes memory proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external",
  "function getLastRoot() external view returns (uint256)",
  "function roots(uint256 index) external view returns (uint256)",
  "function currentRootIndex() external view returns (uint256)",
  "function commitmentToPendingIndex(uint256 commitment) external view returns (uint256)",
  "function isSpent(uint256 nullifierHash) external view returns (bool)",
  "function LEVELS() external view returns (uint256)",
  "event Deposit(uint256 indexed commitment, uint256 amount, address indexed asset, uint256 leafIndex)",
  "event BatchSettlement(uint256 indexed startIndex, uint256 batchSize, uint256 newRoot)",
  "event Withdrawal(uint256 indexed nullifierHash, address indexed recipient, address indexed relayer, uint256 amount, uint256 fee)",
] as const);

// ─── Solana Merkle Tree Account Parser ───
interface SolanaMerkleTree {
  pool: PublicKey;
  depth: number;
  nextLeafIndex: number;
  currentRoot: Uint8Array;
  rootHistory: Uint8Array[];
  rootHistoryIndex: number;
  rootHistorySize: number;
  filledSubtrees: Uint8Array[];
  zeros: Uint8Array[];
  totalLeaves: bigint;
  lastInsertionAt: bigint;
  version: number;
}

function parseMerkleTreeAccount(data: Buffer): SolanaMerkleTree {
  let offset = 8; // skip discriminator

  const readPubkey = () => {
    const pk = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    return pk;
  };

  const readU8 = () => data[offset++];
  const readU16 = () => {
    const v = data.readUInt16LE(offset);
    offset += 2;
    return v;
  };
  const readU32 = () => {
    const v = data.readUInt32LE(offset);
    offset += 4;
    return v;
  };
  const readU64 = () => {
    const v = data.readBigUInt64LE(offset);
    offset += 8;
    return v;
  };
  const readBytes32 = () => {
    const buf = data.slice(offset, offset + 32);
    offset += 32;
    return new Uint8Array(buf);
  };
  const readBytes32Vec = () => {
    const len = readU32();
    const arr: Uint8Array[] = [];
    for (let i = 0; i < len; i++) arr.push(readBytes32());
    return arr;
  };

  const pool = readPubkey();
  const depth = readU8();
  const nextLeafIndex = readU32();
  const currentRoot = readBytes32();
  const rootHistory = readBytes32Vec();
  const rootHistoryIndex = readU16();
  const rootHistorySize = readU16();
  const filledSubtrees = readBytes32Vec();
  const zeros = readBytes32Vec();
  const totalLeaves = readU64();
  const lastInsertionAt = readU64();
  const version = readU8();

  return {
    pool,
    depth,
    nextLeafIndex,
    currentRoot,
    rootHistory,
    rootHistoryIndex,
    rootHistorySize,
    filledSubtrees,
    zeros,
    totalLeaves,
    lastInsertionAt,
    version,
  };
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}

function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

// Compute Merkle path from Solana filled_subtrees (best-effort)
function computeSolanaMerklePath(
  tree: SolanaMerkleTree,
  leafIndex: number
): { pathElements: bigint[]; pathIndices: number[] } {
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let currentIndex = leafIndex;

  for (let level = 0; level < tree.depth; level++) {
    const isRightChild = (currentIndex & 1) === 1;
    pathIndices.push(isRightChild ? 1 : 0);

    const sibling = isRightChild
      ? tree.filledSubtrees[level]
      : tree.zeros[level];

    pathElements.push(bytes32ToBigint(sibling));
    currentIndex >>= 1;
  }

  return { pathElements, pathIndices };
}

// ─── Base Chain Service ───
export class BaseChainService {
  private publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(CHAINS.base.rpcUrl),
  });

  async getPoolState(): Promise<{
    currentRoot: bigint;
    currentRootIndex: bigint;
    levels: bigint;
  }> {
    const [currentRoot, currentRootIndex, levels] = await Promise.all([
      this.publicClient.readContract({
        address: BASE_PROTOCOL_ADDRESS,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "getLastRoot",
      }),
      this.publicClient.readContract({
        address: BASE_PROTOCOL_ADDRESS,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "currentRootIndex",
      }),
      this.publicClient.readContract({
        address: BASE_PROTOCOL_ADDRESS,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "LEVELS",
      }),
    ]);
    return { currentRoot, currentRootIndex, levels };
  }

  async isSpent(nullifierHash: bigint): Promise<boolean> {
    return this.publicClient.readContract({
      address: BASE_PROTOCOL_ADDRESS,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "isSpent",
      args: [nullifierHash],
    });
  }

  async getCommitmentPendingIndex(commitment: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: BASE_PROTOCOL_ADDRESS,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "commitmentToPendingIndex",
      args: [commitment],
    });
  }

  async findDepositEvent(commitment: bigint): Promise<{ commitment: bigint; amount: bigint; asset: `0x${string}`; leafIndex: bigint; blockNumber: bigint } | null> {
    const logs = await this.publicClient.getContractEvents({
      address: BASE_PROTOCOL_ADDRESS,
      abi: WHITE_PROTOCOL_ABI,
      eventName: "Deposit",
      args: { commitment },
      fromBlock: 0n,
      toBlock: "latest",
    });
    if (logs.length === 0) return null;
    const log = logs[0] as any;
    return {
      commitment: log.args.commitment as bigint,
      amount: log.args.amount as bigint,
      asset: log.args.asset as `0x${string}`,
      leafIndex: log.args.leafIndex as bigint,
      blockNumber: log.blockNumber as bigint,
    };
  }

  async deposit(
    walletClient: any,
    proof: Uint8Array,
    commitment: bigint,
    amount: bigint,
    tokenAddress: `0x${string}`
  ): Promise<`0x${string}`> {
    const value = tokenAddress === "0x0000000000000000000000000000000000000000" ? amount : 0n;
    const hash = await walletClient.writeContract({
      address: BASE_PROTOCOL_ADDRESS,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "deposit",
      args: [Buffer.from(proof), commitment, amount, tokenAddress],
      value,
    });
    return hash;
  }

  async withdraw(
    walletClient: any,
    proof: Uint8Array,
    nullifierHash: bigint,
    root: bigint,
    recipient: `0x${string}`,
    tokenAddress: `0x${string}`,
    amount: bigint,
    fee: bigint = 0n,
    relayer: `0x${string}` = "0x0000000000000000000000000000000000000000"
  ): Promise<`0x${string}`> {
    const hash = await walletClient.writeContract({
      address: BASE_PROTOCOL_ADDRESS,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "withdraw",
      args: [
        Buffer.from(proof),
        nullifierHash,
        root,
        recipient,
        tokenAddress,
        amount,
        fee,
        relayer,
      ],
    });
    return hash;
  }

  private treeCache: IncrementalMerkleTree | null = null;
  private treeCacheBlock: bigint = 0n;

  async getMerklePath(leafIndex: number): Promise<{
    pathElements: bigint[];
    pathIndices: number[];
  }> {
    const tree = await this.rebuildTree();
    return tree.getPath(leafIndex);
  }

  async rebuildTree(): Promise<IncrementalMerkleTree> {
    // Fetch events and rebuild tree
    const events = await this.getDepositEvents();
    const tree = new IncrementalMerkleTree(Number(MERKLE_TREE_DEPTH));
    await tree.init();

    // Sort by leafIndex to ensure correct order
    const sorted = events.sort((a, b) => Number(a.leafIndex - b.leafIndex));

    // We need to handle gaps if events are sparse (e.g., some indexed).
    // Place commitments at their leafIndex positions.
    for (const ev of sorted) {
      const idx = Number(ev.leafIndex);
      // Extend leaves array with zeros up to the required index
      while (tree.getLeafCount() < idx) {
        tree.insert(0n);
      }
      tree.insert(ev.commitment);
    }

    return tree;
  }

  async getDepositEvents(fromBlock = 0n): Promise<
    Array<{
      commitment: bigint;
      amount: bigint;
      asset: `0x${string}`;
      leafIndex: bigint;
      blockNumber: bigint;
    }>
  > {
    const logs = await this.publicClient.getContractEvents({
      address: BASE_PROTOCOL_ADDRESS,
      abi: WHITE_PROTOCOL_ABI,
      eventName: "Deposit",
      fromBlock,
      toBlock: "latest",
    });
    return logs.map((log: any) => ({
      commitment: log.args.commitment as bigint,
      amount: log.args.amount as bigint,
      asset: log.args.asset as `0x${string}`,
      leafIndex: log.args.leafIndex as bigint,
      blockNumber: log.blockNumber as bigint,
    }));
  }
}

// ─── Solana Chain Service ───
export class SolanaChainService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(CHAINS.solana.rpcUrl, "confirmed");
  }

  getConnection() {
    return this.connection;
  }

  async getPendingDepositsBuffer(): Promise<{ deposits: { commitment: string; timestamp: number }[]; totalPending: number }> {
    const wallet = { publicKey: new PublicKey("11111111111111111111111111111111") };
    const program = this.getProgram(wallet);
    const [pendingBuffer] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );
    try {
      const account: any = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
      return {
        deposits: account.deposits.map((d: any) => ({
          commitment: Array.from(d.commitment as number[])
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
          timestamp: d.timestamp.toNumber?.() || Number(d.timestamp),
        })),
        totalPending: account.totalPending.toNumber?.() || Number(account.totalPending),
      };
    } catch {
      return { deposits: [], totalPending: 0 };
    }
  }

  async isCommitmentPending(commitment: string): Promise<boolean> {
    const buffer = await this.getPendingDepositsBuffer();
    const needle = commitment.toLowerCase().replace(/^0x/, "");
    return buffer.deposits.some((d) => d.commitment.toLowerCase() === needle);
  }

  async findDepositInLogs(commitment: string): Promise<boolean> {
    const sigs = await this.connection.getSignaturesForAddress(SOLANA_PROGRAM_ID, { limit: 100 });
    if (sigs.length === 0) return false;
    const txs = await this.connection.getParsedTransactions(
      sigs.map((s) => s.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 }
    );
    const needle = commitment.toLowerCase().replace(/^0x/, "");
    for (const tx of txs) {
      if (!tx?.meta?.logMessages) continue;
      for (const log of tx.meta.logMessages) {
        if (log.toLowerCase().includes(needle)) return true;
      }
    }
    return false;
  }

  private getProgram(wallet: any): Program {
    const provider = new AnchorProvider(
      this.connection,
      wallet,
      AnchorProvider.defaultOptions()
    );
    return new Program(solanaIdl as Idl, provider);
  }

  async getPoolState(): Promise<{
    currentRoot: bigint;
    nextLeafIndex: number;
    totalLeaves: bigint;
  }> {
    const tree = await this.getMerkleTree();
    return {
      currentRoot: bytes32ToBigint(tree.currentRoot),
      nextLeafIndex: tree.nextLeafIndex,
      totalLeaves: tree.totalLeaves,
    };
  }

  async getMerkleTree(): Promise<SolanaMerkleTree> {
    const merkleTreePda = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle_tree"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    )[0];

    const accountInfo = await this.connection.getAccountInfo(merkleTreePda);
    if (!accountInfo) throw new Error("Merkle tree account not found");
    return parseMerkleTreeAccount(accountInfo.data);
  }

  async getMerklePath(leafIndex: number): Promise<{
    pathElements: bigint[];
    pathIndices: number[];
  }> {
    const tree = await this.getMerkleTree();
    return computeSolanaMerklePath(tree, leafIndex);
  }

  async deposit(
    wallet: any,
    proof: Uint8Array,
    commitment: bigint,
    amount: bigint,
    assetId: Uint8Array,
    mint: PublicKey
  ): Promise<string> {
    const program = this.getProgram(wallet);
    const depositor = wallet.publicKey;

    // Fetch pool config to get the actual authority address
    const poolConfigAccount: any = await (program.account as any).poolConfig.fetch(SOLANA_POOL_CONFIG);
    const poolAuthority = new PublicKey(poolConfigAccount.authority);

    const [merkleTree] = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle_tree"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );
    const [pendingBuffer] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), SOLANA_POOL_CONFIG.toBuffer(), Buffer.from(assetId)],
      SOLANA_PROGRAM_ID
    );
    const [depositVk] = PublicKey.findProgramAddressSync(
      [Buffer.from("vk_deposit"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );

    // Verify asset vault is initialized
    const vaultInfo = await this.connection.getAccountInfo(assetVault);
    if (!vaultInfo) {
      throw new Error(
        `Asset vault not initialized for this token. The pool authority must register ${mint.toBase58()} before deposits are enabled.`
      );
    }

    const vaultTokenAccount = await getAssociatedTokenAddress(mint, assetVault, true);
    const userTokenAccount = await getAssociatedTokenAddress(mint, depositor);

    const preInstructions: any[] = [];
    const postInstructions: any[] = [];

    const userTokenAccountInfo = await this.connection.getAccountInfo(userTokenAccount);
    if (!userTokenAccountInfo) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          depositor,
          userTokenAccount,
          depositor,
          mint
        )
      );
    }

    // Auto-wrap native SOL into wSOL before deposit
    if (mint.equals(NATIVE_MINT)) {
      preInstructions.push(
        SystemProgram.transfer({
          fromPubkey: depositor,
          toPubkey: userTokenAccount,
          lamports: Number(amount),
        })
      );
      preInstructions.push(createSyncNativeInstruction(userTokenAccount));
    }

    const tx = await (program.methods as any)
      .depositMasp(
        new BN(amount.toString()),
        Array.from(bigintToBytes32(commitment)),
        Array.from(assetId),
        Buffer.from(proof),
        null
      )
      .accounts({
        depositor,
        poolConfig: SOLANA_POOL_CONFIG,
        authority: poolAuthority,
        merkleTree,
        pendingBuffer,
        assetVault,
        vaultTokenAccount,
        userTokenAccount,
        mint,
        depositVk,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .rpc();

    return tx;
  }

  async withdraw(
    wallet: any,
    proof: Uint8Array,
    nullifierHash: bigint,
    root: bigint,
    recipient: PublicKey,
    amount: bigint,
    assetId: Uint8Array,
    mint: PublicKey,
    fee: bigint = 0n,
    relayer?: PublicKey
  ): Promise<string> {
    const program = this.getProgram(wallet);
    const signer = wallet.publicKey;
    const actualRelayer = relayer || signer;

    const [merkleTree] = PublicKey.findProgramAddressSync(
      [Buffer.from("merkle_tree"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );
    const [vkAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vk_withdraw"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), SOLANA_POOL_CONFIG.toBuffer(), Buffer.from(assetId)],
      SOLANA_PROGRAM_ID
    );
    const [spentNullifier] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("nullifier"),
        SOLANA_POOL_CONFIG.toBuffer(),
        Buffer.from(bigintToBytes32(nullifierHash)),
      ],
      SOLANA_PROGRAM_ID
    );
    const [relayerRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("relayer_registry"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );
    const [pendingBuffer] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending"), SOLANA_POOL_CONFIG.toBuffer()],
      SOLANA_PROGRAM_ID
    );

    const vaultTokenAccount = await getAssociatedTokenAddress(mint, assetVault, true);
    const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient);
    const relayerTokenAccount = await getAssociatedTokenAddress(mint, actualRelayer);

    const preInstructions: any[] = [];
    const postInstructions: any[] = [];

    // Create recipient ATA if missing
    const recipientTokenAccountInfo = await this.connection.getAccountInfo(recipientTokenAccount);
    if (!recipientTokenAccountInfo) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          signer,
          recipientTokenAccount,
          recipient,
          mint
        )
      );
    }

    // Auto-unwrap wSOL to native SOL after withdrawal by closing the recipient ATA
    if (mint.equals(NATIVE_MINT)) {
      postInstructions.push(
        createCloseAccountInstruction(
          recipientTokenAccount,
          recipient,
          recipient
        )
      );
    }

    const tx = await (program.methods as any)
      .withdrawMasp(
        Buffer.from(proof),
        Array.from(bigintToBytes32(root)),
        Array.from(bigintToBytes32(nullifierHash)),
        recipient,
        new BN(amount.toString()),
        Array.from(assetId),
        new BN(fee.toString())
      )
      .accounts({
        relayer: actualRelayer,
        poolConfig: SOLANA_POOL_CONFIG,
        merkleTree,
        vkAccount,
        assetVault,
        vaultTokenAccount,
        recipientTokenAccount,
        relayerTokenAccount,
        spentNullifier,
        relayerRegistry,
        pendingBuffer,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .rpc();

    return tx;
  }
}

export const baseChainService = new BaseChainService();
export const solanaChainService = new SolanaChainService();
