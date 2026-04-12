#!/bin/bash
# White Protocol Circuit Compilation Script
# Compiles all Circom circuits and generates proving/verification keys

set -e

echo "==================================="
echo "White Protocol Circuit Compilation"
echo "==================================="

# Check dependencies
if ! command -v circom &> /dev/null; then
    echo "Error: circom not found. Install with: cargo install circom"
    exit 1
fi

if ! command -v snarkjs &> /dev/null; then
    echo "Error: snarkjs not found. Install with: npm install -g snarkjs"
    exit 1
fi

# Create output directory
CIRCUITS_DIR="circuits"
BUILD_DIR="build/circuits"
mkdir -p $BUILD_DIR

# Download powers of tau (if not exists)
PTAU_FILE="$BUILD_DIR/pot20_final.ptau"
if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading Powers of Tau (2^20)..."
    curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau -o $PTAU_FILE
fi

# Function to compile a circuit
compile_circuit() {
    local circuit_name=$1
    local circuit_dir=$2
    
    echo ""
    echo "Compiling $circuit_name..."
    echo "-----------------------------------"
    
    local output_dir="$BUILD_DIR/$circuit_name"
    mkdir -p $output_dir
    
    # Compile circuit
    echo "Step 1: Compiling circuit..."
    circom "$circuit_dir/$circuit_name.circom" \
        --r1cs \
        --wasm \
        --sym \
        -o $output_dir \
        -l node_modules
    
    # Generate witness generation files
    echo "Step 2: Generating witness files..."
    
    # Setup ceremony (Phase 2)
    echo "Step 3: Phase 2 setup..."
    snarkjs groth16 setup \
        "$output_dir/${circuit_name}.r1cs" \
        $PTAU_FILE \
        "$output_dir/${circuit_name}_0000.zkey"
    
    # Contribute to ceremony (single contribution for development)
    echo "Step 4: Contributing to ceremony..."
    snarkjs zkey contribute \
        "$output_dir/${circuit_name}_0000.zkey" \
        "$output_dir/${circuit_name}_final.zkey" \
        --name="White Protocol Development" \
        -v -e="random entropy $(date +%s)"
    
    # Export verification key
    echo "Step 5: Exporting verification key..."
    snarkjs zkey export verificationkey \
        "$output_dir/${circuit_name}_final.zkey" \
        "$output_dir/${circuit_name}_verification_key.json"
    
    # Export Solidity verifier (optional)
    echo "Step 6: Exporting Solidity verifier..."
    snarkjs zkey export solidityverifier \
        "$output_dir/${circuit_name}_final.zkey" \
        "$output_dir/${circuit_name}_verifier.sol"
    
    echo "✓ $circuit_name compiled successfully"
}

# Install circomlib if not present
if [ ! -d "node_modules/circomlib" ]; then
    echo "Installing circomlib..."
    npm install circomlib
fi

# Compile all circuits
echo ""
echo "Starting circuit compilation..."

compile_circuit "deposit" "$CIRCUITS_DIR/deposit"
compile_circuit "withdraw" "$CIRCUITS_DIR/withdraw"
compile_circuit "joinsplit" "$CIRCUITS_DIR/joinsplit"
compile_circuit "membership" "$CIRCUITS_DIR/membership"

echo ""
echo "==================================="
echo "All circuits compiled successfully!"
echo "==================================="
echo ""
echo "Output files:"
echo "  - R1CS:           $BUILD_DIR/*/circuit.r1cs"
echo "  - WASM:           $BUILD_DIR/*/circuit_js/circuit.wasm"
echo "  - Final zkey:     $BUILD_DIR/*/${circuit_name}_final.zkey"
echo "  - Verification:   $BUILD_DIR/*/${circuit_name}_verification_key.json"
echo ""
echo "Next steps:"
echo "1. Run trusted setup ceremony for production"
echo "2. Extract VK and upload to on-chain program"
echo "3. Update SDK with circuit paths"
