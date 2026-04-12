# The White Protocol - Devnet Deployment

**Deployment Date**: 2026-04-11
**Status**: ✅ Complete

---

## Program Information

| Field | Value |
|-------|-------|
| **Program ID** | `HJmgwBBjojb2SdKPCW4DFNh2wRQzZ5mtD6ro2YocpZHj` |
| **Network** | Devnet |
| **Deployer** | `8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey` |
| **Pool Authority** | `8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey` |

---

## Core Accounts

| Component | Address | Purpose |
|-----------|---------|---------|
| **Pool Config** | `Hbkbx1EJiAQYsdFCEFhCZ1RWdBoUH3sXLX63KwYsRdfd` | Pool configuration (fees, authority) |
| **Merkle Tree** | `7zDxURRYPEGqxM4zZJe5uuzcPERKha3GMUA8DfV25hAT` | Shielded pool commitment tree |
| **Pending Deposits** | `Dee8rSD2R3MKEES1Rk3a9GQctA4JqsXXdV5NtqcsxxbE` | Pending deposit buffer |
| **Relayer Registry** | `wQta1sHXuFtSkBZjQiANzDBbu2iXhKy3TirFmVhgt42` | Registered relayers |
| **Compliance Config** | `3UYLUAN35EoFZcZZJENQVtVggvayzj9M3g6wo3V5RKLG` | Compliance settings |

---

## Verification Keys

| Circuit | VK PDA | Status |
|---------|--------|--------|
| **Deposit** | `4qaz9uVuJQwrencxstigpxQZU6SG1J7WVoiuuCemRh4r` | ✅ Uploaded |
| **Withdraw** | `H4ED8u1KPz57vGLSVuJqBpE7YfMAbiWgLfPmFnnD4Ek6` | ✅ Uploaded |
| **Membership** | `FBTjajb5wWGWTYkyEMfSKdbV3Pztd9hD82yCywP8X7M2` | ✅ Uploaded |

---

## Supported Assets

| Asset | Mint | Asset Vault | Status |
|-------|------|-------------|--------|
| **wSOL** | `So11111111111111111111111111111111111111112` | `FuVvYz3wM9naPD6GyohU4QpZypkX9G5oDYaNzAfCxyC5` | ✅ Registered |

---

## Relayer

| Field | Value |
|-------|-------|
| **Relayer Node** | `4V58YefNjbYWVtYgkP9ntptEgD2NGDUp5UHfnAivJufT` |
| **Fee** | 1% (100 bps) |
| **Metadata URI** | https://thewhiteprotocol.org/relayer |
| **Status** | ✅ Active |

---

## Configuration

### Tree Configuration
- **Depth**: 20 (1,048,576 notes capacity)
- **Root History Size**: 100

### Pool Parameters
- **Min Fee BPS**: 10 (0.1%)
- **Max Fee BPS**: 500 (5%)
- **Registrations**: Open

---

## Deployment Transactions

| Phase | Transaction | Description |
|-------|-------------|-------------|
| Program Deploy | `538NnQ2jg2zvaLKjBd6UTaficZeap1EwK5p9BS9Dz1FZ5wruEXM8acirHuhrcgb76wkYiNtZejSkhkbQXAbVWzdL` | Deploy program binary |
| Pool Init | `5VBqR7B1sdoiWbFq7PkkwtT5jCiFPddHarVNvyYVA8BPPMUzaMvyy3L2gTuUDtEeJWiZA3FuFvCALTnzAdgCJ9ta` | Initialize pool + Merkle tree |
| Registries | `2NXRXfwE4fYJgSenfZLW7MNUqZhn4HkfJz5h3V4g7qSqpGJ81UQ9HA3TkqQpeATymnXM2mvCoWM9JjXC78yyLAsq` | Initialize pool registries |
| wSOL Asset | `3GNU1UUXG7E88aBE3i1WgzsXhR8yzCmaA2RqPD15A1fX34UnMguf8jgHL9RYitqpgVHqB8CFwK2P7jLd9wDV36rq` | Register wSOL |
| Relayer | `qP7WYadmtNDmG876Q2uUwjuFNNJaf5E8QVJne8CBxqqyEip9mq7WALAyYEAcgbgqrVeHDHMJht97d83WuA26YfQ` | Register relayer |

---

## Quick Start

### Start Relayer
```bash
cd relayer
npm start
```

### Use SDK
```typescript
import { WhiteProtocolClient } from "@whiteprotocol/sdk";

const client = new WhiteProtocolClient(connection, wallet, {
  programId: "HJmgwBBjojb2SdKPCW4DFNh2wRQzZ5mtD6ro2YocpZHj"
});
```

### Environment Variables
```bash
export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
```

---

## Explorer Links

- **Program**: https://explorer.solana.com/address/HJmgwBBjojb2SdKPCW4DFNh2wRQzZ5mtD6ro2YocpZHj?cluster=devnet
- **Pool Config**: https://explorer.solana.com/address/Hbkbx1EJiAQYsdFCEFhCZ1RWdBoUH3sXLX63KwYsRdfd?cluster=devnet

---

## Next Steps

1. ✅ Deploy Program
2. ✅ Initialize Pool State
3. ✅ Register Assets
4. ✅ Upload Verification Keys
5. ✅ Setup Relayer
6. ✅ Build SDK & Relayer
7. ⏭️ E2E Testing (deposit → withdraw)
8. ⏭️ Frontend Integration
