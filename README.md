# The White Protocol

The White Protocol is a privacy protocol for Solana that enables confidential transfers of SPL tokens through a shared, multi-asset shielded pool. The protocol combines zero-knowledge proofs with an on-chain commitment tree and off-chain batching to achieve practical throughput while keeping on-chain verification bounded.

This repository contains The White Protocol's Solana programs, Circom circuits, relayer and sequencer services, TypeScript SDK, and deployment scripts.

## Status

**Network:** Solana Devnet

**Release:** Experimental, under active development

## Capabilities

The protocol supports shielded pools for multiple SPL token mints, Groth16 proofs over BN254, Poseidon-based commitments, Merkle tree membership proofs, batched settlement of pending deposits through an off-chain sequencer, and yield-bearing asset support with performance fee enforcement.

## Repository Structure

| Directory | Description |
|-----------|-------------|
| `programs/` | Solana programs for pool state, deposit settlement, withdrawals, and yield management |
| `circuits/` | Circom circuits and compiled artifacts for ZK proof generation |
| `relayer/` | Off-chain service for batching, proof generation, and client endpoints |
| `sdk/` | TypeScript SDK for transactions, notes, and proof construction |
| `scripts/` | Deployment, initialization, and registry management tooling |

## Devnet Deployment

**Program ID:** `BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb`

### Active Pool

| Component | Address |
|-----------|---------|
| Pool Config | `uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc` |
| Merkle Tree | `DR3C2PRhgtcgZDiaAtKGHMK2Z3AZr1QUAHNCeLmJ37W4` |
| Pending Buffer | `GFfT479ybSWUZgBaq4rLjU2zuwYX8ziPXHqX9rYZmRTS` |
| Pool Authority | `6qroZpZMFjLzhyBVz8CUeUjWXhmue3EAVQM57FczNysA` |
| Relayer Registry | `Eo5t5SicskPpzSPxpDWnru6BHvfjEXTNSdSVgD5tErvF` |
| Compliance Config | `FGkwjNzeC1z2RubycEGAxAocmwKy6SoTd8Ed3QCwzaBF` |

### Supported Assets

| Asset | Mint Address |
|-------|--------------|
| wSOL | `So11111111111111111111111111111111111111112` |

## Protocol Overview

The White Protocol uses a two-phase deposit flow designed around Solana's compute constraints.

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
settle_deposits_batch (on-chain)
    |
    v
Merkle tree updated
```

## Withdrawal Flow

Users generate a ZK proof demonstrating:
- Knowledge of a valid commitment in the Merkle tree
- The nullifier has not been spent
- The recipient and amount match the proof public inputs

The relayer submits the withdrawal transaction, paying gas fees and earning a 0.5% service fee.

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

## API Reference

The White Protocol relayer API is publicly available for integration with privacy-preserving applications on Solana.

**Base URL:** `https://api.thewhiteprotocol.org`

### Health Check

```
GET /health
```

Returns the current status of the relayer service, including RPC latency and proof queue metrics.

**Example request:**

```bash
curl https://api.thewhiteprotocol.org/health
```

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

### Pool State

```
GET /pool-state
```

Returns the current state of the shielded pool, including Merkle tree information and pending deposits.

### Additional Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/pool-state` | GET | Current pool and Merkle tree state |
| `/merkle/proof/:leafIndex` | GET | Merkle inclusion proof for a leaf |
| `/withdraw-proof` | POST | Generate withdrawal ZK proof |
| `/deposit-proof` | POST | Generate deposit ZK proof |
| `/api/config` | GET | Pool configuration and supported assets |
| `/quote` | GET | Get current relayer fee quote |

### Network

The API currently operates on Solana Devnet. Mainnet deployment is planned for a future release.

## Development

### Requirements

| Tool | Version |
|------|---------|
| Rust | 1.75+ |
| Solana CLI | 1.18+ |
| Anchor | 0.30+ |
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

```bash
cargo test -p white-protocol
```

## Live Demo

**Frontend:** [White Protocol](https://app.thewhiteprotocol.org) (or your deployed URL)

**Explorer:** [View Program on Solana Explorer](https://explorer.solana.com/address/BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb?cluster=devnet)

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