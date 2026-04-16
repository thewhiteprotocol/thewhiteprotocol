#!/bin/bash
set -e

# Setup script to copy compiled ZK circuits into the flat directory structure
# expected by the White Protocol relayer.
#
# Usage:
#   From repo root: bash tools/setup-relayer-circuits.sh
#   From relayer/:  bash ../tools/setup-relayer-circuits.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$REPO_ROOT/circuits"
TARGET_DIR="$REPO_ROOT/relayer/circuits/build"

echo "Setting up relayer circuits..."
echo "Source: $SOURCE_DIR"
echo "Target: $TARGET_DIR"

mkdir -p "$TARGET_DIR/deposit_js"
mkdir -p "$TARGET_DIR/withdraw_js"

# Deposit circuit
cp "$SOURCE_DIR/deposit/build/deposit_js/deposit.wasm" "$TARGET_DIR/deposit_js/"
cp "$SOURCE_DIR/deposit/build/deposit.zkey" "$TARGET_DIR/"
cp "$SOURCE_DIR/deposit/build/deposit_vk.json" "$TARGET_DIR/"

# Withdraw circuit
cp "$SOURCE_DIR/withdraw/build/withdraw_js/withdraw.wasm" "$TARGET_DIR/withdraw_js/"
cp "$SOURCE_DIR/withdraw/build/withdraw.zkey" "$TARGET_DIR/"
cp "$SOURCE_DIR/withdraw/build/withdraw_vk.json" "$TARGET_DIR/"

echo "✅ Circuits copied to $TARGET_DIR"
ls -la "$TARGET_DIR"
