"use client";

import React, { useEffect, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useSignMessage as useWagmiSignMessage } from "wagmi";
import { useChain } from "@/providers/ChainContext";
import { initNoteStore, isStoreInitialized, hasSessionKey } from "@/lib/noteStore";

import { initializePoseidon } from "@/lib/crypto";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, Loader2, Trash2 } from "lucide-react";

const UNLOCK_MESSAGE = "Unlock White Protocol Local Vault";
const STORAGE_PREFIX = "white_protocol_notes_v2";

export function UnlockModal() {
  const { activeChain, walletAddress, isConnected } = useChain();
  const solanaWallet = useSolanaWallet();
  const { signMessageAsync: signEvmMessage } = useWagmiSignMessage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasStaleData, setHasStaleData] = useState(false);

  useEffect(() => {
    if (!isConnected || !walletAddress) {
      setOpen(false);
      return;
    }
    const needsUnlock = !hasSessionKey();
    if (needsUnlock) {
      setOpen(true);
      setHasStaleData(isStoreInitialized(walletAddress));
    }
  }, [isConnected, walletAddress]);

  const handleUnlock = async () => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      let signature: Uint8Array;
      if (activeChain === "solana") {
        if (!solanaWallet.signMessage) {
          throw new Error("Wallet does not support message signing");
        }
        const encoded = new TextEncoder().encode(UNLOCK_MESSAGE);
        signature = await solanaWallet.signMessage(encoded);
      } else {
        const sigHex = await signEvmMessage({ message: UNLOCK_MESSAGE });
        signature = Uint8Array.from(Buffer.from(sigHex.slice(2), "hex"));
      }
      await initializePoseidon();
      await initNoteStore(walletAddress, signature, activeChain);
      window.dispatchEvent(new Event("white-protocol-notes-unlocked"));
      setOpen(false);
    } catch (err: any) {
      setError(err.message || "Failed to unlock local vault");
      if (err?.message?.includes("DECRYPTION_FAILED")) {
        setHasStaleData(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (!walletAddress) return;
    if (typeof window !== "undefined") {
      const storageKey = `${STORAGE_PREFIX}_${walletAddress.toLowerCase()}`;
      localStorage.removeItem(storageKey);

    }
    setHasStaleData(false);
    setError(null);
    // After clearing, try unlocking again with a fresh store
    handleUnlock();
  };

  if (!isConnected || !walletAddress) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-md">
        <DialogHeader className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <Shield className="h-6 w-6 text-emerald-500" />
          </div>
          <DialogTitle className="text-center text-xl">Unlock Local Vault</DialogTitle>
          <DialogDescription className="text-center text-zinc-400">
            Sign a message to derive your local encryption key. This unlocks encrypted private notes on this device.
            No private note or wallet secret is sent to The White Protocol.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-400">
            <span className="text-zinc-500">Message:</span>
            <p className="mt-1 font-medium text-zinc-200">{UNLOCK_MESSAGE}</p>
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}
          <Button
            onClick={handleUnlock}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Unlocking vault...
              </>
            ) : (
              "Sign to Unlock Vault"
            )}
          </Button>
          {hasStaleData && (
            <Button
              onClick={handleReset}
              disabled={loading}
              variant="outline"
              className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Local Vault & Start Fresh
            </Button>
          )}
          <p className="text-center text-xs text-zinc-500">
            Your private notes are encrypted locally. If you clear browser data without a backup, your shielded funds cannot be recovered.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
