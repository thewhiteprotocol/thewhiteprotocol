"use client";

import React from "react";
import { useChain } from "@/providers/ChainContext";
import { SupportedChain } from "@/config/chains";
import { SolanaConnectButton, EvmConnectButton } from "@/providers/WalletProvider";
import { CHAINS } from "@/config/chains";
import { cn } from "@/lib/utils";

function ChainSelector() {
  const { activeChain, switchChain } = useChain();

  return (
    <div className="flex items-center gap-1 rounded-lg bg-white/[0.03] border border-white/10 p-1">
      {(["solana", "base", "bsc"] as SupportedChain[]).map((chain) => {
        const isActive = activeChain === chain;
        return (
          <button
            key={chain}
            onClick={() => switchChain(chain)}
            className={cn(
              "relative flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
              isActive
                ? "text-white bg-white/10"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.02]"
            )}
          >
            <ChainIcon chain={chain} />
            <span className="hidden sm:inline">{CHAINS[chain].displayName}</span>
            {isActive && (
              <span className="absolute inset-0 rounded-md ring-1 ring-inset ring-white/10" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function ChainIcon({ chain, className }: { chain: SupportedChain; className?: string }) {
  if (chain === "solana") {
    return (
      <svg
        viewBox="0 0 128 128"
        className={cn("w-4 h-4", className)}
        fill="currentColor"
      >
        <path d="M93.94 58.26L108.4 43.8c1.2-1.2 1.2-3.12 0-4.32L88.52 19.6a3.06 3.06 0 00-4.32 0L69.74 34.06l-14.46 14.46-14.46 14.46a3.06 3.06 0 000 4.32l19.88 19.88a3.06 3.06 0 004.32 0l14.46-14.46 14.46-14.46zM34.06 69.74L19.6 84.2a3.06 3.06 0 000 4.32l19.88 19.88a3.06 3.06 0 004.32 0l14.46-14.46 14.46-14.46 14.46-14.46a3.06 3.06 0 000-4.32L67.3 30.82a3.06 3.06 0 00-4.32 0L48.52 45.28 34.06 59.74v10z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 111 111"
      className={cn("w-4 h-4", className)}
      fill="currentColor"
    >
      <path d="M54.921 110.034C85.359 110.034 110.034 85.359 110.034 54.921c0-30.438-24.675-55.113-55.113-55.113C24.673-.192-.002 24.483-.002 54.921c0 30.438 24.675 55.113 55.113 55.113zm-.184-22.424c-4.324 0-8.508-.618-12.453-1.76-1.473-.43-2.965-.05-3.82 1.065l-5.325 7.154c-.618.83-.33 1.99.618 2.44 6.78 3.258 14.373 5.088 22.403 5.088 4.324 0 8.508-.618 12.453-1.76 1.473-.43 2.965-.05 3.82 1.065l5.325 7.154c.618.83.33 1.99-.618 2.44-6.78 3.258-14.373 5.088-22.403 5.088zM38.31 74.92c-2.254-2.48-4.18-5.22-5.717-8.167-.74-1.395-2.273-1.97-3.694-1.413l-8.56 3.29c-1.044.4-1.556 1.59-1.13 2.645 2.69 6.75 6.82 12.74 11.96 17.53.74.69 1.89.725 2.67.08l6.69-5.54c.82-.68.96-1.89.32-2.73-.14-.18-.29-.35-.44-.52l-2.1-7.28zm-9.42-28.37c1.29-3.14 2.95-6.09 4.94-8.78.87-1.19.71-2.84-.42-3.81l-7.05-6.03c-.84-.72-2.1-.68-2.89.1-4.73 4.72-8.37 10.49-10.55 16.92-.37 1.1.24 2.29 1.37 2.72l8.71 3.32c1.27.48 2.68-.17 3.19-1.45.07-.19.13-.37.2-.56l2.5-2.43zm43.27-18.41c2.25 2.48 4.18 5.22 5.72 8.17.74 1.39 2.27 1.97 3.69 1.41l8.56-3.29c1.04-.4 1.56-1.59 1.13-2.64-2.69-6.75-6.82-12.74-11.96-17.53-.74-.69-1.89-.72-2.67-.08l-6.69 5.54c-.82.68-.96 1.89-.32 2.73.14.18.29.35.44.52l2.1 7.27zm9.42 28.37c-1.29 3.14-2.95 6.09-4.94 8.78-.87 1.19-.71 2.84.42 3.81l7.05 6.03c.84.72 2.1.68 2.89-.1 4.73-4.72 8.37-10.49 10.55-16.92.37-1.1-.24-2.29-1.37-2.72l-8.71-3.32c-1.27-.48-2.68.17-3.19 1.45-.07.19-.13.37-.2.56l-2.5 2.43zM54.737 33.19c11.99 0 21.73 9.74 21.73 21.73 0 11.99-9.74 21.73-21.73 21.73-11.99 0-21.73-9.74-21.73-21.73 0-11.99 9.74-21.73 21.73-21.73z" />
    </svg>
  );
}

export function Navbar() {
  const { activeChain } = useChain();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/50 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-4 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <img src="/logo.webp" alt="White Protocol" className="h-8 w-8 object-contain rounded-md" />
          <span className="hidden text-lg font-semibold tracking-tight text-white sm:inline">
            White Protocol
          </span>
        </div>

        {/* Center: Chain Selector */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <ChainSelector />
        </div>

        {/* Right: Wallet Connect */}
        <div className="flex items-center gap-3">
          {activeChain === "solana" ? <SolanaConnectButton /> : <EvmConnectButton />}
        </div>
      </div>
    </header>
  );
}
