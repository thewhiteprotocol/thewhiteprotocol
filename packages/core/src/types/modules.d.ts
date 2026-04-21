declare module "bs58" {
  export function encode(source: Uint8Array): string;
  export function decode(source: string): Uint8Array;
  export default { encode, decode };
}

declare module "circomlibjs" {
  export interface Poseidon {
    (inputs: (bigint | number)[]): unknown;
    F: {
      toString(x: unknown): string;
    };
  }
  export function buildPoseidon(): Promise<Poseidon>;
}
