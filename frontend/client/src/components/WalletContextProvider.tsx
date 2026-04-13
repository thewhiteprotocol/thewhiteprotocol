import { useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

import "@solana/wallet-adapter-react-ui/styles.css";

type RuntimeConfig = { RPC_URL: string };

export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com';
  const [endpoint, setEndpoint] = useState<string>(RPC_URL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config");
        const json = (await res.json()) as { success: boolean; config?: RuntimeConfig };
        const rpc = json?.config?.RPC_URL;
        if (!cancelled && rpc && (rpc.startsWith("http://") || rpc.startsWith("https://"))) {
          setEndpoint(rpc);
        }
      } catch {
        // keep default
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
