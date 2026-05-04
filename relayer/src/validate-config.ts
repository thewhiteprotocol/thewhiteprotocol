/**
 * Standalone config validation script for The White Protocol relayer.
 * Run with: tsx src/validate-config.ts
 */
import { validateConfig } from './config';

const result = validateConfig();

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  The White Protocol Relayer — Config Validation');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`Live chains: ${result.liveChains.join(', ') || '(none)'}`);
console.log(`Status: ${result.ok ? '✅ OK' : '❌ FAILED'}\n`);

if (result.warnings.length > 0) {
  console.log('Warnings:');
  for (const w of result.warnings) {
    console.log(`  ⚠️  ${w}`);
  }
  console.log('');
}

if (result.errors.length > 0) {
  console.log('Errors:');
  for (const e of result.errors) {
    console.log(`  ❌ ${e}`);
  }
  console.log('');
}

process.exit(result.ok ? 0 : 1);
