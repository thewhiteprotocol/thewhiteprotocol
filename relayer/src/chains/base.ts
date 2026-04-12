/**
 * Base (EVM) chain adapter for The White Protocol relayer
 */

import { ethers } from 'ethers';

export interface BaseConfig {
  rpcEndpoint: string;
  contractAddress: string;
  privateKey: string;
  chainId: number;
}

export class BaseAdapter {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract | null = null;
  
  constructor(private config: BaseConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcEndpoint, config.chainId);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
  }
  
  async initialize(abi: any): Promise<void> {
    this.contract = new ethers.Contract(
      this.config.contractAddress,
      abi,
      this.wallet
    );
  }
  
  async submitWithdrawal(
    proofData: string,
    merkleRoot: string,
    nullifierHash: string,
    recipient: string,
    amount: bigint,
    assetId: string
  ): Promise<string> {
    if (!this.contract) {
      throw new Error('Base adapter not initialized');
    }
    
    // Implementation would call the withdraw function on the contract
    // This is a placeholder showing the interface
    const tx = await this.contract.withdraw(
      proofData,
      merkleRoot,
      nullifierHash,
      recipient,
      amount,
      assetId
    );
    
    const receipt = await tx.wait();
    return receipt.hash;
  }
  
  async getMerkleRoot(): Promise<string> {
    if (!this.contract) {
      throw new Error('Base adapter not initialized');
    }
    return await this.contract.merkleRoot();
  }
  
  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }
  
  getWallet(): ethers.Wallet {
    return this.wallet;
  }
}
