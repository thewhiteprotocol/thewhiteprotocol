import React, { useId } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Wallet } from 'lucide-react';

interface GlowWalletButtonProps {
  className?: string;
}

export function GlowWalletButton({ className = '' }: GlowWalletButtonProps) {
  const id = useId().replace(/:/g, '');
  const { publicKey, disconnect, connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  const filters = {
    unopaq: `unopaq-${id}`,
    unopaq2: `unopaq2-${id}`,
    unopaq3: `unopaq3-${id}`,
  };

  const handleClick = () => {
    if (connected) {
      disconnect();
    } else {
      setVisible(true);
    }
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const buttonText = connecting 
    ? 'Connecting...' 
    : connected && publicKey 
      ? truncateAddress(publicKey.toBase58())
      : 'Connect Wallet';

  return (
    <div className={`relative group ${className}`}>
      {/* SVG Filters */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <filter width="300%" x="-100%" height="300%" y="-100%" id={filters.unopaq}>
          <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 9 0" />
        </filter>
        <filter width="300%" x="-100%" height="300%" y="-100%" id={filters.unopaq2}>
          <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 3 0" />
        </filter>
        <filter width="300%" x="-100%" height="300%" y="-100%" id={filters.unopaq3}>
          <feColorMatrix values="1 0 0 0.2 0 0 1 0 0.2 0 0 0 1 0.2 0 0 0 0 2 0" />
        </filter>
      </svg>

      {/* Hidden clickable area */}
      <button 
        onClick={handleClick}
        disabled={connecting}
        className="absolute inset-0 z-20 outline-none border-none cursor-pointer opacity-0 disabled:cursor-not-allowed" 
      />

      {/* Button Container */}
      <div className="relative">
        {/* Outer Glow Layer - Purple to Cyan gradient */}
        <div 
          className="absolute inset-0 -z-20 opacity-40 overflow-hidden transition-opacity duration-300
                     group-hover:opacity-70 group-active:opacity-100 rounded-xl"
          style={{ filter: `blur(1.5em) url(#${filters.unopaq})` }}
        >
          <div 
            className="absolute inset-[-150%] group-hover:animate-[glow-spin_6s_cubic-bezier(0.56,0.15,0.28,0.86)_infinite]"
            style={{ 
              background: 'linear-gradient(90deg, #a855f7 20%, #0000 45%, #06b6d4 80%)',
            }}
          />
        </div>

        {/* Middle Glow Layer */}
        <div 
          className="absolute inset-[-2px] -z-20 opacity-50 overflow-hidden transition-opacity duration-300
                     group-hover:opacity-80 group-active:opacity-100 rounded-xl"
          style={{ 
            filter: `blur(0.25em) url(#${filters.unopaq2})`,
          }}
        >
          <div 
            className="absolute inset-[-150%] group-hover:animate-[glow-spin_6s_cubic-bezier(0.56,0.15,0.28,0.86)_infinite]"
            style={{ 
              background: 'linear-gradient(90deg, #c084fc 15%, #0000 40% 60%, #22d3ee 85%)',
            }}
          />
        </div>

        {/* Button Border Container */}
        <div className="p-[2px] bg-border/50 rounded-xl overflow-hidden">
          <div className="relative">
            {/* Inner Glow Layer */}
            <div 
              className="absolute inset-[-2px] -z-10 opacity-30 overflow-hidden transition-opacity duration-300
                         group-hover:opacity-60 group-active:opacity-80 rounded-xl"
              style={{ 
                filter: `blur(3px) url(#${filters.unopaq3})`,
              }}
            >
              <div 
                className="absolute inset-[-150%] group-hover:animate-[glow-spin_6s_cubic-bezier(0.56,0.15,0.28,0.86)_infinite]"
                style={{ 
                  background: 'linear-gradient(90deg, #e9d5ff 25%, #0000 45% 55%, #a5f3fc 75%)',
                }}
              />
            </div>
            
            {/* Button Surface */}
            <div 
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-background/95 text-foreground 
                         rounded-[10px] font-medium text-sm transition-all duration-300
                         group-hover:bg-background/80"
            >
              {connecting ? (
                <>
                  <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span>{buttonText}</span>
                </>
              ) : connected ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span>{buttonText}</span>
                </>
              ) : (
                <>
                  <Wallet className="h-4 w-4" />
                  <span>{buttonText}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes glow-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default GlowWalletButton;
