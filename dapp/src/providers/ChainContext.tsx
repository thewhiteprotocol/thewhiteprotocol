"use client";

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { SupportedChain, CHAINS } from "@/config/chains";

interface ChainContextValue {
  activeChain: SupportedChain;
  walletAddress: string | null;
  isConnected: boolean;
  switchChain: (chain: SupportedChain) => void;
  setWalletAddress: (address: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  chainConfig: (typeof CHAINS)[SupportedChain];
}

const ChainContext = createContext<ChainContextValue | undefined>(undefined);

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [activeChain, setActiveChain] = useState<SupportedChain>("solana");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const switchChain = useCallback((chain: SupportedChain) => {
    setActiveChain(chain);
    // Reset connection state when switching chains since wallets are chain-specific
    setWalletAddress(null);
    setIsConnected(false);
  }, []);

  const value = useMemo(
    () => ({
      activeChain,
      walletAddress,
      isConnected,
      switchChain,
      setWalletAddress,
      setIsConnected,
      chainConfig: CHAINS[activeChain],
    }),
    [activeChain, walletAddress, isConnected, switchChain]
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain() {
  const context = useContext(ChainContext);
  if (!context) {
    throw new Error("useChain must be used within a ChainProvider");
  }
  return context;
}
