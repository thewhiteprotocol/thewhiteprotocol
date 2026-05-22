# API / Operator Endpoint Security Matrix

This matrix classifies relayer HTTP endpoints and operator commands from a production-readiness perspective. It is based on code inspection of `relayer/src/index.ts`, `relayer/src/bridge/status-api.ts`, and `relayer/src/api-extensions.ts`.

## Relayer Core Endpoints

| Endpoint | Method | Public / Protected | Auth Required | Rate Limit Status | Input Validation Status | Mutation / Read-only | Risk | Logging / Redaction | Required Remediation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/health` | GET | Public | No | App global/per-key | No input | Read-only | Low | No secrets expected | Keep minimal; avoid exposing internal paths |
| `/metrics` | GET | Public today | No | App global/per-key | No input | Read-only | Medium | May expose operational detail | Decide if metrics should require auth in production |
| `/status` | GET | Public today | No | App global/per-key | No input | Read-only | Medium | Public keys/addresses only | Review exposure of live chain/operator metadata |
| `/quote` | GET | Public | No | App global/per-key | Chain validation; amount parsed as bigint | Read-only | Medium | No secrets expected | Add amount bounds and malformed bigint handling policy |
| `/withdraw` | POST | Public relayer function | No user auth today | App global/per-recipient | Chain and withdraw body validation in processor | Mutation / transaction submit | High | Errors should not expose proof internals | Review abuse controls, nullifier race handling, gas/cost limits |
| `/assets` | GET | Public | No | App global/per-key | Chain validation | Read-only | Low | No secrets expected | Cache and keep non-secret |

## Bridge Status / Operator Endpoints

| Endpoint | Method | Public / Protected | Auth Required | Rate Limit Status | Input Validation Status | Mutation / Read-only | Risk | Logging / Redaction | Required Remediation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/bridge/status` | GET | Public today | No | App global/per-key | No user input beyond request | Read-only | Medium | Aggregate counts only | Decide public vs protected for production |
| `/bridge/routes` | GET | Public today | No | App global/per-key | No user input | Read-only | Low | Route metadata only | Keep non-secret |
| `/bridge/messages` | GET | Public today | No | App global/per-key | Status filter checked; limit capped at 1000 | Read-only | Medium | Message state must stay non-secret | Consider auth if message metadata is operationally sensitive |
| `/bridge/messages/:hash` | GET | Public today | No | App global/per-key | Lowercases hash; no strict hex validation | Read-only | Medium | Message state must stay non-secret | Add strict hash validation |
| `/bridge/daemon/status` | GET | Public today | No | App global/per-key | No user input | Read-only | Medium | Existing tests check token is hidden | Decide public vs protected in production |
| `/bridge/operator/readiness` | GET | Public today | No | App global/per-key | Reads hosted status paths | Read-only | Medium | Existing tests check token is hidden | Decide public vs protected in production |
| `/bridge/daemon/messages` | GET | Public today | No | App global/per-key | No user input | Read-only | Medium | Must not include secrets | Consider auth/pagination for production |
| `/bridge/daemon/messages/:hash` | GET | Public today | No | App global/per-key | No strict hash validation | Read-only | Medium | Must not include secrets | Add strict hash validation and response review |
| `/bridge/daemon/tick` | POST | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | No body input | Mutation / daemon action | High | Existing tests cover auth | Add operator-specific rate limit and audit log |
| `/bridge/daemon/messages/:hash/retry` | POST | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | No strict hash validation | Mutation / retry | High | Errors sanitized by API error shape | Add strict hash validation and retry policy |
| `/bridge/watcher/status` | GET | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | No input | Read-only | Medium | Existing tests cover secret hiding | Keep protected |
| `/bridge/watcher/findings` | GET | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | Limit capped at 1000; status/severity loose cast | Read-only | Medium | Findings should be non-secret | Validate status/severity enums |
| `/bridge/watcher/findings/:id` | GET | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | ID lookup only | Read-only | Medium | Finding must stay non-secret | Add ID format validation if IDs become structured |
| `/bridge/watcher/findings/:id/ack` | POST | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | ID lookup only | Mutation | High | Existing tests cover auth | Add operator audit log |
| `/bridge/watcher/findings/:id/ignore` | POST | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | ID lookup only | Mutation | High | Existing tests cover auth | Add operator audit log |
| `/bridge/watcher/findings/:id/freeze-dry-run` | POST | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | ID lookup only | Preview / no live tx | High | Dry-run preview must stay non-secret | Keep dry-run unless production freeze policy approved |
| `/bridge/watcher/tick` | POST | Protected | `BRIDGE_OPERATOR_API_TOKEN` | App global/per-key | No body input | Mutation / watcher action | High | Existing tests cover auth | Add operator-specific rate limit and audit log |

## API Extension Endpoints

| Endpoint | Method | Public / Protected | Auth Required | Rate Limit Status | Input Validation Status | Mutation / Read-only | Risk | Logging / Redaction | Required Remediation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/generate-commitment` | POST | Protected | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Numeric field validation | Expensive-ish compute | High | Secret inputs must never be logged | Keep protected; consider client-side generation only |
| `/api/compute-nullifier-hash` | POST | Public today | No | Extension global/per-key | Numeric field validation | Sensitive compute | High | Accepts secret/nullifier values | Require auth or move client-side before public beta |
| `/api/asset-id` | GET | Public | No | Extension global/per-key | Chain/address validation | Read-only | Low | No secrets expected | Keep public |
| `/api/compute-asset-id` | POST | Protected | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Mint validation | Read-only compute | Low | No secrets expected | Prefer `/api/asset-id` |
| `/api/deposit-proof` | POST | Protected | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Required fields, numeric validation | Heavy proof generation | Critical | Secret inputs and witness material must be redacted | Add proof-specific concurrency/cost limits |
| `/api/withdraw-proof` | POST | Protected | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Required fields, pubkey, numeric, Merkle path validation | Heavy proof generation | Critical | Secret/nullifier/path inputs must not be logged | Add proof-specific concurrency/cost limits |
| `/api/withdraw-v2-proof` | POST | Protected | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Required fields, pubkey, numeric, path validation | Heavy proof generation | Critical | Change note fields are sensitive | Review before public beta; ensure response custody model |
| `/api/pool-state` | GET | Public today | No | Extension global/per-key | No user input | RPC-heavy read | Medium | No secrets expected | Cache and rate-limit by endpoint |
| `/api/merkle/proof/:leafIndex` | GET | Public today | No | Extension global/per-key | Non-negative index; bounds against local tree | Read-only path disclosure | Medium | Path is non-secret but operational | Decide if public; cap and cache |
| `/api/merkle/insert` | POST | Protected via router middleware | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Numeric commitment and uint32 leaf index | Local state mutation | High | No secrets expected | Keep protected; audit log |
| `/api/note/:commitment` | GET | Public today | No | Extension global/per-key | Length and bigint parse | RPC/local read | Medium | Commitment is public-like but linkable | Decide if public lookup is acceptable |
| `/api/track-deposit` | POST | Public today | No | Extension global/per-key | Numeric commitment | Local pending tracking mutation | High | No secrets expected | Consider auth or abuse protection before public beta |
| `/api/settle-note` | POST | Protected via router middleware | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Numeric commitment and leaf index | Local state mutation | High | No secrets expected | Keep protected; audit log |
| `/api/poseidon-hash` | POST | Protected | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Input array length and numeric validation | Compute | Medium | Inputs might be sensitive | Keep protected |
| `/api/pubkey-to-scalar` | POST | Public today | No | Extension global/per-key | Solana pubkey validation | Read-only compute | Low | Public key only | Keep public or fold into client SDK |
| `/api/build-deposit-tx` | POST | Protected | `SEQUENCER_AUTH_TOKEN` | Extension global/per-key | Required fields; deeper tx validation | Transaction build | High | Proof data should not leak | Keep protected; validate all fields |

## CLI / Operator Commands

| Command | Public / Protected | Write Capability | Current Controls | Required Remediation |
| --- | --- | --- | --- | --- |
| `bridge:daemon:paper:replay` | Operator shell | State write only | Paper mode and no live submit envs required by runbook | Add max block-range policy and CI tests for bad env |
| `bridge:solana-to-base:submit-approved` | Operator shell | Can submit Base tx only with live env | Approved hashes, simulation, note-state gate, idempotency | Production custody and audit logging |
| `bridge:base:submit-withdraw` | Operator shell | Can submit Base withdraw | Recipient gate, note-state/path validation, nullifier check, simulation | Production custody and duplicate-check audit log |
| `watcher:smoke` / `watcher:report` | Operator shell | No live tx by default | Dry-run report | Keep dry-run default |

## Summary Remediation

- Protect or explicitly document public bridge status/message endpoints.
- Require auth for any endpoint that accepts note secrets or mutates local state.
- Add endpoint-category rate limits and proof-generation concurrency limits.
- Add strict hash, route, and enum validation on bridge status parameters.
- Add CI no-secret scan and dependency audit gates.
