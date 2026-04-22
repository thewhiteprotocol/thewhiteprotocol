import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

function assertSafeLamports(lamports: bigint): number {
  if (lamports < 0n) throw new Error("lamports < 0");
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (lamports > max) throw new Error("lamports too large for JS number");
  return Number(lamports);
}

export async function ensureAtaAndWrapIfNeeded(params: {
  connection: Connection;
  owner: PublicKey;
  payer: PublicKey;
  mint: PublicKey;
  requiredAmountBaseUnits: bigint;
  sendTransaction: (tx: Transaction, connection: Connection, opts?: any) => Promise<string>;
}): Promise<{ ata: PublicKey; didSendTx: boolean; signature?: string }> {
  const { connection, owner, payer, mint, requiredAmountBaseUnits, sendTransaction } = params;

  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const ataInfo = await connection.getAccountInfo(ata);
  const ixs: any[] = [];

  // Use idempotent instruction so the tx succeeds even if ATA was created between our check and execution
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  const isWsol = mint.equals(NATIVE_MINT);

  if (isWsol) {
    let current = 0n;
    if (ataInfo) {
      try {
        const bal = await connection.getTokenAccountBalance(ata);
        current = BigInt(bal.value.amount);
      } catch {
        current = 0n;
      }
    }

    const need = requiredAmountBaseUnits - current;
    if (need > 0n) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: ata,
          lamports: assertSafeLamports(need),
        })
      );
      ixs.push(createSyncNativeInstruction(ata));
    }
  } else {
    if (ataInfo) {
      const bal = await connection.getTokenAccountBalance(ata);
      const current = BigInt(bal.value.amount);
      if (current < requiredAmountBaseUnits) {
        throw new Error("Insufficient token balance in ATA for deposit amount");
      }
    }
  }

  if (ixs.length === 0) {
    return { ata, didSendTx: false };
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;
  (tx as any).lastValidBlockHeight = lastValidBlockHeight;
  tx.add(...ixs);

  let sig: string;
  try {
    sig = await sendTransaction(tx, connection, { preflightCommitment: "confirmed" });
  } catch (sendErr: any) {
    const msg = sendErr?.message || '';
    if (msg.toLowerCase().includes('already been processed') || msg.toLowerCase().includes('already processed')) {
      // ATA creation/wrap tx likely landed; continue
      sig = '';
    } else {
      throw sendErr;
    }
  }
  if (sig) {
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  }

  return { ata, didSendTx: true, signature: sig };
}
