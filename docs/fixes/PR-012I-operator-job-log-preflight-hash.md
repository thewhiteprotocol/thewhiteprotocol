# PR-012I - Operator Job Log With Preflight Hash Binding

## Summary

PR-012I adds a persistent hosted operator job index for the Base Sepolia -> Solana Devnet settlement/withdraw workflow. The job wrapper now records a non-secret audit entry for each dry-run or execute attempt and binds that entry to the exact PR-012G preflight report SHA256 used by the job.

No bridge accept, settlement, or withdraw transaction is submitted by default.

## Why PR-012I Follows PR-012H

PR-012H made settlement/withdraw execution require a fresh preflight report and an explicit execute flag. PR-012I hardens that workflow by making the operator job auditable across Render restarts and by detecting any preflight report mutation after the job binds to it.

## Job Index Format

Default index path:

```text
/data/bridge-results/operator-job-index.json
```

Override:

```text
BRIDGE_OPERATOR_JOB_INDEX_PATH
```

Each entry is non-secret and includes:

- job id and job type
- route
- source and destination message hashes
- destination commitment
- preflight report path and SHA256
- preflight creation time and max age
- note-state path, without note secrets
- zkey hashes
- FIFO plan summary
- wallet public key and expected pool authority
- dry-run or execute mode
- status
- settlement and withdraw tx ids if execution succeeds
- result report path
- safe error code and summary if blocked or failed

## Preflight SHA256 Binding

`bridge:job:settle-withdraw` computes the SHA256 of the selected preflight report before validating gates. Operators can pin the reviewed preflight report with:

```bash
BRIDGE_EXPECTED_PREFLIGHT_SHA256=<sha256> npm run bridge:job:settle-withdraw
```

Execution is blocked if:

- the expected SHA256 does not match;
- the preflight report changes after the job starts;
- the report is stale;
- the destination hash differs from the requested destination hash;
- preflight readiness is not `ready`.

## Dry-Run Behavior

Dry-run remains the default. A successful dry-run:

- writes or updates the operator job index;
- records `status=dry_run_ready`;
- records the preflight report SHA256;
- submits no transactions.

## Execute Behavior

Execute mode still requires:

```text
BRIDGE_SETTLE_WITHDRAW_EXECUTE=true
```

When execution is requested, the wrapper:

1. validates all PR-012H gates;
2. checks duplicate execution history in the job index;
3. writes `status=executing`;
4. re-checks the bound preflight report SHA256;
5. runs the existing verifier only if the hash is unchanged;
6. writes `status=succeeded` or `status=failed`.

## Duplicate Execution Policy

If the job index already contains a successful settlement/withdraw job for the same destination BridgeMint hash, the wrapper blocks another execute-mode run. This avoids blindly re-running a duplicate withdraw path after a successful job.

## Index And Show Commands

```bash
npm run bridge:job:index
BRIDGE_DESTINATION_MESSAGE_HASH=<destination_hash> npm run bridge:job:show
```

Both commands print non-secret job summaries only.

## Render Persistent Disk Paths

Hosted operation expects:

- `/data/white-bridge-note-state`
- `/data/circuit-artifacts`
- `/data/bridge-results`
- `/data/bridge-results/operator-job-index.json`

Do not use `/tmp` for note-state, zkeys, job index, or reports.

## Tests Run

- `cd chains/solana && npm run bridge:test-job:settle-withdraw`
- `cd chains/solana && npm run bridge:test-preflight:settle-withdraw`
- `cd chains/solana && npm run test:rust`
- `cd chains/solana && npm run build:sbf`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

## Remaining Limitations

- Render still needs durable zkeys, durable note-state, and a fresh preflight report before the job can pass.
- Render does not include Rust/SBF tooling; Rust and SBF validation are run in Codespace.
- The duplicate execution policy is conservative. A future audited resume mode can be added for partial execution recovery.

## Next Recommended PR

PR-012J should add an audited resume/recovery mode for partially completed hosted settlement/withdraw jobs, keyed by the same job index and preflight hash binding.
