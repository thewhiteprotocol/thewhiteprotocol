declare module "circomlibjs" {
  export type Poseidon = {
    (inputs: bigint[]): any;
    F: {
      toString(val: any): string;
    };
  };
  export function buildPoseidon(): Promise<Poseidon>;
}
