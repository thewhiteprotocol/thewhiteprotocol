/**
 * The White Protocol SDK
 *
 * Complete TypeScript SDK for The White Protocol - Privacy-preserving Multi-Asset Shielded Pool.
 *
 * @packageDocumentation
 */
// Re-export crypto module
export * from './crypto/poseidon';
// Re-export note module
export * from './note/note';
// Re-export merkle module
export * from './merkle/tree';
// Re-export proof module (excluding ProofType to avoid duplicate)
export { Prover, DEFAULT_CIRCUIT_PATHS, pubkeyToScalar, verifyProofLocally, exportVerificationKey } from './proof/prover';
// Re-export types (source of truth for request/result types)
export * from './types';
// Re-export PDA helpers
export * from './pda';
// Re-export client (only the client class and factory, not duplicate types)
export { WhiteProtocolClient, createWhiteProtocolClient } from './client';
/**
 * Initialize the SDK (must be called before using crypto functions)
 */
export async function initializeSDK() {
    const { initPoseidon } = await import('./crypto/poseidon');
    await initPoseidon();
}
/**
 * SDK version
 */
export const SDK_VERSION = '2.0.0';
/**
 * Check if SDK is production ready
 */
export const IS_PRODUCTION_READY = false;
export const SDK_STATUS = "alpha";
/**
 * Protocol name
 */
export const PROTOCOL_NAME = "The White Protocol";
// Yield Mode
export * from './yield';
export { SUPPORTED_LST_MINTS } from './client';
//# sourceMappingURL=index.js.map