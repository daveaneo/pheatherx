// Type declarations for optional cofhejs FHE library
declare module 'cofhejs' {
  export class FhenixClient {
    constructor(options: { provider: any });

    generatePermit(
      contractAddress: string,
      provider: any,
      signer: any
    ): Promise<any>;

    encrypt_uint128(
      value: bigint,
      contractAddress: string
    ): Promise<Uint8Array>;

    encrypt_bool(
      value: boolean,
      contractAddress: string
    ): Promise<Uint8Array>;

    unseal(
      contractAddress: string,
      ciphertext: string,
      permit: any
    ): Promise<bigint>;
  }
}
