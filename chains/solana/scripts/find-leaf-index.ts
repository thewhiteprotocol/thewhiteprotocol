import * as fs from 'fs';

const notePath = './tests/test-withdraw-note.json';
const statePath = './data/sequencer-state.json';

if (!fs.existsSync(statePath)) {
  console.log('❌ Sequencer state file not found');
  process.exit(1);
}

const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

console.log('Note commitment (decimal):', note.commitment);

// Convert note commitment to hex
const noteCommitmentBigInt = BigInt(note.commitment);
const noteCommitmentHex = noteCommitmentBigInt.toString(16).padStart(64, '0');
console.log('Note commitment (hex):', noteCommitmentHex);

console.log('\nSequencer state commitments:');
state.commitments.forEach((c: string, i: number) => {
  console.log(`  [${i}] ${c}`);
});

// Find index
const idx = state.commitments.findIndex((c: string) => {
  const stateHex = c.toLowerCase().replace(/^0x/, '');
  const noteHex = noteCommitmentHex.toLowerCase();
  return stateHex === noteHex;
});

if (idx === -1) {
  console.log('\n❌ Commitment NOT FOUND in sequencer state');
  console.log('   Note commitment hex:', noteCommitmentHex);
  console.log('   State commitments:', state.commitments);
  process.exit(2);
}

console.log('\n✅ Found commitment at index:', idx);

// Update note
note.leafIndex = idx;
note.settled = true;
note.pending = false;
fs.writeFileSync(notePath, JSON.stringify(note, null, 2));
console.log('✅ Note updated with leafIndex:', idx);
