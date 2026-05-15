/**
 * Bridge Signer Service Tests — PR-010F
 *
 * Uses deterministic test private keys. NEVER USE IN PRODUCTION.
 */

import { BridgeSignerService } from '../signer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EnvFileSignerAdapter,
  HsmSignerAdapter,
  KmsSignerAdapter,
  LocalDevSignerAdapter,
  MpcSignerAdapter,
  evaluateSigningPolicy,
  type BridgeSigningContext,
} from '../signer';
import { BridgeMessageType, hashBridgeMessageV1 } from '@thewhiteprotocol/core';
import type { BridgeMessageV1 } from '@thewhiteprotocol/core';

// Deterministic test keys — UNSAFE FOR PRODUCTION
const TEST_KEYS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
];

function makeTestMessage(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeMint,
    sourceDomain: 33554434,
    destinationDomain: 33554435,
    sourceChainId: 84532,
    destinationChainId: 11155111,
    canonicalAssetId: '0'.repeat(63) + '1',
    sourceLocalAssetId: '0'.repeat(63) + '1',
    destinationLocalAssetId: '0'.repeat(63) + '1',
    amount: 1000000000000000000n,
    sourceNullifierHash: '0'.repeat(63) + '2',
    destinationCommitment: '0'.repeat(63) + '3',
    sourceRoot: '0'.repeat(63) + '4',
    sourceLeafIndex: 0,
    sourceTxHash: '0'.repeat(63) + '5',
    sourceBlockNumber: 100,
    sourceFinalityBlock: 110,
    nonce: 1,
    deadline: now + 86400,
    relayerFee: 10000000000000000n,
    recipientStealthMetadataHash: '0'.repeat(64),
    memoHash: '0'.repeat(64),
    reserved0: '0'.repeat(64),
    reserved1: '0'.repeat(64),
    ...overrides,
  };
}

function makeSigningContext(
  message: BridgeMessageV1,
  overrides: Partial<BridgeSigningContext> = {}
): BridgeSigningContext {
  return {
    messageHash: hashBridgeMessageV1(message),
    sourceChain: 'base-sepolia',
    destinationChain: 'ethereum-sepolia',
    sourceDomain: message.sourceDomain,
    destinationDomain: message.destinationDomain,
    canonicalAssetId: message.canonicalAssetId,
    amount: message.amount,
    route: 'base-sepolia->ethereum-sepolia',
    riskLevel: 'info',
    dryRun: false,
    signerSetVersion: 1,
    purpose: 'bridge-attestation',
    messageFormat: 'BridgeMessageV1',
    bridgePolicyAccepted: true,
    finalitySatisfied: true,
    routeAllowed: true,
    assetSupported: true,
    amountWithinCap: true,
    openCriticalFindings: 0,
    environment: 'test',
    ...overrides,
  };
}

describe('BridgeSignerService', () => {
  const service = new BridgeSignerService({
    threshold: 2,
    privateKeys: TEST_KEYS,
  });

  test('signs message with all signers', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);

    expect(signatures).toHaveLength(3);
    for (const sig of signatures) {
      expect(sig.signature).toMatch(/^0x[a-f0-9]{130}$/);
      expect(sig.signerAddress).toMatch(/^0x[a-f0-9]{40}$/i);
    }
  });

  test('signatures are sorted by recovered address ascending', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);

    for (let i = 1; i < signatures.length; i++) {
      const prev = signatures[i - 1].signerAddress.toLowerCase();
      const curr = signatures[i].signerAddress.toLowerCase();
      expect(curr > prev).toBe(true);
    }
  });

  test('recovered addresses match expected test addresses', async () => {
    const message = makeTestMessage();
    const messageHash = hashBridgeMessageV1(message) as `0x${string}`;
    const signatures = await service.signMessage(message);

    for (const sig of signatures) {
      const recovered = await service.recoverSigner(messageHash, sig.signature as `0x${string}`);
      expect(recovered.toLowerCase()).toBe(sig.signerAddress.toLowerCase());
    }
  });

  test('takeThreshold returns exactly threshold signatures', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const threshold = service.takeThreshold(signatures);

    expect(threshold).toHaveLength(2);
    expect(threshold[0].signerAddress).toBe(signatures[0].signerAddress);
    expect(threshold[1].signerAddress).toBe(signatures[1].signerAddress);
  });

  test('takeThreshold throws if insufficient signatures', async () => {
    const singleSig = [
      {
        signature: '0x' + '00'.repeat(65),
        signerAddress: '0x0000000000000000000000000000000000000000',
      },
    ];
    expect(() => service.takeThreshold(singleSig)).toThrow('Insufficient signatures');
  });

  test('validateSignatureOrder accepts sorted signatures', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    expect(() => service.validateSignatureOrder(signatures)).not.toThrow();
  });

  test('validateSignatureOrder rejects duplicate signers', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const duped = [...signatures, signatures[0]];
    expect(() => service.validateSignatureOrder(duped)).toThrow('Signatures not sorted');
  });

  test('validateSignatureOrder rejects unsorted signatures', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const reversed = [...signatures].reverse();
    expect(() => service.validateSignatureOrder(reversed)).toThrow('Signatures not sorted');
  });

  test('5-of-7 threshold works', async () => {
    const keys7 = Array.from({ length: 7 }, (_, i) =>
      `0x${(i + 1).toString(16).padStart(64, '0')}`
    );
    const svc7 = new BridgeSignerService({ threshold: 5, privateKeys: keys7 });
    const message = makeTestMessage();
    const signatures = await svc7.signMessage(message);

    expect(signatures).toHaveLength(7);
    const threshold = svc7.takeThreshold(signatures);
    expect(threshold).toHaveLength(5);

    for (let i = 1; i < signatures.length; i++) {
      expect(
        signatures[i].signerAddress.toLowerCase() >
        signatures[i - 1].signerAddress.toLowerCase()
      ).toBe(true);
    }
  });

  test('extractRawSignatures returns hex strings', async () => {
    const message = makeTestMessage();
    const signatures = await service.signMessage(message);
    const raw = service.extractRawSignatures(signatures);

    expect(raw).toHaveLength(3);
    for (const r of raw) {
      expect(r).toMatch(/^0x[a-f0-9]{130}$/);
    }
  });
});

describe('Bridge signer custody adapters', () => {
  test('local-dev signer signs and recovers expected addresses', async () => {
    const message = makeTestMessage();
    const adapter = new LocalDevSignerAdapter({ env: { NODE_ENV: 'test' } });
    const context = makeSigningContext(message, {
      purpose: 'test',
      messageFormat: undefined,
    });
    const signatures = await adapter.signMessageHash(context.messageHash, context);
    const addresses = await adapter.getSignerAddresses();

    expect(signatures).toHaveLength(3);
    expect(signatures.map((sig) => sig.signerAddress.toLowerCase())).toEqual(
      addresses.map((address) => address.toLowerCase())
    );
  });

  test('env-file signer parses test-only temp file', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-signer-env-file-'));
    const keyFile = path.join(stateDir, '.bridge-signers.env');
    fs.writeFileSync(
      keyFile,
      [
        `BRIDGE_SIGNER_1_PRIVATE_KEY=${TEST_KEYS[0]}`,
        `BRIDGE_SIGNER_2_PRIVATE_KEY=${TEST_KEYS[1]}`,
        `BRIDGE_SIGNER_3_PRIVATE_KEY=${TEST_KEYS[2]}`,
      ].join('\n')
    );
    const adapter = new EnvFileSignerAdapter({ keyFile, env: { NODE_ENV: 'test' } });
    const signatures = await adapter.signMessageHash(
      hashBridgeMessageV1(makeTestMessage()),
      makeSigningContext(makeTestMessage())
    );

    expect(await adapter.getSignerAddresses()).toHaveLength(3);
    expect(signatures).toHaveLength(3);
  });

  test('env-file signer never exposes private key in errors', () => {
    const badKey = `0x${'f'.repeat(63)}z`;
    expect(() =>
      new EnvFileSignerAdapter({
        privateKeys: [badKey],
        env: { NODE_ENV: 'test' },
      })
    ).toThrow(/Invalid bridge signer configuration/);

    try {
      new EnvFileSignerAdapter({
        privateKeys: [badKey],
        env: { NODE_ENV: 'test' },
      });
    } catch (err) {
      expect(String(err)).not.toContain(badKey);
    }
  });

  test('production mode rejects local-dev signer', async () => {
    const message = makeTestMessage();
    const adapter = new LocalDevSignerAdapter({
      env: { NODE_ENV: 'production', BRIDGE_SIGNER_MODE: 'local-dev' },
    });
    const decision = await adapter.canSign(
      makeSigningContext(message, { environment: 'production' })
    );

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('local_dev_signer_blocked_in_production');
  });

  test('production mode rejects env-file signer unless explicitly overridden', async () => {
    const message = makeTestMessage();
    const adapter = new EnvFileSignerAdapter({
      privateKeys: TEST_KEYS,
      env: { NODE_ENV: 'production' },
    });

    const blocked = await adapter.canSign(
      makeSigningContext(message, { environment: 'production' })
    );
    const allowed = await adapter.canSign(
      makeSigningContext(message, {
        environment: 'production',
        allowEnvSignerInProduction: true,
      })
    );

    expect(blocked.accepted).toBe(false);
    expect(blocked.reasons).toContain('env_file_signer_blocked_in_production');
    expect(allowed.accepted).toBe(true);
  });

  test('KMS/HSM/MPC placeholders return unavailable safely', async () => {
    for (const adapter of [new KmsSignerAdapter(), new HsmSignerAdapter(), new MpcSignerAdapter()]) {
      const health = await adapter.healthCheck();
      expect(health.ok).toBe(false);
      expect(health.status).toBe('not_implemented');
      await expect(
        adapter.signMessageHash(hashBridgeMessageV1(makeTestMessage()), makeSigningContext(makeTestMessage()))
      ).rejects.toThrow(/not implemented/);
    }
  });

  test('policy gate blocks unsupported route', () => {
    const message = makeTestMessage();
    const decision = evaluateSigningPolicy(
      'env-file',
      makeSigningContext(message, { routeAllowed: false })
    );

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('route_not_allowed');
  });

  test('policy gate blocks signing if finality is not satisfied', () => {
    const message = makeTestMessage();
    const decision = evaluateSigningPolicy(
      'env-file',
      makeSigningContext(message, { finalitySatisfied: false })
    );

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('source_finality_not_satisfied');
  });

  test('policy gate blocks signing if watcher has open critical finding', () => {
    const message = makeTestMessage();
    const decision = evaluateSigningPolicy(
      'env-file',
      makeSigningContext(message, { openCriticalFindings: 1 })
    );

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('open_critical_watcher_finding');
  });

  test('dry-run signing is blocked for bridge attestation and allowed for test purpose', () => {
    const message = makeTestMessage();
    const bridgeDecision = evaluateSigningPolicy(
      'env-file',
      makeSigningContext(message, { dryRun: true })
    );
    const testDecision = evaluateSigningPolicy(
      'env-file',
      makeSigningContext(message, {
        dryRun: true,
        purpose: 'test',
        messageFormat: undefined,
      })
    );

    expect(bridgeDecision.accepted).toBe(false);
    expect(bridgeDecision.reasons).toContain('dry_run_signing_blocked');
    expect(testDecision.accepted).toBe(true);
  });

  test('raw non-BridgeMessageV1 signing context is rejected for bridge attestation', () => {
    const message = makeTestMessage();
    const decision = evaluateSigningPolicy(
      'env-file',
      makeSigningContext(message, { messageFormat: undefined })
    );

    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('message_format_not_bridge_message_v1');
  });

  test('unsupported signing purpose is rejected', () => {
    const message = makeTestMessage();
    const decision = evaluateSigningPolicy(
      'env-file',
      makeSigningContext(message, { purpose: 'unsupported' as any })
    );

    expect(decision.accepted).toBe(false);
    expect(decision.reasons[0]).toMatch(/unsupported_signing_purpose/);
  });
});
