import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BridgeMessageType,
  encodeBridgeMessageV1,
  hashBridgeMessageV1,
  type BridgeMessageV1,
} from '@thewhiteprotocol/core';
import {
  decodeSolanaBridgeMessageV1InstructionData,
  solanaSourceObservationFromFixture,
  SolanaSourceAdapter,
} from '../solana-source-adapter';
import { fixtureFromSolanaBridgeOutInstruction } from '../solana-to-base-fixture-from-tx';
import { SOLANA_DEVNET_PROGRAM_ID } from '../base-to-solana-route';
import type { BridgeEventObservation } from '../types';

function hex(byte: string): string {
  return byte.repeat(32);
}

function message(overrides: Partial<BridgeMessageV1> = {}): BridgeMessageV1 {
  const now = Math.floor(Date.now() / 1000);
  return {
    protocolVersion: 1,
    messageType: BridgeMessageType.BridgeOut,
    sourceDomain: 0x01000002,
    destinationDomain: 0x02000002,
    sourceChainId: 0,
    destinationChainId: 84532,
    canonicalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    sourceLocalAssetId: '004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0',
    destinationLocalAssetId: '00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70',
    amount: 1_000_000n,
    sourceNullifierHash: hex('14'),
    destinationCommitment: hex('15'),
    sourceRoot: hex('16'),
    sourceLeafIndex: 5,
    sourceTxHash: hex('17'),
    sourceBlockNumber: 461_200_000,
    sourceFinalityBlock: 461_200_032,
    nonce: 1778328126,
    deadline: now + 86_400,
    relayerFee: 0n,
    recipientStealthMetadataHash: hex('00'),
    memoHash: hex('00'),
    reserved0: hex('00'),
    reserved1: hex('00'),
    ...overrides,
  };
}

function encoded(messageValue: BridgeMessageV1): string {
  return `0x${Array.from(encodeBridgeMessageV1(messageValue))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

describe('Solana source adapter', () => {
  test('marks bridge_out_v1_with_proof as source-bound and non-secret', () => {
    const sourceMessage = message();
    const observation = solanaSourceObservationFromFixture({
      instruction: 'bridge_out_v1_with_proof',
      sourceBoundProofMarker: 'bridge_out_v1_with_proof',
      encodedMessage: encoded(sourceMessage),
      signature: 'BQNRKsUFX5ttshDzZcjtqecsUJjt6cbvURtQtcqX4K7edtmTsNnK5kbNM3hjBwSUtwq2MQfDXhs8SKjP96S3QDQ',
      slot: sourceMessage.sourceBlockNumber,
      confirmations: 40,
    });

    expect(observation.messageHash).toBe(hashBridgeMessageV1(sourceMessage));
    expect(observation.sourceEventKind).toBe('solana_bridge_out_v1_with_proof');
    expect(observation.sourceBoundProofMarker).toBe('bridge_out_v1_with_proof');
    expect(observation.sourceAddress).toBe(SOLANA_DEVNET_PROGRAM_ID);
    expect(JSON.stringify(
      observation,
      (_key, value) => typeof value === 'bigint' ? value.toString() : value
    )).not.toMatch(/private|secret|token|witness/i);
  });

  test('marks init_bridge_v1_out as unsafe for policy rejection', () => {
    const observation = solanaSourceObservationFromFixture({
      instruction: 'init_bridge_v1_out',
      message: message(),
      confirmations: 40,
    });

    expect(observation.sourceEventKind).toBe('solana_init_bridge_v1_out');
    expect(observation.sourceBoundProofMarker).toBeUndefined();
  });

  test('does not invent a source-bound proof marker for incomplete historical fixtures', () => {
    const observation = solanaSourceObservationFromFixture({
      instruction: 'bridge_out_v1_with_proof',
      message: message(),
      confirmations: 40,
    });

    expect(observation.sourceEventKind).toBe('solana_bridge_out_v1_with_proof');
    expect(observation.sourceBoundProofMarker).toBeUndefined();
  });

  test('decodes the PR-010Z historical instruction message without secrets', () => {
    const bs58 = require('bs58');
    const instructionData =
      'BZkFV13tVauQ1GGDyzcZoyKB6WBrHWkZsfaqQniE97zPXbgrKYUTP4fuAHnSsYbwBafpE5PHjUMcELad14qiKmSyo9Vvd1Hp7MkT9Yb7DVgMiWfcDKFa6ivi8w5GqUPMKfuGT7aEzV7FwjNKCqqTXEYQztU9gL4PQXibJso8VpvMfpxFzjnnk7dwXyVrMJ7gMhzZJRPg28dtMXAiWv5oYdN1ZnMZ1jX5ASC4rT948ZoKqskDPcqd7JS8es1ScWKdTk1KXs39PsUEvcN4tVhCVxJWeuoeDRhtHk6EgYfud3JJuhekXqfQbHNhyP4T9FrDpHaZzQ1pK4XxekakGExzN5mZBo3aPDhpdiwu9uTmKPUK8q4tiugXXsvKdxsoTboTZuUadTe1YtDDweZa4PiGrVkjKz9SroMuUifyVSfXQkJDMASF8d8Az4GkKkpYt5nXLfZBTmMxKLC4S3asrD5aHJMp7BwkS9Ddz1kui4jVK45eHziH3mtoyDnNRAx57gTeFf7Sj3MdYVeZuG7bf3pABscSkFSpHQwYEuod55fxnM6veBSNJJkoZMvNC5tGpmTakVV4WgGnn2hPnJzXMbD6Ydf88eqL1osyjUqvsvBooj1WyHAwVUg5ZP6UQiUHrLSbrcVX6tqExU1jQH5GdGxDPAbfwYJjpoZTXJ1siSeCuWx6UdEgCZS3zZNUfyCQw5YcKEMd3bMB1bPahdirG3eYHu4qQRjt6V4nA8tSGSVvEazJd5FcZe3viXZWvU4jUw5DwHUiAgMuNsFxjfYwTHTyEjBwRL7E6PzFNvf9mSG8RR45LvWgykiN5pGjw8AdWSGmmjWtqBvMMpJMxExzySPmtRz9ehbD8BLr1Qdk9qpWCrxkCXMk1NUfSm5hMcee3H2zc38jLzSer1gmnkRQCaL3ENShdm6TKCMr7ZRASLQT4sX75axQufj786rPbWmM2QNwoLKS59r64FaJzVwwp98PTLLqwdkSbqaWTn3JRmXs6fMA7k68JYGWZSKMDYPv8tn8387A1W27xpcbbApuZ8LvHtrJrJcuoECHqaTcsGs4H4K2KyGpDJeUXgg3NwZ2aj6j7U3deyhPsabcng9yimW34iXm65oUqxEYWEiyM2YGSwYY6esWNmapXTX7tsG9ggAFrk58Cz27fmp7a8Fd';
    const decoded = decodeSolanaBridgeMessageV1InstructionData(bs58.decode(instructionData));

    expect(hashBridgeMessageV1(decoded)).toBe(
      '0x16a3f7f82b64a4d4d669b79118fcdaf7b720bd24d7bbced1dffc36dba3e71334'
    );
    expect(decoded.amount).toBe(1_000_000n);
    expect(decoded.deadline).toBe(1778331723);
    expect(decoded.canonicalAssetId).toBe('004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0');
  });

  test('builds a non-secret fixture from Solana bridge_out_v1_with_proof instruction data', () => {
    const bs58 = require('bs58');
    const instructionData =
      'BZkFV13tVauQ1GGDyzcZoyKB6WBrHWkZsfaqQniE97zPXbgrKYUTP4fuAHnSsYbwBafpE5PHjUMcELad14qiKmSyo9Vvd1Hp7MkT9Yb7DVgMiWfcDKFa6ivi8w5GqUPMKfuGT7aEzV7FwjNKCqqTXEYQztU9gL4PQXibJso8VpvMfpxFzjnnk7dwXyVrMJ7gMhzZJRPg28dtMXAiWv5oYdN1ZnMZ1jX5ASC4rT948ZoKqskDPcqd7JS8es1ScWKdTk1KXs39PsUEvcN4tVhCVxJWeuoeDRhtHk6EgYfud3JJuhekXqfQbHNhyP4T9FrDpHaZzQ1pK4XxekakGExzN5mZBo3aPDhpdiwu9uTmKPUK8q4tiugXXsvKdxsoTboTZuUadTe1YtDDweZa4PiGrVkjKz9SroMuUifyVSfXQkJDMASF8d8Az4GkKkpYt5nXLfZBTmMxKLC4S3asrD5aHJMp7BwkS9Ddz1kui4jVK45eHziH3mtoyDnNRAx57gTeFf7Sj3MdYVeZuG7bf3pABscSkFSpHQwYEuod55fxnM6veBSNJJkoZMvNC5tGpmTakVV4WgGnn2hPnJzXMbD6Ydf88eqL1osyjUqvsvBooj1WyHAwVUg5ZP6UQiUHrLSbrcVX6tqExU1jQH5GdGxDPAbfwYJjpoZTXJ1siSeCuWx6UdEgCZS3zZNUfyCQw5YcKEMd3bMB1bPahdirG3eYHu4qQRjt6V4nA8tSGSVvEazJd5FcZe3viXZWvU4jUw5DwHUiAgMuNsFxjfYwTHTyEjBwRL7E6PzFNvf9mSG8RR45LvWgykiN5pGjw8AdWSGmmjWtqBvMMpJMxExzySPmtRz9ehbD8BLr1Qdk9qpWCrxkCXMk1NUfSm5hMcee3H2zc38jLzSer1gmnkRQCaL3ENShdm6TKCMr7ZRASLQT4sX75axQufj786rPbWmM2QNwoLKS59r64FaJzVwwp98PTLLqwdkSbqaWTn3JRmXs6fMA7k68JYGWZSKMDYPv8tn8387A1W27xpcbbApuZ8LvHtrJrJcuoECHqaTcsGs4H4K2KyGpDJeUXgg3NwZ2aj6j7U3deyhPsabcng9yimW34iXm65oUqxEYWEiyM2YGSwYY6esWNmapXTX7tsG9ggAFrk58Cz27fmp7a8Fd';
    const { fixture, sourceMessageHash, destinationBridgeMintHash } =
      fixtureFromSolanaBridgeOutInstruction({
        instructionData: bs58.decode(instructionData),
        signature: 'BQNRKsUFX5ttshDzZcjtqecsUJjt6cbvURtQtcqX4K7edtmTsNnK5kbNM3hjBwSUtwq2MQfDXhs8SKjP96S3QDQ',
        slot: 458_000_000,
        confirmations: 40,
        sourceTxSucceeded: true,
      });

    expect(sourceMessageHash).toBe('0x16a3f7f82b64a4d4d669b79118fcdaf7b720bd24d7bbced1dffc36dba3e71334');
    expect(destinationBridgeMintHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fixture.instruction).toBe('bridge_out_v1_with_proof');
    expect(fixture.sourceBoundProofMarker).toBe('bridge_out_v1_with_proof');
    expect(fixture.sourceAmount).toBe('1000000');
    expect(fixture.normalizedDestinationAmount).toBe('1000000000000000');
    expect(JSON.stringify(
      fixture,
      (_key, value) => typeof value === 'bigint' ? value.toString() : value
    )).not.toMatch(/private|secret|token|witness|rpc|wallet/i);
  });

  test('loads fixture files and filters by bounded slot range', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solana-source-adapter-'));
    const eventsPath = path.join(dir, 'events.json');
    const first = message({ sourceBlockNumber: 100, nonce: 1 });
    const second = message({ sourceBlockNumber: 700, nonce: 2 });
    fs.writeFileSync(eventsPath, JSON.stringify({
      events: [
        {
          instruction: 'bridge_out_v1_with_proof',
          sourceBoundProofMarker: 'bridge_out_v1_with_proof',
          message: first,
          confirmations: 40,
        },
        {
          instruction: 'bridge_out_v1_with_proof',
          sourceBoundProofMarker: 'bridge_out_v1_with_proof',
          message: second,
          confirmations: 40,
        },
      ],
    }, (_key, value) => typeof value === 'bigint' ? value.toString() : value));

    const adapter = SolanaSourceAdapter.fromFile(eventsPath, {
      fromBlock: 50n,
      toBlock: 500n,
    });
    const observations: BridgeEventObservation[] = [];
    for await (const observation of adapter.watch()) observations.push(observation);

    expect(observations).toHaveLength(1);
    expect(observations[0].blockNumber).toBe(100);
    expect(await adapter.isFinalized(observations[0].txHash, 32)).toBe(true);
  });
});
