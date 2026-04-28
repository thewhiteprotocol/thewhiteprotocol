# Solana LayerZero Bridge PoC

This directory contains a minimal proof-of-concept demonstrating:
1. A Solana program structured to call LayerZero V2 `endpoint::send` via CPI.
2. A TypeScript test that queries a deployed Solana OApp's DVN configuration.

## Structure

```
research/solana-lz-poc/
├── program/
│   ├── Cargo.toml          # Rust dependencies
│   └── src/
│       ├── lib.rs          # Minimal OApp program with mock endpoint CPI
│       └── mock_oapp.rs    # Mock oapp module (replace with real LZ crate)
├── test/
│   └── test-oapp-config.ts # TypeScript test reading OApp config from devnet
└── README.md               # This file
```

## Building the Program

### Prerequisites
- Rust 1.70+
- Solana CLI 1.17+
- Anchor 0.29+ (optional, for real deployment)

### Compile

```bash
cd program
cargo check
```

> **Status:** `cargo check` passes with 0 errors (23 warnings are expected Anchor 0.29 / Rust 1.80+ `unexpected_cfgs` noise).

The program uses a **mock** `oapp` module so it compiles without the LayerZero monorepo. To use the real LayerZero endpoint, replace `src/mock_oapp.rs` with the actual crate from:

```
LayerZero-Labs/LayerZero-v2/packages/layerzero-v2/solana/programs/oapp
```

And update `Cargo.toml`:

```toml
[dependencies]
oapp = { path = "../../../LayerZero-v2/packages/layerzero-v2/solana/programs/oapp" }
```

## Running the TypeScript Test

### Prerequisites
- Node.js 18+
- `@layerzerolabs/lz-solana-sdk-v2` installed

```bash
cd test
npm install
npx ts-node test-oapp-config.ts
```

> **Note:** The TypeScript DVN config test is a stub. It should connect to Solana devnet and read the default ULN configuration for a given destination EID, asserting that at least one required DVN is configured. To run it fully, install `@layerzerolabs/lz-solana-sdk-v2` and replace the placeholder connection with a real RPC endpoint.

## Key Design Patterns Demonstrated

### 1. OApp Store PDA
The program derives a `Store` PDA with seeds `[b"Store"]` which acts as the OApp identity. This PDA is registered with the LZ Endpoint via `register_oapp` CPI.

### 2. Peer Authentication
Inbound messages are authenticated by deriving a `Peer` PDA from `(store, src_eid)` and checking that `params.sender == peer.peer_address`.

### 3. Account Discovery (`lz_receive_types_v2`)
The program implements `lz_receive_types_info` and `lz_receive_types_v2` instructions so the off-chain Executor can discover which accounts are needed to execute `lz_receive`.

### 4. Message Codec
The program includes a custom message codec for the White Protocol bridge message format (52-byte compact encoding).

## Limitations

- The mock endpoint does not perform real signature verification or nonce tracking.
- The test reads **default** config, not OApp-specific config. In production, OApps should set their own DVN/executor config rather than relying on defaults.
- Compute unit consumption is not measured in this PoC. Production must benchmark `bridge_out` with proof verification + LZ CPI.
