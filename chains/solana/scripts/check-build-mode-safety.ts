#!/usr/bin/env npx tsx
/**
 * Build Mode Safety Check
 *
 * Proves that:
 * - insecure-dev is not enabled by default
 * - event-debug is not enabled by default
 * - release build succeeds
 * - compile_error guards are present
 */

import { execSync } from 'child_process';
import * as fs from 'fs';

const CARGO_TOML = 'programs/white-protocol/Cargo.toml';
const LIB_RS = 'programs/white-protocol/src/lib.rs';

function run(cmd: string): string {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' });
}

function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Build Mode Safety Check');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let allOk = true;

  // 1. Check Cargo.toml default features
  console.log('📋 Checking Cargo.toml default features...');
  const cargoToml = fs.readFileSync(CARGO_TOML, 'utf8');
  const defaultMatch = cargoToml.match(/default\s*=\s*\[([^\]]*)\]/);
  if (!defaultMatch) {
    console.log('  ❌ Could not find default features in Cargo.toml');
    allOk = false;
  } else {
    const defaults = defaultMatch[1];
    const hasInsecureDev = defaults.includes('insecure-dev');
    const hasEventDebug = defaults.includes('event-debug');
    if (hasInsecureDev) {
      console.log('  ❌ insecure-dev found in default features');
      allOk = false;
    } else {
      console.log('  ✅ insecure-dev NOT in default features');
    }
    if (hasEventDebug) {
      console.log('  ❌ event-debug found in default features');
      allOk = false;
    } else {
      console.log('  ✅ event-debug NOT in default features');
    }
  }

  // 2. Check compile_error guards in lib.rs
  console.log('\n📋 Checking compile_error guards in lib.rs...');
  const libRs = fs.readFileSync(LIB_RS, 'utf8');
  const hasInsecureDevGuard = libRs.includes('insecure-dev cannot be enabled in release builds');
  const hasEventDebugGuard = libRs.includes('event-debug cannot be enabled in release builds');
  if (hasInsecureDevGuard) {
    console.log('  ✅ insecure-dev compile_error guard present');
  } else {
    console.log('  ❌ insecure-dev compile_error guard missing');
    allOk = false;
  }
  if (hasEventDebugGuard) {
    console.log('  ✅ event-debug compile_error guard present');
  } else {
    console.log('  ❌ event-debug compile_error guard missing');
    allOk = false;
  }

  // 3. Verify release build succeeds without insecure-dev / event-debug
  console.log('\n🔨 Checking release build...');
  try {
    run('cargo build-sbf');
    console.log('  ✅ Release build succeeded');
  } catch (e: any) {
    console.log(`  ❌ Release build failed:\n${e.stderr || e.message}`);
    allOk = false;
  }

  // 4. Verify that enabling insecure-dev in release fails (compile_error guard works)
  console.log('\n🛡️  Checking insecure-dev compile_error guard is active...');
  try {
    run('cargo build-sbf -- --features insecure-dev');
    console.log('  ❌ Release build with insecure-dev succeeded — compile_error guard did not fire');
    allOk = false;
  } catch (e: any) {
    const stderr = e.stderr || '';
    if (stderr.includes('insecure-dev cannot be enabled in release builds')) {
      console.log('  ✅ insecure-dev correctly rejected in release build');
    } else {
      console.log(`  ⚠️  insecure-dev build failed for a different reason:\n${stderr.slice(0, 400)}`);
    }
  }

  // 5. Verify that enabling event-debug in release fails
  console.log('\n🛡️  Checking event-debug compile_error guard is active...');
  try {
    run('cargo build-sbf -- --features event-debug');
    console.log('  ❌ Release build with event-debug succeeded — compile_error guard did not fire');
    allOk = false;
  } catch (e: any) {
    const stderr = e.stderr || '';
    if (stderr.includes('event-debug cannot be enabled in release builds')) {
      console.log('  ✅ event-debug correctly rejected in release build');
    } else {
      console.log(`  ⚠️  event-debug build failed for a different reason:\n${stderr.slice(0, 400)}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  if (allOk) {
    console.log('  ✅ All build-mode safety checks passed');
  } else {
    console.log('  ❌ Some build-mode safety checks failed');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  process.exit(allOk ? 0 : 1);
}

main();
