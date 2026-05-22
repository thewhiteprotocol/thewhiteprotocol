# API / Operator Endpoint Security Matrix

This matrix classifies relayer HTTP endpoints and operator commands from a production-readiness perspective. It is based on code inspection of `relayer/src/index.ts`, `relayer/src/bridge/status-api.ts`, and `relayer/src/api-extensions.ts`.

## Relayer Core Endpoints

| Endpoint | Method | Public / Protected | Auth Required | Rate Limit Status | Input Validation Status | Mutation / Read-only | Risk | Logging / Redaction | Required Remediation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/health` | GET | Public | No | Public limiter plus global backstop | No input | Read-only | Low | No secrets expected | Keep minimal; avoid exposing internal paths |
| `/metrics` | GET | Public today | No | Public limiter plus global backstop | No input | Read-only | Medium | May expose operational detail | Decide if metrics should require auth in production |
| `/status` | GET | Public today | No | Public limiter plus global backstop | No input | Read-only | Medium | Public keys/addresses only | Review exposure of live chain/operator metadata |
| `/quote` | GET | Public | No | Public limiter plus global backstop | Chain validation; amount parsed as bigint | Read-only | Medium | No secrets expected | Add amount bounds and malformed bigint handling policy |
| `/withdraw` | POST | Public relayer function | No user auth today | Expensive limiter plus global backstop | Chain and withdraw body validation in processor | Mutation / transaction submit | High | Errors should not expose proof internals | Review abuse controls, nullifier race handling, gas/cost limits |
| `/assets` | GET | Public | No | Public limiter plus global backstop | Chain validation | Read-only | Low | No secrets expected | Cache and keep non-secret |

## Bridge Status / Operator Endpoints

| Endpoint | Method | Public / Protected | Auth Required | Rate Limit Status | Input Validation Status | Mutation / Read-only | Risk | Logging / Redaction | Required Remediation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/bridge/status` | GET | Public today | No | Public limiter plus global backstop | No user input beyond request | Read-only | Medium | Aggregate counts only | Decide public vs protected for production |
| `/bridge/routes` | GET | Public today | No | Public limiter plus global backstop | No user input | Read-only | Low | Route metadata only | Keep non-secret |
| `/bridge/messages` | GET | Public today | No | Public limiter plus global backstop | Status enum checked; limit/offset bounded | Read-only | Medium | Message state must stay non-secret | Consider auth if message metadata is operationally sensitive |
| `/bridge/messages/:hash` | GET | Public today | No | Public limiter plus global backstop | Requires 32-byte hex hash | Read-only | Medium | Message state must stay non-secret | Keep strict hash validation and response review |
| `/bridge/daemon/status` | GET | Public today | No | Public limiter plus global backstop | No user input | Read-only | Medium | Existing tests check token is hidden | Decide public vs protected in production |
| `/bridge/operator/readiness` | GET | Public today | No | Public limiter plus global backstop | Reads fixed hosted status paths | Read-only | Medium | Existing tests check token is hidden | Decide public vs protected in production |
| `/bridge/daemon/messages` | GET | Public today | No | Public limiter plus global backstop | No user input | Read-only | Medium | Must not include secrets | Consider auth/pagination for production |
| `/bridge/daemon/messages/:hash` | GET | Public today | No | Public limiter plus global backstop | Requires 32-byte hex hash | Read-only | Medium | Must not include secrets | Keep strict hash validation and response review |
| `/bridge/daemon/tick` | POST | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | No body input | Mutation / daemon action | High | Existing tests cover auth | Add operator audit log |
| `/bridge/daemon/messages/:hash/retry` | POST | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | Requires 32-byte hex hash | Mutation / retry | High | Errors sanitized by API error shape | Keep retry policy and audit log |
| `/bridge/watcher/status` | GET | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | No input | Read-only | Medium | Existing tests cover secret hiding | Keep protected |
| `/bridge/watcher/findings` | GET | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | Limit/offset bounded; status/severity enums validated | Read-only | Medium | Findings should be non-secret | Add ID format validation if IDs become structured |
| `/bridge/watcher/findings/:id` | GET | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | ID lookup only | Read-only | Medium | Finding must stay non-secret | Add ID format validation if IDs become structured |
| `/bridge/watcher/findings/:id/ack` | POST | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | ID lookup only | Mutation | High | Existing tests cover auth | Add operator audit log |
| `/bridge/watcher/findings/:id/ignore` | POST | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | ID lookup only | Mutation | High | Existing tests cover auth | Add operator audit log |
| `/bridge/watcher/findings/:id/freeze-dry-run` | POST | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | ID lookup only | Preview / no live tx | High | Dry-run preview must stay non-secret | Keep dry-run unless production freeze policy approved |
| `/bridge/watcher/tick` | POST | Protected | Timing-safe `BRIDGE_OPERATOR_API_TOKEN` | Operator limiter plus global backstop | No body input | Mutation / watcher action | High | Existing tests cover auth | Add operator audit log |

## API Extension Endpoints

| Endpoint | Method | Public / Protected | Auth Required | Rate Limit Status | Input Validation Status | Mutation / Read-only | Risk | Logging / Redaction | Required Remediation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/generate-commitment` | POST | Protected | Timing-safe `SEQUENCER_AUTH_TOKEN` | API extension public limiter | Numeric field validation | Expensive-ish compute | High | Secret inputs must never be logged | Keep protected; consider client-side generation only |
| `/api/compute-nullifier-hash` | POST | Public today | No | API extension public limiter | Numeric field validation | Sensitive compute | High | Accepts secret/nullifier values | Require auth or move client-side before public beta |
| `/api/asset-id` | GET | Public | No | Public limiter plus API extension limiter | Chain/address validation | Read-only | Low | No secrets expected | Keep public |
| `/api/compute-asset-id` | POST | Protected | Timing-safe `SEQUENCER_AUTH_TOKEN` | API extension public limiter | Mint validation | Read-only compute | Low | No secrets expected | Prefer `/api/asset-id` |
| `/api/deposit-proof` | POST | Protected | Timing-safe `SEQUENCER_AUTH_TOKEN` | Expensive limiter plus API extension limiter | Required fields, numeric validation | Heavy proof generation | Critical | Secret inputs and witness material must be redacted | Add proof-specific concurrency/cost limits |
| `/api/withdraw-proof` | POST | Protected | Timing-safe `SEQUENCER_AUTH_TOKEN` | Expensive limiter plus API extension limiter | Required fields, pubkey, numeric, Merkle path validation | Heavy proof generation | Critical | Secret/nullifier/path inputs must not be logged | Add proof-specific concurrency/cost limits |
| `/api/withdraw-v2-proof` | POST | Protected | Timing-safe `SEQUENCER_AUTH_TOKEN` | Expensive limiter plus API extension limiter | Required fields, pubkey, numeric, path validation | Heavy proof generation | Critical | Change note fields are sensitive | Review before public beta; ensure response custody model |
| `/api/pool-state` | GET | Public today | No | Public limiter plus API extension limiter | No user input | RPC-heavy read | Medium | No secrets expected | Cache and rate-limit by endpoint |
| `/api/merkle/proof/:leafIndex` | GET | Public today | No | Public limiter plus API extension limiter | Non-negative index; bounds against local tree | Read-only path disclosure | Medium | Path is non-secret but operational | Decide if public; cap and cache |
| `/api/merkle/insert` | POST | Protected via router middleware | Timing-safe `SEQUENCER_AUTH_TOKEN` | API extension public limiter | Numeric commitment and uint32 leaf index | Local state mutation | High | No secrets expected | Keep protected; audit log |
| `/api/note/:commitment` | GET | Public today | No | Public limiter plus API extension limiter | Length and bigint parse | RPC/local read | Medium | Commitment is public-like but linkable | Decide if public lookup is acceptable |
| `/api/track-deposit` | POST | Public today | No | API extension public limiter | Numeric commitment | Local pending tracking mutation | High | No secrets expected | Consider auth or abuse protection before public beta |
| `/api/settle-note` | POST | Protected via router middleware | Timing-safe `SEQUENCER_AUTH_TOKEN` | API extension public limiter | Numeric commitment and leaf index | Local state mutation | High | No secrets expected | Keep protected; audit log |
| `/api/poseidon-hash` | POST | Protected | Timing-safe `SEQUENCER_AUTH_TOKEN` | API extension public limiter | Input array length and numeric validation | Compute | Medium | Inputs might be sensitive | Keep protected |
| `/api/pubkey-to-scalar` | POST | Public today | No | Public limiter plus API extension limiter | Solana pubkey validation | Read-only compute | Low | Public key only | Keep public or fold into client SDK |
| `/api/build-deposit-tx` | POST | Protected | Timing-safe `SEQUENCER_AUTH_TOKEN` | API extension public limiter | Required fields; deeper tx validation | Transaction build | High | Proof data should not leak | Keep protected; validate all fields |

## CLI / Operator Commands

| Command | Public / Protected | Write Capability | Current Controls | Required Remediation |
| --- | --- | --- | --- | --- |
| `bridge:daemon:paper:replay` | Operator shell | State write only | Paper mode and no live submit envs required by runbook | Add max block-range policy and CI tests for bad env |
| `bridge:solana-to-base:submit-approved` | Operator shell | Can submit Base tx only with live env | Approved hashes, simulation, note-state gate, idempotency | Production custody and audit logging |
| `bridge:base:submit-withdraw` | Operator shell | Can submit Base withdraw | Recipient gate, note-state/path validation, nullifier check, simulation | Production custody and duplicate-check audit log |
| `watcher:smoke` / `watcher:report` | Operator shell | No live tx by default | Dry-run report | Keep dry-run default |

## Summary Remediation

- Protect or explicitly document public bridge status/message endpoints before mainnet.
- Require auth for any endpoint that accepts note secrets or mutates local state; PR-014D hardened current token comparisons.
- Add shared production rate limiting and proof-generation concurrency limits; PR-014D added in-process endpoint-category limits.
- Keep expanding strict hash, route, enum, block-range, and path validation; PR-014D hardened bridge hash, status, severity, and pagination parameters.
- Add CI no-secret scan and dependency audit gates.
