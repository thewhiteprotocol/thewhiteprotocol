import { buildPoseidon } from "circomlibjs";

const poseidon = await buildPoseidon();
const F = poseidon.F;

// Inputs: secret, nullifier, amount, asset_id
const secret = 12345n;
const nullifier = 67890n;
const amount = 1000000000n;
const asset_id = 0n;

// Poseidon(secret, nullifier, amount, asset_id)
const commitment = poseidon([secret, nullifier, amount, asset_id]);
const commitmentStr = F.toString(commitment, 10);

console.log("Commitment:", commitmentStr);

// Output full input JSON
const input = {
    commitment: commitmentStr,
    amount: amount.toString(),
    asset_id: asset_id.toString(),
    secret: secret.toString(),
    nullifier: nullifier.toString()
};

console.log("\nFull input JSON:");
console.log(JSON.stringify(input, null, 2));
