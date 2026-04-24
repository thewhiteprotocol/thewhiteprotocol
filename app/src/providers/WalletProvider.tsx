"use client";

import React, { useEffect, useCallback } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount as useWagmiAccount } from "wagmi";
import { RainbowKitProvider, ConnectButton } from "@rainbow-me/rainbowkit";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia } from "wagmi/chains";
import { http } from "wagmi";

import { useChain, ChainProvider } from "./ChainContext";
import { SupportedChain, CHAINS } from "@/config/chains";

import "@solana/wallet-adapter-react-ui/styles.css";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

function InnerWalletProvider({ children }: { children: React.ReactNode }) {
  const solanaEndpoint = CHAINS.solana.rpcUrl;
  const solanaWallets = React.useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  const wagmiConfig = React.useMemo(
    () =>
      getDefaultConfig({
        appName: "The White Protocol",
        projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "white-protocol",
        chains: [baseSepolia],
        transports: {
          [baseSepolia.id]: http(CHAINS.base.rpcUrl),
        },
        ssr: true,
      }),
    []
  );

  return (
    <ConnectionProvider endpoint={solanaEndpoint}>
      <SolanaWalletProvider wallets={solanaWallets} autoConnect>
        <WalletModalProvider>
          <SolanaWalletBridge>
            <WagmiProvider config={wagmiConfig}>
              <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>
                  <EvmWalletBridge>{children}</EvmWalletBridge>
                </RainbowKitProvider>
              </QueryClientProvider>
            </WagmiProvider>
          </SolanaWalletBridge>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

function SolanaWalletBridge({ children }: { children: React.ReactNode }) {
  const { publicKey, connected } = useSolanaWallet();
  const { activeChain, setWalletAddress, setIsConnected } = useChain();

  useEffect(() => {
    if (activeChain === "solana") {
      setWalletAddress(publicKey?.toBase58() || null);
      setIsConnected(connected);
    }
  }, [publicKey, connected, activeChain, setWalletAddress, setIsConnected]);

  return <>{children}</>;
}

function EvmWalletBridge({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useWagmiAccount();
  const { activeChain, setWalletAddress, setIsConnected } = useChain();

  useEffect(() => {
    if (activeChain === "base") {
      setWalletAddress(address || null);
      setIsConnected(isConnected);
    }
  }, [address, isConnected, activeChain, setWalletAddress, setIsConnected]);

  return <>{children}</>;
}

export function SolanaConnectButton() {
  return <WalletMultiButton className="!bg-emerald-600 hover:!bg-emerald-700 !rounded-lg !px-4 !py-2 !h-auto !text-sm !font-medium" />;
}

export function EvmConnectButton() {
  return (
    <ConnectButton
      showBalance={false}
      chainStatus="icon"
      accountStatus="address"
    />
  );
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <ChainProvider>
      <InnerWalletProvider>{children}</InnerWalletProvider>
    </ChainProvider>
  );
}
