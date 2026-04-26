import { initializePoseidon, computeNullifierHash } from '/workspaces/thewhiteprotocol/app/src/lib/crypto';
import { groth16 } from 'snarkjs';

async function main() {
  await initializePoseidon();
  const secret = 123456789n;
  const nullifier = 987654321n;
  const amount = 100000000n;
  const assetId = 130791479295199346958809817019194769528730469493319110402711670723487367904n;
  const leafIndex = 0n;
  const merkleRoot = 12345n;
  const pathElements = Array(20).fill(0n);
  const pathIndices = Array(20).fill(0);
  const recipient = 11111111111111111111111111111111n;
  const relayer = 22222222222222222222222222222222n;
  const relayerFee = 50000n;

  const nullifierHash = computeNullifierHash(nullifier, secret, leafIndex);

  const witness = {
    secret: secret.toString(),
    nullifier: nullifier.toString(),
    amount: amount.toString(),
    asset_id: assetId.toString(),
    leaf_index: leafIndex.toString(),
    merkle_root: merkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    merkle_path: pathElements.map((e) => e.toString()),
    merkle_path_indices: pathIndices,
    recipient: recipient.toString(),
    relayer: relayer.toString(),
    relayer_fee: relayerFee.toString(),
    public_data_hash: "0",
  };

  console.log('Witness keys:', Object.keys(witness).sort());
  console.log('Generating withdraw proof...');
  try {
    const wasmPath = '/workspaces/thewhiteprotocol/app/public/circuits/withdraw/withdraw.wasm';
    const zkeyPath = '/workspaces/thewhiteprotocol/app/public/circuits/withdraw/withdraw.zkey';
    const { proof, publicSignals } = await groth16.fullProve(witness, wasmPath, zkeyPath);
    console.log('✅ Proof generated successfully!');
    console.log('Public signals count:', publicSignals.length);
    console.log('Public signals:', publicSignals.map((s: any) => BigInt(s).toString()));
  } catch (err: any) {
    console.error('❌ Proof generation failed:', err.message);
    process.exit(1);
  }
}

main();
