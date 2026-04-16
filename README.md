# The White Protocol

The White Protocol is a multi-chain privacy protocol that enables confidential transfers of tokens through shared, multi-asset shielded pools. It combines zero-knowledge proofs with an on-chain commitment tree and off-chain batching to achieve practical throughput while keeping on-chain verification bounded.

The protocol is live on **Solana Devnet** and **Base Sepolia**, sharing the same Circom circuits, Poseidon Merkle tree, and Groth16 proof system across both chains.

## Status

**Networks:** Solana Devnet, Base Sepolia  
**Release:** Experimental, under active development

## Capabilities

The protocol supports shielded pools for multiple token mints (SPL on Solana, ERC20/ETH on Base), Groth16 proofs over BN254, Poseidon-based commitments, Merkle tree membership proofs, batched settlement of pending deposits through an off-chain sequencer, and yield-bearing asset support with performance fee enforcement on Solana.

## Repository Structure

| Directory | Description |
|-----------|-------------|
| `circuits/` | Shared Circom circuits and compiled artifacts for ZK proof generation |
| `chains/solana/` | Anchor/Rust programs for pool state, deposit settlement, withdrawals, and yield management |
| `chains/base/` | Solidity/Foundry contracts for the EVM port |
| `packages/core/` | Shared TypeScript crypto primitives, types, and proof helpers |
| `relayer/` | Off-chain sequencer and relayer service for batching, proof generation, and client endpoints |
| `frontend/` | Vite marketing landing site |
| `app/` | Next.js dApp — multi-chain privacy dashboard (Solana + Base) |
| `scripts/` | Deployment, initialization, and registry management tooling |

## Deployments

### Solana Devnet

**Program ID:** `C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW`

| Component | Address |
|-----------|---------|
| Pool Config | `EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS` |
| Merkle Tree | `2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD` |
| Pending Buffer | `7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw` |
| wSOL Vault | `629JMEcz1u4AjyahByEcQtyGF3TwDnBPY7nHhaLVB9PS` |

**Supported Assets**

| Asset | Mint Address |
|-------|--------------|
| wSOL | `So11111111111111111111111111111111111111112` |

### Base Sepolia

| Contract | Address |
|----------|---------|
| WhiteProtocol | `0xCE959493cf6F15314b4B9eEbb28369716341e7FE` |
| AssetRegistry | `0x87319Da4558FcBD4f3475cFECc468ee4D736D3ea` |
| DepositVerifier | `0x3F44E947d9f9F0055854aF678F03C32F4bbd415e` |
| WithdrawVerifier | `0xcb657012d8a718EA8FC51E68cC729d923f023E59` |
| MerkleBatchVerifier | `0x71930f07b3bA75A314a6e7c44C350AD0E2718473` |

**Supported Assets**

| Asset | Address |
|-------|---------|
| ETH | `0x0000000000000000000000000000000000000000` |
| WETH | `0x4200000000000000000000000000000000000006` |

## Tiers

The White Protocol offers two product tiers:

### Personal (Free)
- Shielded deposits & withdrawals
- Private send & receive via QR codes and payment links
- Encrypted note storage with wallet-key backup
- Full transaction history

### Business
- Everything in Personal, plus:
- **Private Invoicing** — create branded invoices with shielded payment links
- **Auto-Receipts** — PDF receipts generated automatically on every transaction
- **Accounting Exports** — CSV exports for QuickBooks, Xero, and standard accounting formats
- **Company Branding** — add your logo and business details to invoices and receipts
- *Team Management (coming soon)*

Business tier is free on testnet. On mainnet, it will require WHITE token staking or a USDC subscription.

## Running Locally

```bash
# Install dependencies
npm install

# Run marketing site + app + relayer simultaneously
npm run dev

# Or run individually:
npm run dev:site      # Vite marketing site (port 5173)
npm run dev:app       # Next.js dApp (port 3000)
npm run dev:relayer   # Relayer service (port 3001)
```

## Invoice Flow

1. A Business user creates an invoice in the dApp (`/invoices/create`)
2. A commitment is pre-generated for that invoice
3. The invoice gets a unique public payment link (`/pay/invoice/[id]`)
4. The client opens the link and pays via ZK deposit to the commitment
5. The invoice status updates to **Paid** and a PDF receipt is auto-generated
6. The sender can download the branded invoice PDF and export accounting data

## Protocol Overview

The White Protocol uses a two-phase deposit flow designed around compute constraints on both Solana and Base.

### Deposit Phase

A user submits a deposit instruction with a ZK proof. The commitment is appended to an on-chain pending buffer.

### Settlement Phase

A sequencer batches pending commitments, constructs the Merkle update off-chain, generates a batch proof, and submits a settlement instruction to update the Merkle tree. This approach amortizes insertion costs and keeps on-chain verification bounded.

```
User deposit
    |
    v
Pending buffer (on-chain)
    |
    v
Sequencer batches commitments (off-chain)
    |
    v
Batch proof generation
    |
    v
settle_deposits_batch / settleBatch (on-chain)
    |
    v
Merkle tree updated
```

## Base Chain

The Base implementation is an EVM port of the core protocol written in Solidity and tested with Foundry. It reuses the same Circom circuits and Poseidon Merkle tree (20 levels) as Solana, ensuring cryptographic compatibility across chains.

### Contract Architecture

- **`WhiteProtocol.sol`** — Main privacy pool. Handles deposits, withdrawals, batch settlements, and relayer management. Inherits `MerkleTreeWithHistory`.
- **`AssetRegistry.sol`** — Ownable registry of supported ERC20 tokens and native ETH.
- **`MerkleTreeWithHistory.sol`** — Incremental Poseidon Merkle tree with a 30-slot root history buffer.
- **`DepositVerifier.sol` / `WithdrawVerifier.sol` / `MerkleBatchVerifier.sol`** — SnarkJS-generated Groth16 verifier contracts using Ethereum precompiles.

### How It Differs from Solana

- **Merkle insertion** is performed on-chain inside `settleBatch` after the batch proof is verified.
- **Verifiers** are hard-coded Solidity contracts rather than dynamically uploaded on-chain accounts.
- **Nullifiers** are tracked in a simple `mapping(uint256 => bool)` instead of PDAs.
- **Feature set** is streamlined: it supports deposits, basic withdrawals, and batch settlement without yield mode or join-split transactions.

## Withdrawal Flow

Users generate a ZK proof demonstrating:
- Knowledge of a valid commitment in the Merkle tree
- The nullifier has not been spent
- The recipient and amount match the proof public inputs

The relayer submits the withdrawal transaction, paying gas fees and earning a service fee.

## Yield Earn

The White Protocol supports yield-bearing assets such as Liquid Staking Tokens (JitoSOL, mSOL, bSOL, and similar). Users can deposit LSTs into the shielded pool while continuing to earn staking yield. The underlying tokens appreciate in value over time, and users retain privacy throughout.

### How It Works

1. The pool authority initializes a YieldRegistry and registers yield-bearing mints.
2. Users deposit LSTs into the shielded pool like any other asset.
3. While in the pool vault, LST tokens continue to accrue staking rewards through price appreciation.
4. On withdrawal, yield assets must use the `withdraw_yield_v2` instruction.
5. The yield relayer calculates positive yield off-chain and enforces a 5% performance fee on gains only.
6. Users receive 95% of earned yield plus their original principal.

### Yield Components

| Component | Description |
|-----------|-------------|
| `YieldRegistry` | On-chain registry tracking which mints are yield-bearing (up to 8 per pool) |
| `yield_relayer` | Authorized signer for yield withdrawals, validates fee calculations |
| `yield_fee_bps` | Performance fee in basis points (500 = 5%) |
| `FEATURE_YIELD_ENFORCEMENT` | Feature flag to enable yield mode on a pool |

### Yield Instructions

| Instruction | Description |
|-------------|-------------|
| `init_yield_registry` | Create YieldRegistry PDA for a pool |
| `add_yield_mint` | Register an LST mint as yield-bearing |
| `remove_yield_mint` | Remove an LST mint from the registry |
| `withdraw_yield_v2` | Withdraw yield assets with performance fee enforcement |
| `enable_feature` / `disable_feature` | Toggle `FEATURE_YIELD_ENFORCEMENT` |

### Supported Yield Assets

The YieldRegistry can hold up to 8 yield-bearing mints per pool. Common examples include JitoSOL (Jito Network), mSOL (Marinade Finance), bSOL (BlazeStake), stSOL, and other Solana LSTs.

### Fee Structure

Performance fees apply only to positive yield, not to the original deposit amount. If a user deposits 100 JitoSOL and it appreciates to 105 JitoSOL equivalent value, the 5% fee applies only to the 5 JitoSOL gain. The user receives 104.75 JitoSOL (100 principal + 4.75 net yield).

## Relayer API

Each deployed relayer exposes a local HTTP API for integration. The base URL is deployment-specific and configured per operator.

### Health Check

```
GET /health
```

Returns the current status of the relayer service, including RPC latency and proof queue metrics.

**Example response:**

```json
{
  "status": "ok",
  "timestamp": 1769303384675,
  "proofVerificationEnabled": true,
  "rpcLatencyMs": 140,
  "proofQueueSize": 0,
  "proofQueueMax": 5
}
```

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/pool-state` | GET | Current pool and Merkle tree state |
| `/merkle/proof/:leafIndex` | GET | Merkle inclusion proof for a leaf |
| `/withdraw-proof` | POST | Generate withdrawal ZK proof |
| `/deposit-proof` | POST | Generate deposit ZK proof |
| `/api/config` | GET | Pool configuration and supported assets |
| `/quote` | GET | Get current relayer fee quote |

## Frontend

The frontend is a **Next.js** application located in `frontend/`. It supports both **Solana** and **Base** with automatic wallet detection, allowing users to deposit, withdraw, and view pool state from a single interface.

## Development

### Requirements

| Tool | Version |
|------|---------|
| Rust | 1.75+ |
| Solana CLI | 1.18+ |
| Anchor | 0.30+ |
| Foundry | latest |
| Node.js | 18+ |
| circom | 2.1+ |
| snarkjs | 0.7+ |

### Environment

For Anchor workflows on Devnet:

```bash
export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
```

### Tests

**Solana:**
```bash
cd chains/solana && cargo test -p white-protocol
```

**Base:**
```bash
cd chains/base && forge test
```

## Live Demo

**Frontend:** [White Protocol](https://app.thewhiteprotocol.org) (or your deployed URL)

**Solana Explorer:** [View Program on Solana Explorer](https://explorer.solana.com/address/C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW?cluster=devnet)

**Base Sepolia:**
- [WhiteProtocol](https://sepolia.basescan.org/address/0xCE959493cf6F15314b4B9eEbb28369716341e7FE)
- [AssetRegistry](https://sepolia.basescan.org/address/0x87319Da4558FcBD4f3475cFECc468ee4D736D3ea)

## Security Considerations

This is experimental software intended for development and testing.

- The circuits have not been formally audited
- The trusted setup is not protocol-dedicated
- Mainnet deployment requires:
  - A security audit
  - A dedicated trusted setup ceremony
  - A complete threat model

Yield calculations are performed off-chain by the yield relayer. Users trust the relayer to compute fees correctly. Future versions may include on-chain price oracle integration for trustless fee verification.

## License

MIT
