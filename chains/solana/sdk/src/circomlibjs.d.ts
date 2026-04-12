declare module 'circomlibjs' {
  export interface Poseidon {
    (inputs: any[]): any;
    F: {
      toObject(value: any): bigint;
    };
  }

  export function buildPoseidon(): Promise<Poseidon>;
}
