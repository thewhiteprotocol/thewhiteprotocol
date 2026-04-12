#!/bin/bash
set -e

CIRCUITS_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_FILE="$BUILD_DIR/powersOfTau28_hez_final_16.ptau"

compile_circuit() {
    local name=$1
    local path=$2
    echo "=== Compiling $name ==="
    
    # Compile
    circom "$path" --r1cs --wasm --sym -o "$BUILD_DIR" -l "$CIRCUITS_DIR/node_modules"
    
    # Generate zkey (proving key)
    snarkjs groth16 setup "$BUILD_DIR/${name}.r1cs" "$PTAU_FILE" "$BUILD_DIR/${name}_0000.zkey"
    
    # Contribute to ceremony (for production, use proper MPC)
    echo "white-protocol-contribution" | snarkjs zkey contribute "$BUILD_DIR/${name}_0000.zkey" "$BUILD_DIR/${name}.zkey" --name="white"
    
    # Export verification key
    snarkjs zkey export verificationkey "$BUILD_DIR/${name}.zkey" "$BUILD_DIR/${name}_vk.json"
    
    # Cleanup intermediate file
    rm -f "$BUILD_DIR/${name}_0000.zkey"
    
    echo "✓ $name compiled"
    echo ""
}

# Compile each circuit
compile_circuit "deposit" "$CIRCUITS_DIR/deposit/deposit.circom"
compile_circuit "withdraw" "$CIRCUITS_DIR/withdraw/withdraw.circom"
compile_circuit "withdraw_v2" "$CIRCUITS_DIR/withdraw_v2/withdraw_v2.circom"
compile_circuit "membership" "$CIRCUITS_DIR/membership/membership.circom"

echo "=== Build Complete ==="
ls -lh "$BUILD_DIR"/*.zkey "$BUILD_DIR"/*_vk.json 2>/dev/null
