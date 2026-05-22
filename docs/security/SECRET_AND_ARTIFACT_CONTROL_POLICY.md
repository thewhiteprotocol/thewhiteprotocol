# Secret And Artifact Control Policy

## Summary

This policy defines what can and cannot be committed, logged, printed, copied into evidence packages, or exposed through API responses.

The default rule is simple: if an artifact can authorize a transaction, reveal note ownership, reveal note spending material, generate or verify a private witness, access a private service, or mutate operator state, it must stay outside git and out of public logs.

## Forbidden Committed Artifacts

Never commit:

- `.env` files except reviewed `.env.example` placeholders;
- private keys and signer keys;
- wallet/keypair JSON files;
- mnemonic or seed phrase material;
- operator tokens;
- RPC URLs containing keys or account-specific tokens;
- note secrets;
- nullifier secrets;
- bridge-note-state or destination note-state JSON;
- witness files such as `.wtns`;
- generated proof files;
- generated public/input JSON files containing witness-derived material;
- generated transaction files;
- result JSON copied from `/data`;
- private operator reports;
- zkeys unless explicitly approved as public ceremony artifacts.

PR-014E adds `npm run security:no-secret-scan` and the `Security Guards` GitHub Actions workflow. The scanner fails CI for forbidden tracked artifacts and prints only file path plus issue type.

The scanner has a temporary baseline at `docs/security/no-secret-scan-baseline.json` for pre-existing tracked findings outside the PR-014E edit scope. Baseline entries contain only path and issue type, not values. New findings fail CI.

## Allowed Public Artifacts

Allowed in git after review:

- source code;
- non-secret docs and runbooks;
- public deployment addresses and verified artifacts;
- public transaction hashes;
- public message hashes;
- public commitments and nullifier hashes when already emitted on-chain;
- non-secret test fixtures that do not include note secrets, nullifier secrets, private keys, or witnesses;
- `.env.example` files with placeholders only.

## Local-Only Artifacts

Local-only artifacts must remain ignored:

- proof inputs/outputs;
- witness files;
- generated zkey/bootstrap outputs;
- source fixture progress files;
- private note-state;
- local bridge state;
- local watcher or operator result reports;
- scratch transaction JSON;
- temporary wallet files.

The root `.gitignore` covers these categories, including note-state, bridge state, witness files, proof/public/input JSON, generated transaction JSON, operator result paths, private env files, and keypair/wallet JSON.

## Render Persistent Disk Artifacts

Render persistent disk artifacts may be referenced by path in docs, but must not be committed:

- `/data/circuit-artifacts`
- `/data/bridge-results`
- `/data/white-bridge-note-state`
- `/data/base-destination-note-state`
- `/data/base-merkle-paths`

These paths must be protected by platform access controls and should be backed up according to operator custody policy.

## Zkey Handling

- Hosted zkeys must be checksum-verified before use.
- Production zkey provenance must be formalized before mainnet.
- Zkeys must not be copied into audit evidence bundles unless explicitly approved and labeled as public artifacts.
- Witnesses and generated proofs must never be committed with zkeys.
- Existing public circuit zkeys are explicitly allowlisted by the CI scanner only where they are already committed as public artifacts. New zkey paths fail the scan by default.

## Note-State Handling

- Note-state is sensitive operator custody material.
- Durable note-state backups must live outside git.
- Live Solana -> Base submit requires exact durable Base destination note-state validation/readback before send.
- Missing note-state can make a destination commitment unrecoverable for withdrawal.
- Note-state paths may be printed; note-state values must not be printed.

## Witness / Proof Handling

- Witness files are private and must not be logged or committed.
- Generated proof files should be treated as local/operator artifacts unless a specific public proof publication process is approved.
- Proof generation endpoints and commands must redact errors and avoid dumping circuit inputs.

## Env Var Handling

Classify env vars as:

- public config: public domains, public addresses, chain IDs, non-secret feature flags;
- operator secret: `BRIDGE_OPERATOR_API_TOKEN`, alert webhooks, operator tokens;
- signer secret: signer keys, wallet keypairs, deployer keys;
- RPC secret: RPC URLs with embedded keys or account tokens;
- note-state path: path-only config, not note-state contents;
- zkey path: path/checksum config, not witness/proof contents;
- database secret: any future database URL, password, or service token.

Production env vars must live in a secret manager or platform secret store, not in git.

## Log Redaction Rules

Logs and API errors must redact:

- private keys;
- signer keys;
- wallet file contents;
- RPC URLs with keys;
- operator tokens;
- alert webhooks;
- note secrets;
- nullifier secrets;
- witnesses;
- raw env values;
- proof witness inputs.

Failed simulation logs may include public addresses, public hashes, function names, and sanitized revert reasons, but must not include secret values.

## Frontend Boundary

- `NEXT_PUBLIC` or equivalent frontend-exposed variables must never contain secrets.
- Submit-approved, replay, freeze, pause, settle, withdraw execution, and operator endpoints must remain backend/operator-only.
- Future frontend integrations must use public read endpoints or authenticated backend APIs that do not expose server-only controls.

## Incident Procedure If A Secret Is Exposed

1. Stop affected automation.
2. Remove the exposed artifact from active branches and deployment artifacts.
3. Rotate affected keys/tokens/RPC credentials.
4. Revoke compromised signer or operator authorization where applicable.
5. Audit logs for usage during the exposure window.
6. Publish an internal incident report with scope, rotation evidence, and follow-up controls.
7. Do not resume mainnet or public beta operations until remediation is reviewed.

## Scanner Commands

```bash
npm run security:no-secret-scan:self-test
npm run security:no-secret-scan
```

The scanner output policy is intentionally redacted. It reports `path` and `issue` only, never the matched value.

Baseline cleanup is required before mainnet.
