import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

type JsonRecord = Record<string, any>;

export type SpentNullifierDerivation = {
  derived: boolean;
  status: "derived" | "missing_field" | "malformed_note_state";
  spentNullifierPda: string | null;
  leafIndex: number | null;
  error: string | null;
};

let poseidon: any;
let F: any;

async function initPoseidon(): Promise<void> {
  if (poseidon) return;
  const circomlibjs = await import("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((value: bigint) => F.e(value)));
  return BigInt(F.toString(hash));
}

function normalizeScalar(value: unknown): bigint | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
  if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed);
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return BigInt(`0x${trimmed}`);
  return null;
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonRecord;
}

function bytes32Buffer(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

export async function deriveSpentNullifierPdaFromNoteState(input: {
  noteStatePath: string | null | undefined;
  poolConfig: PublicKey;
  programId: PublicKey;
  leafIndex: number | null | undefined;
}): Promise<SpentNullifierDerivation> {
  if (!input.noteStatePath || !fs.existsSync(input.noteStatePath)) {
    return {
      derived: false,
      status: "missing_field",
      spentNullifierPda: null,
      leafIndex: input.leafIndex ?? null,
      error: "note_state_missing",
    };
  }
  let state: JsonRecord;
  try {
    state = readJson(input.noteStatePath);
  } catch {
    return {
      derived: false,
      status: "malformed_note_state",
      spentNullifierPda: null,
      leafIndex: input.leafIndex,
      error: "note_state_parse_failed",
    };
  }

  const secret = normalizeScalar(state.destSecret);
  const nullifier = normalizeScalar(state.destNullifier);
  if (secret === null) {
    return {
      derived: false,
      status: "missing_field",
      spentNullifierPda: null,
      leafIndex: input.leafIndex,
      error: "dest_secret_missing_or_malformed",
    };
  }
  if (nullifier === null) {
    return {
      derived: false,
      status: "missing_field",
      spentNullifierPda: null,
      leafIndex: input.leafIndex,
      error: "dest_nullifier_missing_or_malformed",
    };
  }
  if (input.leafIndex === undefined || input.leafIndex === null || !Number.isInteger(input.leafIndex) || input.leafIndex < 0) {
    return {
      derived: false,
      status: "missing_field",
      spentNullifierPda: null,
      leafIndex: input.leafIndex ?? null,
      error: "leaf_index_missing",
    };
  }

  await initPoseidon();

  const inner = poseidonHash([nullifier, secret]);
  const nullifierHash = poseidonHash([inner, BigInt(input.leafIndex)]);
  const [spentNullifier] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("nullifier"),
      input.poolConfig.toBuffer(),
      bytes32Buffer(nullifierHash),
    ],
    input.programId
  );
  return {
    derived: true,
    status: "derived",
    spentNullifierPda: spentNullifier.toBase58(),
    leafIndex: input.leafIndex,
    error: null,
  };
}
