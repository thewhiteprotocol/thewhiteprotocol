/**
 * Hosted zkey bootstrap for Render/persistent-disk operators.
 *
 * This command verifies durable zkey copies, recreates ephemeral repo symlinks,
 * and prints only non-secret artifact metadata.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  MERKLE_BATCH_ZKEY_SHA256,
  WITHDRAW_ZKEY_SHA256,
} from "./hosted-settle-withdraw-preflight";

const DEFAULT_ARTIFACT_DIR = "/data/circuit-artifacts";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type ZkeyBootstrapCheck = {
  name: "merkle_batch_update" | "withdraw";
  persistentPath: string;
  linkPath: string;
  exists: boolean;
  sha256: string | null;
  expectedSha256: string;
  hashMatches: boolean;
  linkExists: boolean;
  linkIsSymlink: boolean;
  linkRealPath: string | null;
  linkTargetMatches: boolean;
};

export type ZkeyBootstrapResult = {
  ok: boolean;
  readiness: "ready" | "blocked_zkeys";
  artifactDir: string;
  circuitBase: string;
  allowNonPersistentZkeys: boolean;
  merkleZkey: ZkeyBootstrapCheck;
  withdrawZkey: ZkeyBootstrapCheck;
  symlinksRecreated: boolean;
  errors: string[];
  transactionsSubmitted: false;
  proofsGenerated: false;
  secretsPrinted: false;
};

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, "../../..");
}

function isTmpPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const tmp = path.resolve(os.tmpdir());
  return resolved === tmp || resolved.startsWith(tmp + path.sep);
}

function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function expectedMerkleHash(env: Env): string {
  return env.PR012P_EXPECTED_MERKLE_ZKEY_SHA256 || env.PR012G_EXPECTED_MERKLE_ZKEY_SHA256 || MERKLE_BATCH_ZKEY_SHA256;
}

function expectedWithdrawHash(env: Env): string {
  return env.PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256 || env.PR012G_EXPECTED_WITHDRAW_ZKEY_SHA256 || WITHDRAW_ZKEY_SHA256;
}

function checkOne(input: {
  name: ZkeyBootstrapCheck["name"];
  persistentPath: string;
  linkPath: string;
  expectedSha256: string;
}): ZkeyBootstrapCheck {
  const exists = fs.existsSync(input.persistentPath);
  const linkExists = fs.existsSync(input.linkPath);
  const linkLstat = linkExists ? fs.lstatSync(input.linkPath) : null;
  const linkRealPath = linkExists ? fs.realpathSync(input.linkPath) : null;
  const sha256 = sha256File(input.persistentPath);
  return {
    name: input.name,
    persistentPath: input.persistentPath,
    linkPath: input.linkPath,
    exists,
    sha256,
    expectedSha256: input.expectedSha256,
    hashMatches: sha256 === input.expectedSha256,
    linkExists,
    linkIsSymlink: Boolean(linkLstat?.isSymbolicLink()),
    linkRealPath,
    linkTargetMatches: linkRealPath === path.resolve(input.persistentPath),
  };
}

function replaceSymlink(target: string, linkPath: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  if (fs.existsSync(linkPath) || fs.lstatSync(path.dirname(linkPath)).isDirectory()) {
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        throw new Error(`refusing_to_replace_directory:${linkPath}`);
      }
      fs.rmSync(linkPath, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  fs.symlinkSync(target, linkPath);
}

export function bootstrapZkeys(input: {
  env?: Env;
  createSymlinks?: boolean;
} = {}): ZkeyBootstrapResult {
  const env = input.env || process.env;
  const root = repoRoot();
  const artifactDir = path.resolve(env.BRIDGE_CIRCUIT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR);
  const circuitBase = path.resolve(env.PR012G_CIRCUIT_BASE || env.PR012P_CIRCUIT_BASE || path.join(root, "circuits"));
  const allowNonPersistentZkeys =
    env.BRIDGE_ALLOW_NON_PERSISTENT_ZKEYS === "true" || env.PR012P_ALLOW_TMP_FIXTURES === "true";
  const merklePersistent = path.join(artifactDir, "merkle_batch_update/merkle_batch_update.zkey");
  const withdrawPersistent = path.join(artifactDir, "withdraw/withdraw.zkey");
  const merkleLink = path.join(circuitBase, "merkle_batch_update/build/merkle_batch_update.zkey");
  const withdrawLink = path.join(circuitBase, "withdraw/build/withdraw.zkey");
  const merkleExpected = expectedMerkleHash(env);
  const withdrawExpected = expectedWithdrawHash(env);

  let merkleZkey = checkOne({
    name: "merkle_batch_update",
    persistentPath: merklePersistent,
    linkPath: merkleLink,
    expectedSha256: merkleExpected,
  });
  let withdrawZkey = checkOne({
    name: "withdraw",
    persistentPath: withdrawPersistent,
    linkPath: withdrawLink,
    expectedSha256: withdrawExpected,
  });
  const errors: string[] = [];

  if (!allowNonPersistentZkeys && isTmpPath(artifactDir)) errors.push("artifact_dir_tmp_blocked");
  if (!merkleZkey.exists) errors.push("merkle_zkey_missing");
  if (!withdrawZkey.exists) errors.push("withdraw_zkey_missing");
  if (!merkleZkey.hashMatches) errors.push("merkle_zkey_hash_mismatch");
  if (!withdrawZkey.hashMatches) errors.push("withdraw_zkey_hash_mismatch");

  let symlinksRecreated = false;
  if (errors.length === 0 && input.createSymlinks !== false) {
    replaceSymlink(merklePersistent, merkleLink);
    replaceSymlink(withdrawPersistent, withdrawLink);
    symlinksRecreated = true;
    merkleZkey = checkOne({
      name: "merkle_batch_update",
      persistentPath: merklePersistent,
      linkPath: merkleLink,
      expectedSha256: merkleExpected,
    });
    withdrawZkey = checkOne({
      name: "withdraw",
      persistentPath: withdrawPersistent,
      linkPath: withdrawLink,
      expectedSha256: withdrawExpected,
    });
    if (!merkleZkey.linkTargetMatches) errors.push("merkle_zkey_symlink_target_mismatch");
    if (!withdrawZkey.linkTargetMatches) errors.push("withdraw_zkey_symlink_target_mismatch");
  }

  return {
    ok: errors.length === 0,
    readiness: errors.length === 0 ? "ready" : "blocked_zkeys",
    artifactDir,
    circuitBase,
    allowNonPersistentZkeys,
    merkleZkey,
    withdrawZkey,
    symlinksRecreated,
    errors,
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
  };
}

async function main(): Promise<void> {
  const result = bootstrapZkeys();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
