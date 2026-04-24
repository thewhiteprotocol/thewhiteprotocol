#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/thewhiteprotocol"
RELAYER_LOG="/tmp/white-local-relayer.log"

cleanup() {
  if [[ -n "${RELAYER_PID:-}" ]]; then
    kill "${RELAYER_PID}" >/dev/null 2>&1 || true
    wait "${RELAYER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "${ROOT}/relayer"
RPC_ENDPOINT="https://api.devnet.solana.com" \
RELAYER_KEYPAIR='[141,94,146,17,151,246,203,40,30,211,131,13,135,60,197,243,93,54,242,82,177,69,25,67,149,9,166,92,234,97,242,26,108,119,144,208,129,217,10,162,178,159,59,57,43,9,47,214,149,36,187,178,95,121,70,146,80,174,66,141,249,88,246,190]' \
PROGRAM_ID="C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW" \
POOL_CONFIG="EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS" \
PORT="3001" \
WITHDRAW_VK_PATH="${ROOT}/circuits/withdraw/build/withdraw_vk.json" \
WITHDRAW_V2_VK_PATH="${ROOT}/circuits/withdraw_v2/build/withdraw_v2_vk.json" \
CIRCUITS_PATH="${ROOT}/circuits" \
npm run dev >"${RELAYER_LOG}" 2>&1 &
RELAYER_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:3001/health" >/dev/null

cd "${ROOT}"
env HOME=/tmp \
  WITHDRAW_RELAYER_URL="http://127.0.0.1:3001" \
  PUBLIC_RELAYER_URL="https://relayer.thewhiteprotocol.com" \
  npx tsx tools/_scratch/solana_live_smoke.ts
