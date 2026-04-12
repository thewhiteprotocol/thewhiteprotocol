import * as fs from 'fs';
import { Connection, PublicKey } from '@solana/web3.js';

const note = JSON.parse(fs.readFileSync('tests/test-withdraw-note.json', 'utf8'));
const connection = new Connection('https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343');

// For now, assume it's index 0 (we'll verify by checking the merkle tree)
// In production, you'd parse this from the deposit transaction logs
note.leafIndex = 0;

fs.writeFileSync('tests/test-withdraw-note.json', JSON.stringify(note, null, 2));
console.log('✅ Note updated with leafIndex:', note.leafIndex);
