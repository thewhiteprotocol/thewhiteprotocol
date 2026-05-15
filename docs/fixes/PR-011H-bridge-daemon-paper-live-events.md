# PR-011H — Bridge Daemon Paper Mode Against Historical Testnet Events

## Summary

PR-011H validates the PR-011G bridge daemon paper path against a documented historical live testnet source event artifact. The daemon processes the event in paper mode, applies policy and finality checks, signs with the test adapter, creates a Solana submit preview, persists state transitions, and does not submit any destination transaction.

Fresh live RPC scanning was blocked in this shell because the required live env vars were absent. Missing names only:

- `BASE_SEPOLIA_RPC_URL`
- `ETHEREUM_SEPOLIA_RPC_URL`
- `BASE_RPC_URL`
- `ETH_RPC_URL`
- `BRIDGE_SIGNER_MODE`
- `BRIDGE_SIGNER_KEY_FILE`
- `BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET`
- `BRIDGE_OPERATOR_API_TOKEN`

No secret values were printed.

## Route Selected

Route:

- Base Sepolia -> Solana Devnet

This route was selected because `chains/evm/test/base-to-solana-bridge-state.json` contains a complete historical PR-010W source message and event metadata.

## Event Source Used

Historical artifact:

- `chains/evm/test/base-to-solana-bridge-state.json`
- Source tx: `0xc931d4989abc6fa8c6c85726575780d12370c2a26d38db063c837bd0491ac6d2`
- Source block: `41275766`
- Source `BridgeOut` hash: `0xa17dd855e9927eb508e5cea8abec4002c05d79f148a3f84237ae14781eb6edad`
- Generated destination `BridgeMint` hash: `0x706f7b492e5ea1efc568f6bcf5929631650f00635fc4102596fefb231f7f944a`

The artifact deadline is expired as of PR-011H execution, so replay policy is evaluated at the historical observation timestamp:

- `2026-05-09T10:33:43.000Z`

## Policy Result

Policy passed:

- source event kind: `evm_bridge_out_v1`
- source domain: Base Sepolia
- destination domain: Solana Devnet
- route enabled
- asset configured
- exact-decimal normalization applied
- destination amount: `1000000`
- amount within configured cap

## Finality Result

Finality was represented as satisfied in replay by using the historical source event context with sufficient confirmations. Fresh live finality polling was not attempted because live RPC env was absent.

## Signing Result

Paper replay used the local-dev deterministic signer adapter in test context. Signing policy passed and produced 2 threshold signatures. Signature metadata was persisted; private keys were not logged or persisted in state output.

## Submit Preview Result

Submit preview was created:

- family: `solana`
- method: `accept_bridge_v1_mint`
- destination chain: `solana-devnet`
- dryRun: `true`
- wouldSubmit: `true`
- live Solana submission implemented: `false`

## Proof No Destination Tx Was Submitted

Command output showed:

- `mode: "paper"`
- `liveSubmitEnabled: false`
- `destinationTxSubmitted: false`
- `tick.submitted: 0`
- persisted `submitTxHash: null`

No destination adapter submit call is made in paper mode.

## Operator API Result

Unit tests verify:

- `/bridge/daemon/status` exposes `mode=paper`
- `/bridge/daemon/messages` exposes message policy/signing/preview state
- `/bridge/daemon/tick` requires operator auth
- status/message output does not contain operator token or private keys

The local status command also inspected persisted state:

```bash
BRIDGE_DAEMON_STATE_PATH=/tmp/pr011h-paper-state npm run bridge:daemon:paper:status
```

## Commands Run

- `cd relayer && npx jest src/bridge/__tests__/daemon-paper-live-events.test.ts`
- `cd relayer && BRIDGE_DAEMON_STATE_PATH=/tmp/pr011h-paper-state BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false npm run bridge:daemon:paper:once`
- `cd relayer && BRIDGE_DAEMON_STATE_PATH=/tmp/pr011h-paper-state npm run bridge:daemon:paper:status`

Full validation:

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

## Passing Results

- Historical replay command: passed
- Paper status command: passed
- Destination tx submitted: no
- Focused paper replay tests: 5 tests passed
- Relayer tests: 22 suites / 316 tests passed
- Typecheck: passed
- Build: passed
- Watcher smoke: passed with 6 findings and 0 freeze submissions
- Watcher report: passed with `liveFreezeTxCount=0`
- Paper command: passed with status `paper_ready_to_submit`, 2 signatures, 1 preview, 0 submissions

## Remaining Limitations

- Fresh live RPC scan was blocked by missing env in this shell.
- Historical replay uses an as-of timestamp because the source message deadline is now expired.
- Solana destination submission remains preview-only.
- No live-testnet submission was enabled.
- No deployments, circuits, contracts, or programs were changed.
- Not production-ready.

## Next Recommended PR

PR-011I — hosted bridge daemon paper-mode observation:

- configure hosted RPC and operator env as secrets
- run paper daemon against fresh live testnet logs
- compare previews against on-chain route configs
- keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- produce an operator approval checklist for narrowly scoped live-testnet submission
