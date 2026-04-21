# Stealth Addresses — The White Protocol

## Overview

The White Protocol implements a **dual-key stealth address scheme** on top of the existing shielded pool. This closes the "recipient clustering" privacy hole by ensuring every withdrawal destination is a fresh, unlinkable address that only the intended recipient can detect and spend from.

**Key properties:**
- **No circuit changes:** The existing withdrawal circuit already accepts any destination pubkey; stealth addresses are purely an off-chain addition.
- **No trusted setup re-run:** Existing Groth16 proving keys remain valid.
- **Backward compatible:** Non-stealth withdrawals continue to work unchanged.
- **Cross-chain:** Same meta-address format works for both Solana (ed25519) and Base/EVM (secp256k1).

---

## Cryptographic Scheme

### Meta-address

Each user has a **meta-address** consisting of two keypairs derived deterministically from a single wallet signature:

- **Spending keypair** `(spend_priv, Spend_pub)` — authorizes spending from stealth addresses
- **Viewing keypair** `(view_priv, View_pub)` — detects incoming stealth payments

The meta-address is serialized as:

```
meta_address = base58(chain_tag || Spend_pub || View_pub || checksum)
```

Where:
- `chain_tag` = `0x01` (Solana), `0x02` (Base), or `0x03` (universal cross-chain)
- `checksum` = first 4 bytes of `SHA256(chain_tag || Spend_pub || View_pub)`

### Derivation from wallet signature

```
seed = HKDF-SHA256(wallet_signature, salt="whiteprotocol-stealth-v1", info="meta")
spend_priv_ed25519 = HKDF-expand(seed, "spend-ed25519", 32) reduced mod ℓ
view_priv_ed25519  = HKDF-expand(seed, "view-ed25519", 32) reduced mod ℓ
spend_priv_secp256k1 = HKDF-expand(seed, "spend-secp256k1", 32) reduced mod n
view_priv_secp256k1  = HKDF-expand(seed, "view-secp256k1", 32) reduced mod n
```

### Stealth address derivation (sender side)

Given recipient's meta-address `(Spend_pub, View_pub)`:

1. Generate ephemeral keypair: `r ← random scalar`, `R = r · G`
2. Compute shared secret: `s = H(r · View_pub)` where `H` is `SHA256` truncated/reduced to the curve's scalar field
3. Derive stealth public key: `P = Spend_pub + s · G`
4. Emit `R` on-chain alongside the withdrawal so recipient can scan

### Stealth address detection (recipient side)

For each on-chain `R`:

1. Compute `s' = H(view_priv · R)`
2. Compute `P' = Spend_pub + s' · G`
3. If `P'` equals the withdrawal destination, this payment belongs to the recipient

### Spending from stealth address

The private key for stealth address `P` is:

```
stealth_priv = spend_priv + s (mod n)
```

The recipient uses this to sign transactions spending from `P` like any normal wallet.

---

## On-chain Events

### Solana

The `withdraw_masp_stealth` instruction accepts an optional `ephemeral_pubkey: [u8; 32]` and emits:

```rust
#[event]
pub struct StealthWithdrawal {
    pub ephemeral_pubkey: [u8; 32],
    pub destination: Pubkey,
    pub slot: u64,
}
```

### Base / EVM

The `withdrawStealth` function accepts a `bytes32 ephemeralPubkey` and emits:

```solidity
event StealthWithdrawal(
    bytes32 indexed ephemeralPubkey,
    address indexed destination,
    uint256 blockNumber
);
```

---

## Privacy Guarantees

1. **Unlinkability:** Every withdrawal uses a fresh stealth address. An observer cannot link two withdrawals to the same recipient.
2. **Undetectability:** Without the viewing key, an observer cannot determine which withdrawals belong to a given meta-address.
3. **Forward secrecy:** Even if a meta-address is compromised in the future, past payments remain unlinkable because ephemeral keys are random per payment.

---

## Security Considerations

- **Viewing key leak:** If `view_priv` is leaked, an attacker can detect all incoming payments but cannot spend them without `spend_priv`.
- **Ephemeral pubkey reuse:** Must never reuse the same ephemeral keypair for two different payments to the same meta-address. This would link the two payments.
- **Quantum resistance:** This scheme is not post-quantum secure. A quantum attacker with `View_pub` and `R` can compute `s = H(r · View_pub)` via Shor's algorithm.

---

## Integration Notes

- Stealth derivation is performed **entirely off-chain**.
- The on-chain program only stores/verifies the ZK proof and emits the ephemeral pubkey.
- No additional on-chain accounts or PDAs are required.
- The relayer passes ephemeral pubkeys through transparently without modification.
