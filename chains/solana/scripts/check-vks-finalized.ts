import * as anchor from "@coral-xyz/anchor";
import fs from "fs";

const POOL_CONFIG = new anchor.web3.PublicKey(process.env.POOL_CONFIG || "J92qBrNomkSQ6tjmjbh7rVk2T8R6e6yxkGbB7jQirRRX");
const PROGRAM_ID = new anchor.web3.PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

function vkPda(seed: string): anchor.web3.PublicKey {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(seed), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

const VKS = [
  { name: "deposit",      seed: "vk_deposit",      expectedIc: 4 },
  { name: "withdraw",     seed: "vk_withdraw",     expectedIc: 9 },
  { name: "merkle_batch", seed: "vk_merkle_batch", expectedIc: 6 },
];

(async () => {
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const coder = new anchor.BorshAccountsCoder(idl);

  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");

  for (const vk of VKS) {
    const addr = vkPda(vk.seed);

    const info = await connection.getAccountInfo(addr, "confirmed");
    if (!info?.data) throw new Error(`${vk.name}: missing account ${addr.toBase58()}`);

    const acc: any = coder.decode("VerificationKeyAccountV2", info.data);

    const pool = acc.pool?.toBase58?.() ?? String(acc.pool);
    const icLen = Number(acc.vk_ic_len);
    const icVecLen = Array.isArray(acc.vk_ic) ? acc.vk_ic.length : -1;

    const okPool = pool === POOL_CONFIG.toBase58();
    const okIc = icLen === vk.expectedIc && icVecLen === vk.expectedIc;

    console.log(
      vk.name,
      addr.toBase58(),
      "poolOK=",
      okPool,
      "initialized=",
      acc.is_initialized,
      "locked=",
      acc.is_locked,
      "vk_ic_len=",
      icLen,
      "vk_ic_vec_len=",
      icVecLen,
      "IC_OK=",
      okIc
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
