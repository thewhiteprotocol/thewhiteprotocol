import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import {
  ChainTag,
  deriveStealthSeed,
  generateSolanaMetaAddressFromSeed,
  generateBaseMetaAddressFromSeed,
  generateUniversalMetaAddressFromSeed,
  serializeMetaAddress,
  parseMetaAddress,
  deriveStealthAddressEd25519,
  tryDecryptStealthPaymentEd25519,
  computeStealthPrivateKeyEd25519,
  stealthPubkeyFromPrivateKeyEd25519,
  deriveStealthAddressSecp256k1,
  tryDecryptStealthPaymentSecp256k1,
  computeStealthPrivateKeySecp256k1,
  stealthPubkeyFromPrivateKeySecp256k1,
  scanForPayments,
  getScannerKeyMaterial,
} from "../index";

// ============================================================================
// Test vectors: deterministic seeds for reproducibility
// ============================================================================

const TEST_SEED_1 = new Uint8Array(32).fill(0x01);
const TEST_SEED_2 = new Uint8Array(32).fill(0x02);
const TEST_SEED_3 = new Uint8Array(32).fill(0xab);

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// ============================================================================
// Phase 1: Meta-address generation & serialization round-trip
// ============================================================================

describe("Meta-address generation", () => {
  it("generates deterministic Solana meta-address from seed", () => {
    const { metaAddress, spendKeypair, viewKeypair } =
      generateSolanaMetaAddressFromSeed(TEST_SEED_1);

    expect(metaAddress.chainTag).toBe(ChainTag.Solana);
    expect(metaAddress.spendPubEd25519).toHaveLength(32);
    expect(metaAddress.viewPubEd25519).toHaveLength(32);
    expect(spendKeypair.publicKey).toEqual(metaAddress.spendPubEd25519);
    expect(viewKeypair.publicKey).toEqual(metaAddress.viewPubEd25519);
  });

  it("generates deterministic Base meta-address from seed", () => {
    const { metaAddress, spendKeypair, viewKeypair } =
      generateBaseMetaAddressFromSeed(TEST_SEED_1);

    expect(metaAddress.chainTag).toBe(ChainTag.Base);
    expect(metaAddress.spendPubSecp256k1).toHaveLength(33);
    expect(metaAddress.viewPubSecp256k1).toHaveLength(33);
    expect(spendKeypair.publicKey).toEqual(metaAddress.spendPubSecp256k1);
    expect(viewKeypair.publicKey).toEqual(metaAddress.viewPubSecp256k1);
  });

  it("generates deterministic universal meta-address from seed", () => {
    const { metaAddress, solanaSpendKeypair, baseSpendKeypair } =
      generateUniversalMetaAddressFromSeed(TEST_SEED_1);

    expect(metaAddress.chainTag).toBe(ChainTag.Universal);
    expect(metaAddress.spendPubEd25519).toHaveLength(32);
    expect(metaAddress.viewPubEd25519).toHaveLength(32);
    expect(metaAddress.spendPubSecp256k1).toHaveLength(33);
    expect(metaAddress.viewPubSecp256k1).toHaveLength(33);
    expect(solanaSpendKeypair.publicKey).toEqual(metaAddress.spendPubEd25519);
    expect(baseSpendKeypair.publicKey).toEqual(metaAddress.spendPubSecp256k1);
  });

  it("produces different keys for different seeds", () => {
    const a = generateSolanaMetaAddressFromSeed(TEST_SEED_1);
    const b = generateSolanaMetaAddressFromSeed(TEST_SEED_2);
    expect(hex(a.spendKeypair.privateKey)).not.toBe(hex(b.spendKeypair.privateKey));
    expect(hex(a.viewKeypair.privateKey)).not.toBe(hex(b.viewKeypair.privateKey));
  });
});

describe("Meta-address serialization", () => {
  it("round-trips Solana meta-address", () => {
    const { metaAddress } = generateSolanaMetaAddressFromSeed(TEST_SEED_1);
    const serialized = serializeMetaAddress(metaAddress);
    const parsed = parseMetaAddress(serialized);
    expect(parsed.chainTag).toBe(ChainTag.Solana);
    expect(hex(parsed.spendPubEd25519!)).toBe(hex(metaAddress.spendPubEd25519!));
    expect(hex(parsed.viewPubEd25519!)).toBe(hex(metaAddress.viewPubEd25519!));
  });

  it("round-trips Base meta-address", () => {
    const { metaAddress } = generateBaseMetaAddressFromSeed(TEST_SEED_1);
    const serialized = serializeMetaAddress(metaAddress);
    const parsed = parseMetaAddress(serialized);
    expect(parsed.chainTag).toBe(ChainTag.Base);
    expect(hex(parsed.spendPubSecp256k1!)).toBe(hex(metaAddress.spendPubSecp256k1!));
    expect(hex(parsed.viewPubSecp256k1!)).toBe(hex(metaAddress.viewPubSecp256k1!));
  });

  it("round-trips Universal meta-address", () => {
    const { metaAddress } = generateUniversalMetaAddressFromSeed(TEST_SEED_1);
    const serialized = serializeMetaAddress(metaAddress);
    const parsed = parseMetaAddress(serialized);
    expect(parsed.chainTag).toBe(ChainTag.Universal);
    expect(hex(parsed.spendPubEd25519!)).toBe(hex(metaAddress.spendPubEd25519!));
    expect(hex(parsed.viewPubEd25519!)).toBe(hex(metaAddress.viewPubEd25519!));
    expect(hex(parsed.spendPubSecp256k1!)).toBe(hex(metaAddress.spendPubSecp256k1!));
    expect(hex(parsed.viewPubSecp256k1!)).toBe(hex(metaAddress.viewPubSecp256k1!));
  });

  it("rejects invalid checksum", () => {
    const { metaAddress } = generateSolanaMetaAddressFromSeed(TEST_SEED_1);
    const serialized = serializeMetaAddress(metaAddress);
    // Corrupt a character in the middle
    const corrupted = serialized.slice(0, 10) + "X" + serialized.slice(11);
    expect(() => parseMetaAddress(corrupted)).toThrow("checksum");
  });

  it("rejects invalid base58", () => {
    expect(() => parseMetaAddress("!!!not-base58!!!")).toThrow("base58");
  });
});

// ============================================================================
// Phase 2: Ed25519 stealth address round-trip
// ============================================================================

describe("Ed25519 stealth derivation", () => {
  it("round-trip: derive → detect → private key produces expected public key", () => {
    const { metaAddress, spendKeypair, viewKeypair } =
      generateSolanaMetaAddressFromSeed(TEST_SEED_1);

    // Sender derives stealth address
    const stealth = deriveStealthAddressEd25519(metaAddress);

    // Recipient scans
    const payment = {
      ephemeralPubkey: stealth.ephemeralPubkey,
      destination: stealth.address,
      amount: 1_000_000n,
      assetId: "0",
      chain: "solana" as const,
      blockHeight: 123,
      txHash: "tx1",
    };

    const detected = tryDecryptStealthPaymentEd25519(
      payment,
      viewKeypair.privateKey,
      metaAddress.spendPubEd25519!
    );

    expect(detected).not.toBeNull();
    expect(hex(detected!.stealthPrivateKey)).toBeTruthy();

    // Derive full stealth private key
    const stealthPriv = computeStealthPrivateKeyEd25519(
      spendKeypair.privateKey,
      bytesToBigInt(detected!.stealthPrivateKey)
    );

    // Verify stealth private key produces the expected public key
    const derivedPub = stealthPubkeyFromPrivateKeyEd25519(stealthPriv);
    expect(hex(derivedPub)).toBe(hex(stealth.address));
  });

  it("negative: wrong viewing key does not detect payment", () => {
    const { metaAddress } = generateSolanaMetaAddressFromSeed(TEST_SEED_1);
    const stealth = deriveStealthAddressEd25519(metaAddress);

    const wrongKey = generateSolanaMetaAddressFromSeed(TEST_SEED_2);

    const payment = {
      ephemeralPubkey: stealth.ephemeralPubkey,
      destination: stealth.address,
      amount: 1_000_000n,
      assetId: "0",
      chain: "solana" as const,
      blockHeight: 123,
      txHash: "tx1",
    };

    const detected = tryDecryptStealthPaymentEd25519(
      payment,
      wrongKey.viewKeypair.privateKey,
      metaAddress.spendPubEd25519!
    );

    expect(detected).toBeNull();
  });

  it("scanner detects multiple payments", () => {
    const { metaAddress, spendKeypair, viewKeypair } =
      generateSolanaMetaAddressFromSeed(TEST_SEED_1);

    const stealth1 = deriveStealthAddressEd25519(metaAddress);
    const stealth2 = deriveStealthAddressEd25519(metaAddress);

    const events = [
      {
        ephemeralPubkey: stealth1.ephemeralPubkey,
        destination: stealth1.address,
        txHash: "tx1",
        blockHeight: 100,
      },
      {
        ephemeralPubkey: stealth2.ephemeralPubkey,
        destination: stealth2.address,
        txHash: "tx2",
        blockHeight: 101,
      },
      {
        ephemeralPubkey: new Uint8Array(32).fill(0xff),
        destination: new Uint8Array(32).fill(0xaa),
        txHash: "tx3",
        blockHeight: 102,
      },
    ];

    const keyMaterial = getScannerKeyMaterial(
      metaAddress,
      spendKeypair.privateKey,
      viewKeypair.privateKey
    );
    const detected = scanForPayments(events, keyMaterial);

    expect(detected).toHaveLength(2);
    expect(detected.map((d) => d.txHash)).toContain("tx1");
    expect(detected.map((d) => d.txHash)).toContain("tx2");
  });

  it("deterministic derivation with fixed ephemeral key", () => {
    const { metaAddress } = generateSolanaMetaAddressFromSeed(TEST_SEED_1);
    const ephemeralPriv = new Uint8Array(32).fill(0x42);

    const stealth1 = deriveStealthAddressEd25519(metaAddress, ephemeralPriv);
    const stealth2 = deriveStealthAddressEd25519(metaAddress, ephemeralPriv);

    expect(hex(stealth1.address)).toBe(hex(stealth2.address));
    expect(hex(stealth1.ephemeralPubkey)).toBe(hex(stealth2.ephemeralPubkey));
  });
});

// ============================================================================
// Phase 3: Secp256k1 stealth address round-trip
// ============================================================================

describe("Secp256k1 stealth derivation", () => {
  it("round-trip: derive → detect → private key produces expected public key", () => {
    const { metaAddress, spendKeypair, viewKeypair } =
      generateBaseMetaAddressFromSeed(TEST_SEED_1);

    const stealth = deriveStealthAddressSecp256k1(metaAddress);

    // Ethereum address should be a valid hex address
    expect(stealth.formattedAddress).toMatch(/^0x[0-9a-f]{40}$/);

    const payment = {
      ephemeralPubkey: stealth.ephemeralPubkey,
      destination: stealth.address,
      amount: 1_000_000n,
      assetId: "0",
      chain: "base" as const,
      blockHeight: 123,
      txHash: "tx1",
    };

    const detected = tryDecryptStealthPaymentSecp256k1(
      payment,
      viewKeypair.privateKey,
      metaAddress.spendPubSecp256k1!
    );

    expect(detected).not.toBeNull();

    const stealthPriv = computeStealthPrivateKeySecp256k1(
      spendKeypair.privateKey,
      bytesToBigInt(detected!.stealthPrivateKey)
    );

    const derivedPub = stealthPubkeyFromPrivateKeySecp256k1(stealthPriv);
    expect(hex(derivedPub)).toBe(hex(stealth.address));
  });

  it("negative: wrong viewing key does not detect payment", () => {
    const { metaAddress } = generateBaseMetaAddressFromSeed(TEST_SEED_1);
    const stealth = deriveStealthAddressSecp256k1(metaAddress);

    const wrongKey = generateBaseMetaAddressFromSeed(TEST_SEED_2);

    const payment = {
      ephemeralPubkey: stealth.ephemeralPubkey,
      destination: stealth.address,
      amount: 1_000_000n,
      assetId: "0",
      chain: "base" as const,
      blockHeight: 123,
      txHash: "tx1",
    };

    const detected = tryDecryptStealthPaymentSecp256k1(
      payment,
      wrongKey.viewKeypair.privateKey,
      metaAddress.spendPubSecp256k1!
    );

    expect(detected).toBeNull();
  });

  it("deterministic derivation with fixed ephemeral key", () => {
    const { metaAddress } = generateBaseMetaAddressFromSeed(TEST_SEED_1);
    const ephemeralPriv = new Uint8Array(32).fill(0x42);

    const stealth1 = deriveStealthAddressSecp256k1(metaAddress, ephemeralPriv);
    const stealth2 = deriveStealthAddressSecp256k1(metaAddress, ephemeralPriv);

    expect(hex(stealth1.address)).toBe(hex(stealth2.address));
    expect(hex(stealth1.ephemeralPubkey)).toBe(hex(stealth2.ephemeralPubkey));
    expect(stealth1.formattedAddress).toBe(stealth2.formattedAddress);
  });
});

// ============================================================================
// Phase 4: Hardcoded test vectors (cross-implementation parity)
// ============================================================================

// Ed25519 test vectors: deterministic seeds for cross-implementation verification.
// The expected values are pre-computed from this TypeScript implementation and
// serve as the canonical reference for the Rust implementation.
const ED25519_VECTORS = [
  {
    seed: "0000000000000000000000000000000000000000000000000000000000000001",
    spendPubPrefix: "660e",
    viewPubPrefix: "ae59",
  },
  {
    seed: "0000000000000000000000000000000000000000000000000000000000000002",
    spendPubPrefix: "34c3",
    viewPubPrefix: "9e33",
  },
  {
    seed: "abababababababababababababababababababababababababababababababab",
    spendPubPrefix: "140c",
    viewPubPrefix: "fe65",
  },
  {
    seed: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    spendPubPrefix: "5fe2",
    viewPubPrefix: "8506",
  },
  {
    seed: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    spendPubPrefix: "71e7",
    viewPubPrefix: "67fe",
  },
];

// Secp256k1 test vectors (canonical reference for Rust cross-verification)
const SECP256K1_VECTORS = [
  {
    seed: "0000000000000000000000000000000000000000000000000000000000000001",
    spendPubPrefix: "025f",
    viewPubPrefix: "03d1",
  },
  {
    seed: "0000000000000000000000000000000000000000000000000000000000000002",
    spendPubPrefix: "0388",
    viewPubPrefix: "036c",
  },
  {
    seed: "abababababababababababababababababababababababababababababababab",
    spendPubPrefix: "0295",
    viewPubPrefix: "03b2",
  },
  {
    seed: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    spendPubPrefix: "02fe",
    viewPubPrefix: "0295",
  },
  {
    seed: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    spendPubPrefix: "03ab",
    viewPubPrefix: "0314",
  },
];

describe("Ed25519 test vectors", () => {
  for (const v of ED25519_VECTORS) {
    it(`vector seed=${v.seed.slice(0, 16)}...`, () => {
      const seed = Buffer.from(v.seed, "hex");
      const { metaAddress } = generateSolanaMetaAddressFromSeed(seed);
      expect(hex(metaAddress.spendPubEd25519!).slice(0, 4)).toBe(v.spendPubPrefix);
      expect(hex(metaAddress.viewPubEd25519!).slice(0, 4)).toBe(v.viewPubPrefix);
    });
  }
});

describe("Secp256k1 test vectors", () => {
  for (const v of SECP256K1_VECTORS) {
    it(`vector seed=${v.seed.slice(0, 16)}...`, () => {
      const seed = Buffer.from(v.seed, "hex");
      const { metaAddress } = generateBaseMetaAddressFromSeed(seed);
      expect(hex(metaAddress.spendPubSecp256k1!).slice(0, 4)).toBe(v.spendPubPrefix);
      expect(hex(metaAddress.viewPubSecp256k1!).slice(0, 4)).toBe(v.viewPubPrefix);
    });
  }
});

// ============================================================================
// Helpers
// ============================================================================

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
}
