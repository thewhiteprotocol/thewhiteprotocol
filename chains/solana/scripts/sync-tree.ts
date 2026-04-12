/**
 * Sync local Merkle tree state from on-chain data
 */
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const idl = JSON.parse(fs.readFileSync('target/idl/white_protocol.json', 'utf8'));
const program = new anchor.Program(idl, provider);
const { PublicKey } = anchor.web3;

const PROGRAM_ID = new PublicKey('BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb');
const POOL = new PublicKey('DPZe7uST1mBxzVkEm215epHjsM7Sa8VCXHr3pv4eLp8X');
const MERKLE = new PublicKey('3NPUEWkbkyv7XDjVg98CWmkUz1XFNZ6ogqi18AiTnqgm');

// Fetch deposit events to reconstruct tree
async function main() {
  // Get transaction signatures for the program
  const sigs = await provider.connection.getSignaturesForAddress(POOL, { limit: 20 });
  console.log('Found', sigs.length, 'transactions');
  
  const commitments: string[] = [];
  
  for (const sig of sigs) {
    const tx = await provider.connection.getTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0
    });
    
    if (tx?.meta?.logMessages) {
      for (const log of tx.meta.logMessages) {
        // Look for commitment in logs
        if (log.includes('commitment') || log.includes('Commitment')) {
          console.log('Found:', log);
        }
      }
    }
  }
  
  // Get merkle tree state
  const tree = await program.account.merkleTreeV2.fetch(MERKLE);
  console.log('\nMerkle tree state:');
  console.log('  nextLeafIndex:', tree.nextLeafIndex);
  console.log('  root:', Buffer.from(tree.currentRoot).toString('hex'));
}

main().catch(console.error);
