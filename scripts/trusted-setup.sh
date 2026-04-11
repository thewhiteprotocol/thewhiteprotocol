#!/bin/bash
# White Protocol Trusted Setup Ceremony Script
# For production deployment, this ceremony must be performed with multiple participants

set -e

echo "============================================"
echo "White Protocol Trusted Setup Ceremony
echo "============================================"
echo ""
echo "WARNING: This is a multi-party computation ceremony."
echo "For production, ensure:"
echo "  1. Multiple independent participants contribute"
echo "  2. At least one participant destroys their entropy"
echo "  3. Contributions are verified and recorded"
echo ""

BUILD_DIR="build/circuits"
CEREMONY_DIR="ceremony"
mkdir -p $CEREMONY_DIR

# Check if circuits are compiled
if [ ! -d "$BUILD_DIR" ]; then
    echo "Error: Circuits not compiled. Run 'npm run build:circuits' first."
    exit 1
fi

# Function to run ceremony for a circuit
run_ceremony() {
    local circuit_name=$1
    local num_contributions=$2
    
    echo ""
    echo "Running ceremony for $circuit_name..."
    echo "-------------------------------------------"
    
    local circuit_dir="$BUILD_DIR/$circuit_name"
    local ceremony_dir="$CEREMONY_DIR/$circuit_name"
    mkdir -p $ceremony_dir
    
    # Initial zkey
    local current_zkey="$circuit_dir/${circuit_name}_0000.zkey"
    
    # Multiple contributions
    for i in $(seq 1 $num_contributions); do
        local next_zkey="$ceremony_dir/${circuit_name}_$(printf "%04d" $i).zkey"
        
        echo "Contribution $i/$num_contributions..."
        
        # In production, each participant runs this independently
        # with their own entropy source
        snarkjs zkey contribute \
            $current_zkey \
            $next_zkey \
            --name="Participant $i" \
            -v -e="$(head -c 64 /dev/urandom | xxd -p)"
        
        current_zkey=$next_zkey
    done
    
    # Apply random beacon (e.g., from a future Bitcoin block hash)
    echo "Applying random beacon..."
    local final_zkey="$ceremony_dir/${circuit_name}_final.zkey"
    
    # In production, use an actual random beacon
    # For development, we use a placeholder
    snarkjs zkey beacon \
        $current_zkey \
        $final_zkey \
        "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20" \
        10 \
        --name="Final Beacon"
    
    # Verify the final zkey
    echo "Verifying final zkey..."
    snarkjs zkey verify \
        "$circuit_dir/${circuit_name}.r1cs" \
        "build/circuits/pot20_final.ptau" \
        $final_zkey
    
    # Export verification key
    echo "Exporting verification key..."
    snarkjs zkey export verificationkey \
        $final_zkey \
        "$ceremony_dir/${circuit_name}_vkey.json"
    
    # Generate Rust verification key format
    echo "Generating Rust VK format..."
    node scripts/export-vk-rust.js \
        "$ceremony_dir/${circuit_name}_vkey.json" \
        "$ceremony_dir/${circuit_name}_vkey.rs"
    
    echo "✓ Ceremony complete for $circuit_name"
}

# Number of contributions (increase for production)
NUM_CONTRIBUTIONS=${1:-3}

echo "Running with $NUM_CONTRIBUTIONS contributions per circuit"
echo ""

# Run ceremony for each circuit
run_ceremony "deposit" $NUM_CONTRIBUTIONS
run_ceremony "withdraw" $NUM_CONTRIBUTIONS
run_ceremony "joinsplit" $NUM_CONTRIBUTIONS
run_ceremony "membership" $NUM_CONTRIBUTIONS

echo ""
echo "============================================"
echo "Trusted Setup Ceremony Complete!"
echo "============================================"
echo ""
echo "Output files in: $CEREMONY_DIR/"
echo ""
echo "For production:"
echo "1. Upload *_vkey.rs to programs/white-protocol/src/crypto/"
echo "2. Run set_verification_key for each proof type"
echo "3. Lock verification keys when ready"
echo ""
echo "IMPORTANT: Securely delete all intermediate zkey files"
echo "and entropy sources after verification."
