#!/usr/bin/env npx tsx
/**
 * Circuit/Proof Artifact Sanity Check
 *
 * Verifies that required circuit artifacts exist and are compatible
 * with the Solana settlement test path.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../..');

interface ArtifactCheck {
  name: string;
  paths: string[];
  minSizeBytes?: number;
}

const CHECKS: ArtifactCheck[] = [
  {
    name: 'deposit circuit (zkey)',
    paths: ['circuits/deposit/build/deposit.zkey'],
    minSizeBytes: 100_000,
  },
  {
    name: 'deposit circuit (wasm)',
    paths: ['circuits/deposit/build/deposit_js/deposit.wasm'],
    minSizeBytes: 1_000_000,
  },
  {
    name: 'deposit verification key',
    paths: ['circuits/deposit/build/deposit_vk.json'],
    minSizeBytes: 1_000,
  },
  {
    name: 'withdraw circuit (zkey)',
    paths: ['circuits/withdraw/build/withdraw.zkey'],
    minSizeBytes: 100_000,
  },
  {
    name: 'withdraw circuit (wasm)',
    paths: ['circuits/withdraw/build/withdraw_js/withdraw.wasm'],
    minSizeBytes: 1_000_000,
  },
  {
    name: 'withdraw verification key',
    paths: ['circuits/withdraw/build/withdraw_vk.json'],
    minSizeBytes: 1_000,
  },
  {
    name: 'merkle_batch_update circuit (zkey)',
    paths: ['circuits/merkle_batch_update/build/merkle_batch_update.zkey'],
    minSizeBytes: 1_000_000,
  },
  {
    name: 'merkle_batch_update circuit (wasm)',
    paths: ['circuits/merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm'],
    minSizeBytes: 1_000_000,
  },
  {
    name: 'merkle_batch_update verification key',
    paths: ['circuits/merkle_batch_update/build/verification_key.json'],
    minSizeBytes: 1_000,
  },
];

function checkArtifacts(): boolean {
  let allOk = true;
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Circuit/Proof Artifact Sanity Check');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const check of CHECKS) {
    const fullPaths = check.paths.map(p => path.join(ROOT, p));
    const found = fullPaths.find(p => fs.existsSync(p));
    if (!found) {
      console.log(`  ❌ ${check.name}: not found (looked for ${check.paths.join(', ')})`);
      allOk = false;
      continue;
    }
    const stats = fs.statSync(found);
    if (check.minSizeBytes && stats.size < check.minSizeBytes) {
      console.log(`  ❌ ${check.name}: ${found} size ${stats.size} < min ${check.minSizeBytes}`);
      allOk = false;
      continue;
    }
    console.log(`  ✅ ${check.name}: ${found} (${stats.size} bytes)`);
  }

  // Check VK consistency between upload script and disk
  console.log('\n  VK Upload Script Consistency:');
  const uploadScriptPath = path.join(ROOT, 'chains/solana/scripts/upload-vks-localnet.ts');
  if (!fs.existsSync(uploadScriptPath)) {
    console.log(`    ❌ upload-vks-localnet.ts not found`);
    allOk = false;
  } else {
    const uploadSrc = fs.readFileSync(uploadScriptPath, 'utf8');
    const vkFileRefs = [
      { name: 'deposit VK', path: '../../circuits/deposit/build/deposit_vk.json' },
      { name: 'withdraw VK', path: '../../circuits/withdraw/build/withdraw_vk.json' },
      { name: 'merkle_batch_update VK', path: '../../circuits/merkle_batch_update/build/verification_key.json' },
    ];
    for (const ref of vkFileRefs) {
      const expectedPath = path.resolve(path.join(ROOT, 'chains/solana'), ref.path);
      if (uploadSrc.includes(ref.path)) {
        if (fs.existsSync(expectedPath)) {
          console.log(`    ✅ ${ref.name} referenced and exists`);
        } else {
          console.log(`    ❌ ${ref.name} referenced but missing at ${expectedPath}`);
          allOk = false;
        }
      } else {
        console.log(`    ⚠️  ${ref.name} not referenced in upload script`);
      }
    }
  }

  // Check merkle_batch_update maxBatch parameter
  console.log('\n  MerkleBatchUpdate Circuit Parameters:');
  const circuitPath = path.join(ROOT, 'circuits/merkle_batch_update/merkle_batch_update.circom');
  if (fs.existsSync(circuitPath)) {
    const circuitSrc = fs.readFileSync(circuitPath, 'utf8');
    const mainMatch = circuitSrc.match(/MerkleBatchUpdate\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (mainMatch) {
      const depth = mainMatch[1];
      const maxBatch = mainMatch[2];
      console.log(`    ✅ depth=${depth}, maxBatch=${maxBatch}`);
      if (maxBatch !== '1') {
        console.log(`    ⚠️  maxBatch=${maxBatch} differs from expected 1 — upload scripts / tests may need adjustment`);
      }
    } else {
      console.log(`    ⚠️  Could not parse MerkleBatchUpdate parameters`);
    }
  } else {
    console.log(`    ❌ Circuit source not found: ${circuitPath}`);
    allOk = false;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  if (allOk) {
    console.log('  ✅ All circuit artifact checks passed');
  } else {
    console.log('  ❌ Some circuit artifact checks failed');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  return allOk;
}

const ok = checkArtifacts();
process.exit(ok ? 0 : 1);
