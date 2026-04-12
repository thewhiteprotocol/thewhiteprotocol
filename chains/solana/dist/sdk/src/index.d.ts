/**
 * pSOL v2 SDK
 *
 * Complete TypeScript SDK for the pSOL v2 Multi-Asset Shielded Pool.
 *
 * @packageDocumentation
 */
export * from './crypto/poseidon';
export * from './note/note';
export * from './merkle/tree';
export { Prover, DEFAULT_CIRCUIT_PATHS, type Groth16Proof, type ProofWithSignals, type SerializedProof, type DepositProofInputs, type WithdrawProofInputs, type JoinSplitProofInputs, type CircuitPaths, pubkeyToScalar, verifyProofLocally, exportVerificationKey } from './proof/prover';
export * from './types';
export * from './pda';
export { PsolV2Client, createPsolClient, type PsolV2ClientOptions } from './client';
/**
 * Initialize the SDK (must be called before using crypto functions)
 */
export declare function initializeSDK(): Promise<void>;
/**
 * SDK version
 */
export declare const SDK_VERSION = "2.0.0";
/**
 * Check if SDK is production ready
 */
export declare const IS_PRODUCTION_READY = false;
export declare const SDK_STATUS = "alpha";
//# sourceMappingURL=index.d.ts.map