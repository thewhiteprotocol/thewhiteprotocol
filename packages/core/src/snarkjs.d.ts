declare module 'snarkjs' {
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }

  export function groth16FullProve(
    input: Record<string, unknown>,
    wasmFile: string | Uint8Array,
    zkeyFile: string | Uint8Array
  ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;

  export function groth16Verify(
    vkVerifier: unknown,
    publicSignals: string[],
    proof: Groth16Proof
  ): Promise<boolean>;

  export function groth16Prove(
    zkeyFileName: string | Uint8Array,
    witnessFileName: string | Uint8Array
  ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;

  export function exportSolidityCallData(
    proof: Groth16Proof,
    publicSignals: string[]
  ): Promise<string>;

  export const groth16: {
    fullProve: typeof groth16FullProve;
    prove: typeof groth16Prove;
    verify: typeof groth16Verify;
    exportSolidityCallData: typeof exportSolidityCallData;
  };
}
