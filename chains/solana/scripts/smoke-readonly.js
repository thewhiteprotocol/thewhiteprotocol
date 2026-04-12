const { Connection, PublicKey } = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const ACCOUNTS = {
  poolConfig: 'iWMNRMHKS6zFKaNX1WkCBD3vsdnW4L24qd5Cp7sgLRV',
  merkleTree: 'BhyDXxA7WT5WX7WgbGvqThpUjK8QXDSk891nhfKd32Lv',
  pendingBuffer: '3K1GH9JUmoigMu7UTRYmDX9YZ7ZeeHq3r1cVZfKyzzMR',
  vkDeposit: '7fAauFUS9k2bp3RBnnmerD1yRMF3jhngq7WNn97wyvXJ',
  vkWithdraw: '9y4oNNV4P1Fq9eDPvwMxPEjB7poGp3txroDivEUieHkB',
  vkWithdrawV2: 'En7LSSi3uMESNuAGD2megTqris8UYDHVuk2U6kmuqcxL',
  vkMerkleBatch: '5wGtGdmq5qNw2EWUkixgkAe7vj6feP2MAkZPzZgnjc7y',
  relayerRegistry: '22c3UpZycheaz2jbWKWbVGhMAH3e94fUz5BvDg8x1kqA',
  relayerNodeAuthority: 'HXKHa5RLF8rjnxsHFZYn5kET9VSkYC4sLT1Yp64Ggt5E',
  relayerNodeRelayer: 'BfYUSQCjeLHA8K9ytGqYWo1RA14JWXhexwXkWf78HkZV',
};

async function main() {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  let passed = 0, failed = 0;

  console.log('=== POOL V8 READONLY SMOKE TEST ===\n');

  for (const [name, addr] of Object.entries(ACCOUNTS)) {
    const pk = new PublicKey(addr);
    const info = await conn.getAccountInfo(pk);
    
    if (!info) {
      console.log(`❌ ${name}: NOT FOUND`);
      failed++;
      continue;
    }

    const ownerOk = info.owner.equals(PROGRAM_ID);
    const status = ownerOk ? '✅' : '⚠️';
    console.log(`${status} ${name}: exists, ${info.data.length} bytes, owner=${info.owner.toBase58().slice(0,8)}...`);
    
    if (ownerOk) passed++; else failed++;
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
