/**
 * E2E Double-spend test — Group 9 verification
 */
import * as fs from 'fs';
import * as path from 'path';

const RELAYER_URL = 'http://localhost:3000';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  E2E DOUBLE-SPEND TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load the same withdrawal payload from the first attempt
  const resultPath = path.join(__dirname, 'e2e-withdraw-result.json');
  if (!fs.existsSync(resultPath)) {
    console.error('❌ No withdrawal result found. Run e2e-withdraw-via-relayer.ts first.');
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  const { proofData, merkleRoot, nullifierHash, recipient, amount, assetId, mint } = payload;

  console.log('📤 Re-submitting SAME withdrawal to relayer...');
  const res = await fetch(`${RELAYER_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofData, merkleRoot, nullifierHash, recipient, amount, assetId, mint, chain: 'solana' }),
  });
  const result = await res.json();
  console.log('   Response:', JSON.stringify(result, null, 2));

  if (!result.success && (result.error?.includes('spent') || result.error?.includes('Nullifier'))) {
    console.log('\n✅ DOUBLE-SPEND CORRECTLY REJECTED');
  } else if (!result.success) {
    console.log('\n⚠️ Rejected for other reason:', result.error);
  } else {
    console.log('\n❌ DOUBLE-SPEND ACCEPTED — BUG!');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
