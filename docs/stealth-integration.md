# Stealth Address Integration Guide

## Devnet Configuration

| Parameter | Value |
|-----------|-------|
| Solana Devnet Program ID | `C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW` |
| Base Sepolia Contract | `0xAc0ae70cd63C98d23858a81aa0860213cb4CcBd0` |
| Devnet Relayer | `https://relayer-devnet.thewhiteprotocol.com` |

## For Wallet Developers

### 1. Generate a Meta-Address

```typescript
import { generateMetaAddressFromWallet, ChainTag } from "@thewhiteprotocol/core";

const { metaAddress, serialized } = await generateMetaAddressFromWallet(
  async (message) => wallet.signMessage(message),
  ChainTag.Universal // or ChainTag.Solana / ChainTag.Base
);

// Display `serialized` to the user as their "stealth address"
console.log("Meta-address:", serialized);
```

### 2. Scan for Incoming Payments

```typescript
import { StealthScanner, loadMetaAddress } from "@thewhiteprotocol/core";

const meta = loadMetaAddress();
if (!meta) return;

const scanner = new StealthScanner(meta, spendPriv, viewPriv, "solana");

// Fetch on-chain events from your indexer / RPC
const events = await fetchStealthEvents(fromSlot, toSlot);

// Detect payments belonging to this user
const detected = scanner.scan(events);

for (const payment of detected) {
  console.log("Received stealth payment:", payment.amount, "at", payment.txHash);
}
```

### 3. Spend from a Stealth Address

```typescript
const payment = detected[0];
const stealthPriv = scanner.deriveStealthPrivateKey(payment);

// Use stealthPriv to sign a Solana transaction or EVM transaction
// from the stealth address to the user's main wallet
```

## For dApp Developers

### Sending to a Meta-Address

```typescript
import { sendToStealthAddress, parseMetaAddress } from "@thewhiteprotocol/core";

const meta = parseMetaAddress(recipientMetaAddressString);
const stealth = sendToStealthAddress(meta, "solana");

// Use `stealth.formattedAddress` as the withdrawal destination
// Include `stealth.ephemeralPubkey` in the withdrawal transaction
```

### Relayer Integration

When submitting a withdrawal to the relayer, include the ephemeral pubkey:

```typescript
const response = await fetch("https://relayer.example.com/withdraw", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    proofData: "0x...",
    merkleRoot: "0x...",
    nullifierHash: "0x...",
    recipient: stealthAddress,
    amount: "1000000000",
    assetId: "0x...",
    mint: "So11111111111111111111111111111111111111112",
    ephemeralPubkey: "0x" + Buffer.from(stealth.ephemeralPubkey).toString("hex"),
  }),
});
```

## Event Indexing

### Solana

Listen for `StealthWithdrawal` events in program logs:

```typescript
const logs = await connection.getParsedTransaction(sig, {
  commitment: "confirmed",
});

// Anchor events are base64-encoded in "Program data:" logs
// Parse using the Anchor event coder
```

### Base / EVM

Listen for `StealthWithdrawal` events:

```typescript
const logs = await publicClient.getContractEvents({
  address: WHITE_PROTOCOL_ADDRESS,
  abi: whiteProtocolAbi,
  eventName: "StealthWithdrawal",
  fromBlock,
  toBlock: "latest",
});
```

## Testing

### Local Round-Trip Test

```typescript
import {
  generateSolanaMetaAddressFromSeed,
  deriveStealthAddressEd25519,
  tryDecryptStealthPaymentEd25519,
  computeStealthPrivateKeyEd25519,
  stealthPubkeyFromPrivateKeyEd25519,
} from "@thewhiteprotocol/core";

const seed = new Uint8Array(32).fill(0x01);
const { metaAddress, spendKeypair, viewKeypair } = generateSolanaMetaAddressFromSeed(seed);

// Sender derives stealth address
const stealth = deriveStealthAddressEd25519(metaAddress);

// Recipient detects it
const payment = {
  ephemeralPubkey: stealth.ephemeralPubkey,
  destination: stealth.address,
  amount: 1000000n,
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

// Derive private key and verify
const s = BigInt("0x" + Buffer.from(detected!.stealthPrivateKey).toString("hex"));
const stealthPriv = computeStealthPrivateKeyEd25519(spendKeypair.privateKey, s);
const derivedPub = stealthPubkeyFromPrivateKeyEd25519(stealthPriv);

console.assert(
  Buffer.from(derivedPub).toString("hex") === Buffer.from(stealth.address).toString("hex"),
  "Round-trip failed"
);
```
