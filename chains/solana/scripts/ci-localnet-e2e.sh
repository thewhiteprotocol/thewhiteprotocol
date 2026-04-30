#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../"

LOCALNET_KEYPAIR="target/deploy/white_protocol-keypair.json"
LOCALNET_PROGRAM_ID="$(solana-keygen pubkey "$LOCALNET_KEYPAIR")"
TEMP_WALLET="$(mktemp /tmp/solana-ci-wallet-XXXXXX.json)"
VALIDATOR_PID=""
RPC_URL="http://localhost:8899"
LIB_RS="programs/white-protocol/src/lib.rs"
LIB_RS_BACKUP="${LIB_RS}.bak"

cleanup() {
  echo "🧹 Cleaning up..."
  if [ -n "$VALIDATOR_PID" ] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi
  rm -f "$TEMP_WALLET"
  if [ -f "$LIB_RS_BACKUP" ]; then
    mv "$LIB_RS_BACKUP" "$LIB_RS"
  fi
}
trap cleanup EXIT

echo "═══════════════════════════════════════════════════════════════"
echo "  Solana Localnet E2E — CI Orchestration"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Localnet Program ID: $LOCALNET_PROGRAM_ID"
echo "Temp Wallet:         $TEMP_WALLET"
echo ""

# 1. Generate temp wallet
echo "🔑 Generating temporary wallet..."
solana-keygen new --no-passphrase --force --outfile "$TEMP_WALLET" >/dev/null 2>&1
WALLET_PUBKEY="$(solana-keygen pubkey "$TEMP_WALLET")"
echo "   Wallet: $WALLET_PUBKEY"

# 2. Temporarily patch declare_id! to localnet keypair
echo "🔧 Patching declare_id! to localnet program ID..."
cp "$LIB_RS" "$LIB_RS_BACKUP"
sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$LOCALNET_PROGRAM_ID\")/" "$LIB_RS"

# 3. Build with localnet ID
echo "🔨 Building program with localnet ID..."
anchor build

# 4. Start local validator
echo "🚀 Starting solana-test-validator..."
solana-test-validator --quiet --reset &
VALIDATOR_PID=$!
sleep 6

# Wait for RPC to be ready
for i in {1..30}; do
  if curl -s -X POST "$RPC_URL" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q "ok"; then
    echo "   Validator ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "   ❌ Validator failed to start"
    exit 1
  fi
  sleep 1
done

# 5. Airdrop SOL
echo "💰 Airdropping SOL..."
solana airdrop 100 "$WALLET_PUBKEY" --url "$RPC_URL" --commitment confirmed >/dev/null 2>&1
BALANCE="$(solana balance "$WALLET_PUBKEY" --url "$RPC_URL")"
echo "   Balance: $BALANCE"

# 6. Deploy program
echo "📦 Deploying white_protocol.so to localnet..."
solana program deploy target/deploy/white_protocol.so \
  --program-id "$LOCALNET_KEYPAIR" \
  --url "$RPC_URL" \
  --keypair "$TEMP_WALLET" \
  --commitment confirmed \
  --max-len 2000000

# 7. Restore canonical declare_id! and rebuild for clean working tree
echo "🔧 Restoring canonical declare_id!..."
mv "$LIB_RS_BACKUP" "$LIB_RS"
anchor build >/dev/null 2>&1 || true

# 8. Setup pool / registries / buffer / asset
echo "🏗️  Initializing pool and registries..."
ANCHOR_PROVIDER_URL="$RPC_URL" \
ANCHOR_WALLET="$TEMP_WALLET" \
PROGRAM_ID="$LOCALNET_PROGRAM_ID" \
npx tsx scripts/setup-localnet.ts

# 9. Upload VKs
echo "🔐 Uploading verification keys..."
ANCHOR_PROVIDER_URL="$RPC_URL" \
ANCHOR_WALLET="$TEMP_WALLET" \
PROGRAM_ID="$LOCALNET_PROGRAM_ID" \
npx tsx scripts/upload-vks-localnet.ts

# 10. Run integration test
echo "🧪 Running test-settlement-production.ts..."
ANCHOR_PROVIDER_URL="$RPC_URL" \
ANCHOR_WALLET="$TEMP_WALLET" \
PROGRAM_ID="$LOCALNET_PROGRAM_ID" \
TEST_SLEEP_MS="2000" \
npx tsx tests/test-settlement-production.ts

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ Localnet E2E Complete"
echo "═══════════════════════════════════════════════════════════════"
