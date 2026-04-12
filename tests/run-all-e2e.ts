/**
 * E2E Test Runner
 * 
 * Runs all E2E tests and prints a comprehensive summary table.
 */

import { main as test01 } from './test-02-withdraw';
import { main as test02 } from './test-03-partial-withdraw';
import { main as test03 } from './test-04-rejections';
import { main as test04 } from './test-05-relayer-http';
import { main as test05 } from './test-06-yield-summary';

interface TestSuite {
  name: string;
  description: string;
  run: () => Promise<any>;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'test-02-withdraw',
    description: 'Withdraw wSOL from settled deposit',
    run: test01,
  },
  {
    name: 'test-03-full-withdraw',
    description: 'Deposit + Settle + Full withdrawal (larger amount)',
    run: test02,
  },
  {
    name: 'test-04-rejections',
    description: 'Double-spend, invalid proof, unsupported asset rejections',
    run: test03,
  },
  {
    name: 'test-05-relayer-http',
    description: 'Withdrawal via relayer HTTP endpoint',
    run: test04,
  },
  {
    name: 'test-06-yield',
    description: 'Yield registry and yield-gated withdrawals',
    run: test05,
  },
];

interface TestResult {
  name: string;
  description: string;
  passed: boolean;
  skipped?: boolean;
  signature?: string;
  error?: string;
  duration: number;
}

async function runTest(suite: TestSuite): Promise<TestResult> {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Running: ${suite.name}`);
  console.log(`Description: ${suite.description}`);
  console.log('='.repeat(70));
  
  const startTime = Date.now();
  
  try {
    const result = await suite.run();
    const duration = Date.now() - startTime;
    
    // Handle array results (for rejection tests)
    if (Array.isArray(result)) {
      const allPassed = result.every(r => r.passed);
      const subTests = result.map(r => `${r.test}: ${r.passed ? 'PASS' : 'FAIL'}`).join(', ');
      
      return {
        name: suite.name,
        description: suite.description,
        passed: allPassed,
        duration,
        error: allPassed ? undefined : `Sub-tests failed: ${subTests}`,
      };
    }
    
    // Handle single test result
    const isSkipped = result.skipped === true || result.error?.includes('SKIPPED');
    return {
      name: suite.name,
      description: suite.description,
      passed: result.passed && !isSkipped, // Don't count skipped as passed
      skipped: isSkipped,
      signature: result.signature,
      error: result.error,
      duration,
    };
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    return {
      name: suite.name,
      description: suite.description,
      passed: false,
      error: error.message || 'Unknown error',
      duration,
    };
  }
}

function printSummaryTable(results: TestResult[]) {
  console.log('\n');
  console.log('╔' + '═'.repeat(68) + '╗');
  console.log('║' + ' '.repeat(20) + 'E2E TEST SUMMARY' + ' '.repeat(32) + '║');
  console.log('╠' + '═'.repeat(68) + '╣');
  console.log('║ Test                          Status    Duration    Tx Signature          ║');
  console.log('╠' + '═'.repeat(68) + '╣');
  
  for (const result of results) {
    const name = result.name.padEnd(29).substring(0, 29);
    const status = result.skipped 
      ? 'SKIPPED'.padEnd(9) 
      : (result.passed ? 'PASS'.padEnd(9) : 'FAIL'.padEnd(9));
    const duration = `${result.duration}ms`.padEnd(10);
    const sig = result.signature 
      ? `${result.signature.substring(0, 12)}...` 
      : (result.error ? 'Error' : '-');
    const sigDisplay = sig.padEnd(19).substring(0, 19);
    
    const statusChar = result.skipped ? '⏭️' : (result.passed ? '✅' : '❌');
    console.log(`║ ${name} ${statusChar} ${status} ${duration} ${sigDisplay} ║`);
  }
  
  console.log('╠' + '═'.repeat(68) + '╣');
  
  const passed = results.filter(r => r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`║ Results: ${passed} passed, ${failed} failed, ${skipped} skipped (Total: ${total})${' '.repeat(20)}║`);
  console.log(`║ Total Duration: ${totalDuration}ms${' '.repeat(45)}║`);
  console.log('╚' + '═'.repeat(68) + '╝');
  
  // Print failed test details
  const failures = results.filter(r => !r.passed && !r.skipped);
  if (failures.length > 0) {
    console.log('\n❌ Failed Tests:');
    for (const failure of failures) {
      console.log(`\n  ${failure.name}:`);
      console.log(`    Error: ${failure.error}`);
    }
  }
  
  // Print skipped test details
  if (skipped > 0) {
    console.log('\n⏭️  Skipped Tests:');
    for (const skip of results.filter(r => r.skipped)) {
      console.log(`  - ${skip.name}: ${skip.error}`);
    }
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              THE WHITE PROTOCOL - E2E TEST SUITE                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  console.log('\nTest Configuration:');
  console.log('  Network: Solana Devnet');
  console.log('  Program: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW');
  console.log('  Pool: EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS');
  
  const results: TestResult[] = [];
  
  for (const suite of TEST_SUITES) {
    const result = await runTest(suite);
    results.push(result);
  }
  
  printSummaryTable(results);
  
  const allPassed = results.every(r => r.passed || r.skipped);
  const hasFailures = results.some(r => !r.passed && !r.skipped);
  
  console.log('\n');
  if (hasFailures) {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  } else if (results.some(r => r.skipped)) {
    console.log('⚠️  ALL TESTS PASSED (with some skipped)');
    process.exit(0);
  } else {
    console.log('✅ ALL TESTS PASSED');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Test runner crashed:', error);
  process.exit(1);
});
