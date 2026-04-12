#!/bin/bash
set -euo pipefail

echo "=== VERIFYING STAGE A CRITICAL FIXES ==="
echo ""

FAIL=0

check() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  if grep -qE "$pattern" "$file" 2>/dev/null; then
    echo "✅ $name"
  else
    echo "❌ $name"
    FAIL=$((FAIL+1))
  fi
}

echo "### SDK (sdk/src/client.ts) ###"
check "Deposit: checks ATA existence" "sdk/src/client.ts" "userTokenAccountInfo.*await.*getAccountInfo"
check "Deposit: creates ATA if missing" "sdk/src/client.ts" "createAssociatedTokenAccountInstruction"
check "Deposit: wraps SOL with transfer" "sdk/src/client.ts" "SystemProgram\.transfer"
check "Deposit: syncNative for wSOL" "sdk/src/client.ts" "createSyncNativeInstruction"
check "Deposit: proof as Buffer" "sdk/src/client.ts" "Buffer\.from\(proofData\)"
check "Deposit: preInstructions applied" "sdk/src/client.ts" "\.preInstructions\(preInstructions\)"

check "Withdraw: recipient ATA check" "sdk/src/client.ts" "recipientAccountInfo.*await.*getAccountInfo"
check "Withdraw: relayer ATA check" "sdk/src/client.ts" "relayerAccountInfo.*await.*getAccountInfo"
check "Withdraw: proof as Buffer" "sdk/src/client.ts" "Buffer\.from\(proofData\)"
check "Withdraw: preInstructions applied" "sdk/src/client.ts" "\.preInstructions\(preInstructions\)"

echo ""
echo "### Working E2E test (tests/test-withdraw-e2e-fixed.ts) ###"
check "Test: big-endian bytes32" "tests/test-withdraw-e2e-fixed.ts" "bytes\[31 - i\]"
check "Test: publicDataHash = 0n" "tests/test-withdraw-e2e-fixed.ts" "publicDataHash.*=.*0n"
check "Test: Merkle tree depth 20" "tests/test-withdraw-e2e-fixed.ts" "new MerkleTree\(20\)"

echo ""
echo "### Registry & Sequencer ###"
check "Registry: compliance seed" "scripts/init-relayer-registry.ts" "Buffer\.from\('compliance'\)"
check "Sequencer: POOL_CONFIG" "scripts/sequencer-production.ts" "GZiRVMV7FjrGxjE379HiEyHyVCisHkFnjMJen95kEVEQ"
check "Sequencer: MERKLE_TREE" "scripts/sequencer-production.ts" "GCG4QojHbjs15ucxHfW9G1bFzYyYZGzsvWRNEAj6pckk"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ ALL STAGE A FIXES VERIFIED"
else
  echo "❌ $FAIL checks failed"
  exit 1
fi
