#!/usr/bin/env npx tsx
/**
 * IDL Drift Check
 *
 * Runs `anchor build` and compares the generated IDL against the committed
 * target/idl/white_protocol.json. Fails if they differ.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';

const IDL_PATH = 'target/idl/white_protocol.json';
const IDL_BACKUP = 'target/idl/white_protocol.json.committed';

function run(cmd: string) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' });
}

function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  IDL Drift Check');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(IDL_PATH)) {
    console.log(`  ❌ Committed IDL not found at ${IDL_PATH}`);
    process.exit(1);
  }

  // Backup committed IDL
  fs.copyFileSync(IDL_PATH, IDL_BACKUP);

  try {
    // Build to regenerate IDL
    console.log('🔨 Running anchor build...');
    run('anchor build');
  } catch (e: any) {
    console.log(`  ❌ anchor build failed:\n${e.stderr || e.message}`);
    // Restore backup
    fs.copyFileSync(IDL_BACKUP, IDL_PATH);
    fs.unlinkSync(IDL_BACKUP);
    process.exit(1);
  }

  const committed = fs.readFileSync(IDL_BACKUP, 'utf8');
  const generated = fs.readFileSync(IDL_PATH, 'utf8');

  // Restore committed IDL so the working tree stays clean
  fs.copyFileSync(IDL_BACKUP, IDL_PATH);
  fs.unlinkSync(IDL_BACKUP);

  const committedObj = JSON.parse(committed);
  const generatedObj = JSON.parse(generated);

  // Strip metadata.generatedAt / metadata.solanaVersion / metadata.anchorVersion
  // because these change on every build even when IDL is semantically identical
  const stripVolatile = (obj: any) => {
    const copy = JSON.parse(JSON.stringify(obj));
    if (copy.metadata) {
      delete copy.metadata.generatedAt;
      delete copy.metadata.solanaVersion;
      delete copy.metadata.anchorVersion;
    }
    return copy;
  };

  const a = JSON.stringify(stripVolatile(committedObj), null, 2);
  const b = JSON.stringify(stripVolatile(generatedObj), null, 2);

  if (a === b) {
    console.log('  ✅ IDL is up to date (no drift detected)');
    process.exit(0);
  } else {
    console.log('  ❌ IDL drift detected!');
    console.log('\n  Committed vs generated IDL differ after stripping volatile metadata.');
    console.log('  Run `anchor build` locally and commit the updated IDL if the changes are intentional.\n');
    process.exit(1);
  }
}

main();
