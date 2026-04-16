import { useState, useEffect, useCallback } from "react";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createDepositNote, prepareWithdrawal, submitWithdrawal, getPoolState, getMerkleProof, hexToBytes, bytesToHex, buildDepositTx, getNoteStatus } from '../lib/relayer-api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  Loader2, 
  CheckCircle2,
  Info,
  Lock,
  Wallet as WalletIcon,
  Download,
  Upload,
  Copy,
  Trash2,
  Sparkles,
  Shield,
  Zap,
  AlertTriangle
} from "lucide-react";
import { AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEVNET_CONFIG } from "@/config";
import { useToast } from "@/hooks/use-toast";
import BN from "bn.js";
import { GlowInput } from "@/components/ui/glow-input";
import { GlowCard } from "@/components/ui/glow-card";

import { ensureAtaAndWrapIfNeeded } from "../lib/token-prereqs";

// =============================================================================
// CONFIGURATION
// =============================================================================

// Require RELAYER_API_URL - fail early if not set
const RELAYER_API_URL = import.meta.env.VITE_RELAYER_API_URL;
if (!RELAYER_API_URL) {
  console.error('FATAL: VITE_RELAYER_API_URL environment variable is not set!');
}

// Wrapped SOL mint address (same on all networks)
const WRAPPED_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Dev-only logger - never logs in production
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
const devLog = (...args: any[]) => { if (isDev) devLog(...args); };

// =============================================================================
// TYPES
// =============================================================================

interface SerializedNote {
  secret: string;
  nullifier: string;
  commitment: string;
  nullifierHash: string;
  amount: string;
  assetId: string;
  leafIndex?: number;
  depositTimestamp?: number;
  depositSignature?: string;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert SOL string to lamports string (deterministic, no floats)
 * "1.5" -> "1500000000"
 * "0.001" -> "1000000"
 */
function solToLamports(solString: string): string {
  const trimmed = solString.trim();
  if (!trimmed || !/^\d*\.?\d+$/.test(trimmed)) {
    throw new Error('Invalid SOL amount');
  }

  const [whole, decimal = ''] = trimmed.split('.');
  const paddedDecimal = decimal.padEnd(9, '0').slice(0, 9);
  const lamportsStr = (whole || '0') + paddedDecimal;

  // Remove leading zeros but keep at least one digit
  return lamportsStr.replace(/^0+/, '') || '0';
}

/**
 * Format lamports to SOL display string
 */
function formatAmount(amount: string): string {
  try {
    const lamports = BigInt(amount);
    return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
  } catch {
    return '0.0000';
  }
}

/**
 * Validate imported note has all required fields
 */
function validateNote(note: unknown): note is SerializedNote {
  if (!note || typeof note !== 'object') return false;
  const n = note as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ['secret', 'nullifier', 'commitment', 'nullifierHash', 'amount', 'assetId'];
  for (const field of requiredStrings) {
    if (typeof n[field] !== 'string' || !n[field]) {
      return false;
    }
  }

  // Validate amount is a valid bigint string
  try {
    const amt = BigInt(n.amount as string);
    if (amt <= 0n) return false;
  } catch {
    return false;
  }

  // Optional fields validation
  if (n.leafIndex !== undefined && typeof n.leafIndex !== 'number') return false;
  if (n.depositTimestamp !== undefined && typeof n.depositTimestamp !== 'number') return false;
  if (n.depositSignature !== undefined && typeof n.depositSignature !== 'string') return false;

  return true;
}

/**
 * Get wallet-specific storage key
 */
function getStorageKey(walletPubkey: string): string {
  return `white_protocol_notes_${walletPubkey}`;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function Protocol() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { toast } = useToast();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");
  const [selectedNote, setSelectedNote] = useState<SerializedNote | null>(null);
  const [depositLoading, setDepositLoading] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [notes, setNotes] = useState<SerializedNote[]>([]);
  const [relayerError, setRelayerError] = useState<string | null>(
    !RELAYER_API_URL ? 'Relayer API URL not configured' : null
  );

  // ==========================================================================
  // WALLET-SPECIFIC NOTE STORAGE
  // ==========================================================================

  // Load notes from localStorage (wallet-specific)
  useEffect(() => {
    if (!publicKey) {
      setNotes([]);
      return;
    }

    try {
      const walletKey = publicKey.toBase58();
      const stored = localStorage.getItem(getStorageKey(walletKey));
      if (stored) {
        const parsedNotes = JSON.parse(stored);
        // Validate each note
        const validNotes = parsedNotes.filter(validateNote);
        setNotes(validNotes);

        if (validNotes.length !== parsedNotes.length) {
          console.warn('[Protocol] Some stored notes failed validation and were filtered out');
        }
      } else {
        setNotes([]);
      }
    } catch (error) {
      console.error('Error loading notes:', error);
      setNotes([]);
    }
  }, [publicKey]);

  // Save notes to localStorage (wallet-specific)
  const saveNotes = useCallback((updatedNotes: SerializedNote[]) => {
    const walletKey = publicKey?.toBase58();
    if (walletKey) {
      localStorage.setItem(getStorageKey(walletKey), JSON.stringify(updatedNotes));
    }
    setNotes(updatedNotes);
  }, [publicKey]);

  // ==========================================================================
  // POLLING FOR NOTE SETTLEMENT (with race condition fix)
  // ==========================================================================

  useEffect(() => {
    if (!RELAYER_API_URL) return;

    const checkNoteStatus = async () => {
      const pendingNotes = notes.filter(n => n.leafIndex === undefined);
      if (pendingNotes.length === 0) return;

      try {
        // Fetch all statuses in parallel
        const results = await Promise.allSettled(
          pendingNotes.map(async (note) => {
            const status = await getNoteStatus(note.commitment);
            return { commitment: note.commitment, status };
          })
        );

        // Collect all updates
        const updates: Map<string, number> = new Map();

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { commitment, status } = result.value;
            if (status.status === 'settled' && status.leafIndex !== undefined) {
              updates.set(commitment, status.leafIndex);
              devLog('[Poll] Note settled at leaf', status.leafIndex);
            }
          }
        }

        // Apply all updates at once (avoids race conditions)
        if (updates.size > 0) {
          setNotes(currentNotes => {
            const newNotes = currentNotes.map(n => {
              const leafIndex = updates.get(n.commitment);
              return leafIndex !== undefined ? { ...n, leafIndex } : n;
            });

            // Save to localStorage
            const walletKey = publicKey?.toBase58();
            if (walletKey) {
              localStorage.setItem(getStorageKey(walletKey), JSON.stringify(newNotes));
            }

            return newNotes;
          });
        }
      } catch (error) {
        console.error('[Poll] Error:', error);
      }
    };

    // Initial check
    checkNoteStatus();

    // Poll every 10 seconds
    const interval = setInterval(checkNoteStatus, 10000);
    return () => clearInterval(interval);
  }, [notes.length, publicKey]); // Only re-run when note count changes

  // ==========================================================================
  // BALANCE FETCHING
  // ==========================================================================

  const fetchBalance = useCallback(async () => {
    if (!publicKey) return;
    try {
      const bal = await connection.getBalance(publicKey);
      setBalance(bal / LAMPORTS_PER_SOL);
    } catch (error) {
      console.error("Error fetching balance:", error);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey) {
      fetchBalance();
    }
  }, [connected, publicKey, fetchBalance]);

  // ==========================================================================
  // DEPOSIT HANDLER
  // ==========================================================================

  const handleDeposit = async () => {
    // Pre-flight checks
    if (!RELAYER_API_URL) {
      toast({
        title: "Configuration Error",
        description: "Relayer API URL is not configured",
        variant: "destructive",
      });
      return;
    }

    if (!publicKey || !connected) {
      toast({
        title: "Not ready",
        description: "Please connect your wallet",
        variant: "destructive",
      });
      return;
    }

    if (!anchorWallet) {
      toast({
        title: "Wallet Error",
        description: "Wallet not properly initialized",
        variant: "destructive",
      });
      return;
    }

    // Validate amount
    let amountLamports: string;
    try {
      amountLamports = solToLamports(depositAmount);
      const lamportsBigInt = BigInt(amountLamports);

      if (lamportsBigInt <= 0n) {
        throw new Error('Amount must be greater than 0');
      }

      // Minimum deposit check (0.001 SOL = 1,000,000 lamports)
      if (lamportsBigInt < 1_000_000n) {
        toast({
          title: "Amount too small",
          description: "Minimum deposit is 0.001 SOL",
          variant: "destructive",
        });
        return;
      }
    } catch (error) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid SOL amount",
        variant: "destructive",
      });
      return;
    }

    setDepositLoading(true);
    setDepositSuccess(false);

    try {
      await fetchBalance();

      // Step 1: Create note via relayer
      toast({
        title: "Creating Deposit",
        description: "Preparing commitment...",
      });

      devLog('[Deposit] Creating note via relayer...');
      const note = await createDepositNote(
        WRAPPED_SOL_MINT.toBase58(),
        amountLamports
      );
      devLog('[Deposit] Note created:', {
        commitment: note.commitment.slice(0, 20) + '...',
      });

      // Step 2: Build unsigned transaction
      toast({
        title: "Building Transaction",
        description: "Preparing deposit transaction...",
      });

  await ensureAtaAndWrapIfNeeded({
    connection,
    owner: publicKey,
    payer: publicKey,
    mint: new PublicKey(WRAPPED_SOL_MINT.toBase58()),
    requiredAmountBaseUnits: BigInt(amountLamports),
    sendTransaction,
  });

      // Hardening: on-chain expects Groth16 proof as exactly 256 bytes.
      // The relayer API returns proofData as a hex string; validate and normalize before building the tx.
      let proofHex = note.proofData;
      try {
        const proofBytes = hexToBytes(proofHex);
        if (proofBytes.length !== 256) {
          throw new Error(`Invalid proof length: ${proofBytes.length} bytes (expected 256)`);
        }
        proofHex = bytesToHex(proofBytes);
      } catch (e: any) {
        throw new Error(`Invalid deposit proof encoding: ${e?.message || String(e)}`);
      }

      const txData = await buildDepositTx({
        amount: amountLamports,
        commitment: note.commitment,
        assetIdHex: note.assetIdHex,
        proofData: proofHex,
        depositorPubkey: publicKey.toBase58(),
        mint: WRAPPED_SOL_MINT.toBase58(),
      });

      // Step 3: Deserialize and validate transaction
      toast({
        title: "Submitting Transaction",
        description: "Please approve in your wallet...",
      });

      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(Buffer.from(txData.transaction, "base64"));

      // Sanity check: verify only depositor is required signer
      const requiredSigners = tx.signatures
        .filter(s => s.signature === null)
        .map(s => s.publicKey.toBase58());

      devLog("[Deposit] Required signers:", requiredSigners);

      const unexpectedSigners = requiredSigners.filter(s => s !== publicKey.toBase58());
      if (unexpectedSigners.length > 0) {
        throw new Error(`Transaction requires unexpected signers: ${unexpectedSigners.join(', ')}`);
      }

      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      devLog("[Deposit] Fresh blockhash:", blockhash);
      devLog("[Deposit] TX instructions:", tx.instructions.length);

      // Sign and send
      const signedTx = await anchorWallet.signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      devLog("[Deposit] TX signature:", signature);

      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      devLog('[Deposit] Confirmed!');

      // Step 4: Save note locally WITHOUT leafIndex (polling will fill it)
      const serializedNote: SerializedNote = {
        secret: note.secret,
        nullifier: note.nullifier,
        commitment: note.commitment,
        nullifierHash: note.nullifierHash,
        amount: amountLamports,
        assetId: note.assetId,
        // leafIndex intentionally NOT set - polling will update it when settled
        depositTimestamp: Date.now(),
        depositSignature: signature,
      };

      const updatedNotes = [...notes, serializedNote];
      saveNotes(updatedNotes);

      // Step 5: Auto-download note file (recommended by manager)
      const blob = new Blob([JSON.stringify(serializedNote, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `white-protocol-note-${serializedNote.commitment.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Cleanup
      setDepositSuccess(true);
      setDepositAmount("");
      await fetchBalance();

      toast({
        title: "Deposit Successful! 🎉",
        description: `TX: ${signature.slice(0, 12)}... | Note saved & downloaded`,
      });
    } catch (error: any) {
      console.error('[Deposit] Error:', error);

      let errorMessage = "Transaction failed";
      let errorDescription = error?.message || "Unknown error occurred";

      if (error?.message?.includes('User rejected')) {
        errorMessage = "Transaction Cancelled";
        errorDescription = "You rejected the transaction in your wallet";
      } else if (error?.message?.includes('insufficient')) {
        errorMessage = "Insufficient Balance";
        errorDescription = "Not enough SOL to cover deposit + transaction fees";
      } else if (error?.message?.includes('blockhash')) {
        errorMessage = "Network Issue";
        errorDescription = "Please try again in a few seconds";
      } else if (error?.message?.includes('unexpected signers')) {
        errorMessage = "Transaction Error";
        errorDescription = "Invalid transaction structure - please report this bug";
      }

      toast({
        title: errorMessage,
        description: errorDescription,
        variant: "destructive",
      });
    } finally {
      setDepositLoading(false);
    }
  };

  // ==========================================================================
  // WITHDRAW HANDLER
  // ==========================================================================

  const handleWithdraw = async () => {
    if (!RELAYER_API_URL) {
      toast({
        title: "Configuration Error",
        description: "Relayer API URL is not configured",
        variant: "destructive",
      });
      return;
    }

    if (!publicKey || !connected) {
      toast({
        title: "Not ready",
        description: "Please connect your wallet",
        variant: "destructive",
      });
      return;
    }

    if (!selectedNote) {
      toast({
        title: "No note selected",
        description: "Please select a note to withdraw",
        variant: "destructive",
      });
      return;
    }

    if (selectedNote.leafIndex === undefined) {
      toast({
        title: "Note not settled",
        description: "This deposit is still being processed. Please wait for settlement to complete.",
        variant: "destructive",
      });
      return;
    }

    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = withdrawRecipient ? new PublicKey(withdrawRecipient) : publicKey;
    } catch {
      toast({
        title: "Invalid address",
        description: "Please enter a valid Solana address",
        variant: "destructive",
      });
      return;
    }

    setWithdrawLoading(true);
    setWithdrawSuccess(false);

    try {
      toast({
        title: "Preparing Withdrawal",
        description: "Generating ZK proof (30-60 seconds)...",
      });

      // Use partial amount if specified, otherwise full note amount - safe string-based conversion
      const effectiveWithdrawAmount = withdrawAmount
        ? (() => {
            const parts = withdrawAmount.split('.');
            const whole = parts[0] || '0';
            const frac = (parts[1] || '').padEnd(9, '0').slice(0, 9);
            return String(BigInt(whole) * BigInt(1_000_000_000) + BigInt(frac));
          })()
        : selectedNote.amount;

      const withdrawResult = await prepareWithdrawal(
        {
          secret: selectedNote.secret,
          nullifier: selectedNote.nullifier,
          amount: selectedNote.amount,
          assetId: selectedNote.assetId,
          nullifierHash: selectedNote.nullifierHash,
        },
        recipientPubkey.toBase58(),
        publicKey.toBase58(),
        selectedNote.leafIndex,
        effectiveWithdrawAmount
      );

      devLog('[Withdraw] Proof generated, submitting...');
      toast({
        title: "Submitting Withdrawal",
        description: "Sending to relayer...",
      });

      const result = await submitWithdrawal({
        recipient: recipientPubkey.toBase58(),
        amount: effectiveWithdrawAmount,
        mint: WRAPPED_SOL_MINT.toBase58(),
        merkleRoot: withdrawResult.merkleRoot,
        nullifierHash: withdrawResult.nullifierHash,
        proofData: withdrawResult.proofData,
        relayerFee: withdrawResult.relayerFee || withdrawResult.fee,
        assetId: withdrawResult.assetId,
        changeCommitment: withdrawResult.changeCommitment,
      });

      devLog('[Withdraw] Success! TX:', result.signature);

      // Handle notes after withdrawal
      let updatedNotes = notes.filter(n => n.commitment !== selectedNote.commitment);

      // If partial withdrawal, save the change note for future withdrawals
      // nullifierHash will be computed by the relayer when this change note is used for withdrawal.
      // The relayer computes it from (secret, nullifier, leafIndex) using Poseidon hash.
      if (withdrawResult.changeNote) {
        const changeNote = {
          secret: withdrawResult.changeNote.secret,
          nullifier: withdrawResult.changeNote.nullifier,
          amount: withdrawResult.changeNote.amount,
          assetId: withdrawResult.changeNote.assetId,
          commitment: withdrawResult.changeNote.commitment,
          nullifierHash: 'PENDING_COMPUTATION',
          status: 'pending' as const,
          // leafIndex will be set after sequencer settles
        };
        updatedNotes.push(changeNote as any);
        devLog('[Withdraw] Change note saved:', changeNote.commitment.slice(0, 20) + '...',
          'amount:', (parseFloat(changeNote.amount) / 1e9).toFixed(4), 'SOL');
      }

      saveNotes(updatedNotes);
      setSelectedNote(null);
      setWithdrawAmount('');
      setWithdrawSuccess(true);
      await fetchBalance();

      toast({
        title: "Withdrawal Successful! 🎉",
        description: `TX: ${result.signature?.slice(0, 12)}... | Funds withdrawn privately!`,
      });
    } catch (error: any) {
      console.error("[Withdraw] Error:", error);
      toast({
        title: "Withdrawal failed",
        description: error?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setWithdrawLoading(false);
    }
  };

  // ==========================================================================
  // NOTE MANAGEMENT HELPERS
  // ==========================================================================

  const downloadNote = (note: SerializedNote) => {
    const blob = new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `white-protocol-note-${note.commitment.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Note Downloaded",
      description: "Keep this file safe - you need it to withdraw!",
    });
  };

  const importNote = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text);

      // Validate the imported note
      if (!validateNote(imported)) {
        toast({
          title: "Invalid note",
          description: "The file is missing required fields or has invalid data",
          variant: "destructive",
        });
        return;
      }

      if (notes.some(n => n.commitment === imported.commitment)) {
        toast({
          title: "Note already exists",
          description: "This note is already in your list",
          variant: "destructive",
        });
        return;
      }

      const updatedNotes = [...notes, imported];
      saveNotes(updatedNotes);

      toast({
        title: "Note imported",
        description: "Successfully imported deposit note",
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: "Invalid JSON file format",
        variant: "destructive",
      });
    }

    // Reset file input
    event.target.value = '';
  };

  const copyNote = (note: SerializedNote) => {
    navigator.clipboard.writeText(note.commitment);
    toast({
      title: "Copied",
      description: "Commitment ID copied (secrets excluded for safety)",
    });
  };

  const deleteNote = (commitment: string) => {
    if (!confirm('Are you sure? Deleting this note will make you unable to withdraw these funds!')) {
      return;
    }

    const updatedNotes = notes.filter(n => n.commitment !== commitment);
    saveNotes(updatedNotes);
    if (selectedNote?.commitment === commitment) {
      setSelectedNote(null);
    }
    toast({
      title: "Note deleted",
      description: "Note removed from your list",
    });
  };

  // ==========================================================================
  // RENDER
  // ==========================================================================

  // Show error if relayer not configured
  if (relayerError) {
    return (
      <section className="py-8">
        <div className="container mx-auto px-4">
          <GlowCard gradientFrom="#ef4444" gradientTo="#f97316" glowIntensity="medium" animated={false}>
            <CardContent className="pt-8 pb-8">
              <div className="text-center space-y-4">
                <AlertTriangle className="h-12 w-12 text-red-400 mx-auto" />
                <h2 className="text-xl font-bold text-red-400">Configuration Error</h2>
                <p className="text-muted-foreground">{relayerError}</p>
                <p className="text-sm text-muted-foreground">
                  Please set VITE_RELAYER_API_URL in your environment
                </p>
              </div>
            </CardContent>
          </GlowCard>
        </div>
      </section>
    );
  }

  return (
    <section className="py-8">
      <div className="container mx-auto px-4">
        {!connected ? (
          <GlowCard gradientFrom="#a855f7" gradientTo="#06b6d4" glowIntensity="medium" animated={true}>
            <CardContent className="pt-8 pb-8">
              <div className="text-center space-y-6">
                <div className="flex justify-center">
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-500/30">
                    <Shield className="h-12 w-12 text-purple-400" />
                  </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    The White Protocol Privacy Protocol
                  </h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Experience private transactions on Solana with zero-knowledge proofs
                  </p>
                </div>
                <Alert className="bg-purple-500/10 border-purple-500/30 max-w-md mx-auto">
                  <WalletIcon className="h-4 w-4 text-purple-400" />
                  <AlertDescription className="text-purple-300">
                    Connect your wallet to start using the privacy protocol
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </GlowCard>
        ) : (
          <div className="space-y-6">
            {/* Balance Card */}
            <GlowCard gradientFrom="#a855f7" gradientTo="#06b6d4" glowIntensity="low" animated={false}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20">
                      <WalletIcon className="h-6 w-6 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Available Balance</p>
                      <p className="text-2xl font-bold">
                        {balance !== null ? `${balance.toFixed(4)} SOL` : <Loader2 className="h-5 w-5 animate-spin" />}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                    <Zap className="h-3 w-3 mr-1" />
                    Devnet
                  </Badge>
                </div>
              </CardContent>
            </GlowCard>

            {/* Main Protocol Card */}
            <GlowCard gradientFrom="#a855f7" gradientTo="#06b6d4" glowIntensity="medium" animated={true}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                  Privacy Pool
                </CardTitle>
                <CardDescription>
                  Deposit SOL to shield your transactions, withdraw privately later
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="deposit" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 bg-muted/50">
                    <TabsTrigger value="deposit" className="data-[state=active]:bg-purple-500/20">
                      <ArrowDownToLine className="h-4 w-4 mr-2" />
                      Deposit
                    </TabsTrigger>
                    <TabsTrigger value="withdraw" className="data-[state=active]:bg-cyan-500/20">
                      <ArrowUpFromLine className="h-4 w-4 mr-2" />
                      Withdraw
                    </TabsTrigger>
                  </TabsList>

                  {/* Deposit Tab */}
                  <TabsContent value="deposit" className="space-y-4 mt-6">
                    <GlowInput
                      label="Amount (SOL)"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.1"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      gradientFrom="#a855f7"
                      gradientTo="#c084fc"
                    />

                    {depositSuccess && (
                      <Alert className="bg-green-500/10 border-green-500/50">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <AlertDescription className="text-green-500">
                          Deposit successful! Note saved locally and downloaded.
                        </AlertDescription>
                      </Alert>
                    )}

                    <Button
                      className="w-full h-12 bg-gradient-to-r from-purple-500 to-primary hover:from-purple-600 hover:to-primary/90 transition-all duration-300"
                      onClick={handleDeposit}
                      disabled={depositLoading || !depositAmount}
                    >
                      {depositLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Processing Deposit...
                        </>
                      ) : (
                        <>
                          <ArrowDownToLine className="h-4 w-4 mr-2" />
                          Deposit to Privacy Pool
                        </>
                      )}
                    </Button>

                    <Alert className="bg-muted/30 border-border/50">
                      <Info className="h-4 w-4 text-purple-500" />
                      <AlertDescription className="text-xs">
                        A note file will be automatically downloaded. <strong>Keep it safe</strong> - you need it to withdraw your funds later.
                      </AlertDescription>
                    </Alert>

                    {/* Saved Notes */}
                    {notes.length > 0 && (
                      <div className="space-y-2 pt-4 border-t border-border/50">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <Lock className="h-4 w-4" />
                          Your Deposit Notes ({notes.length})
                        </Label>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {notes.map(note => (
                            <div
                              key={note.commitment}
                              className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50"
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-purple-500/10">
                                  <Lock className="h-4 w-4 text-purple-400" />
                                </div>
                                <div>
                                  <p className="font-medium">{formatAmount(note.amount)} SOL</p>
                                  <p className="text-xs text-muted-foreground">
                                    {note.leafIndex !== undefined ? (
                                      <span className="text-green-400">✓ Settled (index {note.leafIndex})</span>
                                    ) : (
                                      <span className="text-amber-400">⏳ Pending settlement...</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => downloadNote(note)}
                                  title="Download note"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => copyNote(note)}
                                  title="Copy note"
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-red-400 hover:text-red-500"
                                  onClick={() => deleteNote(note.commitment)}
                                  title="Delete note"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* Withdraw Tab */}
                  <TabsContent value="withdraw" className="space-y-4 mt-6">
                    {/* Import Note */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Import Deposit Note</Label>
                      <div className="relative">
                        <input
                          type="file"
                          accept=".json"
                          onChange={importNote}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        <div className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors bg-muted/20">
                          <Upload className="h-5 w-5 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Click or drag to upload note file</span>
                        </div>
                      </div>
                    </div>

                    {/* Select Note */}
                    {notes.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Select Note to Withdraw</Label>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {notes.map(note => (
                            <button
                              key={note.commitment}
                              onClick={() => setSelectedNote(note)}
                              className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-300 ${
                                selectedNote?.commitment === note.commitment
                                  ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                                  : 'border-border hover:border-primary/50 bg-muted/20'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={`p-2 rounded-lg ${selectedNote?.commitment === note.commitment ? 'bg-primary/20' : 'bg-muted'}`}>
                                    <Lock className={`h-4 w-4 ${selectedNote?.commitment === note.commitment ? 'text-primary' : 'text-muted-foreground'}`} />
                                  </div>
                                  <div>
                                    <p className="font-semibold">{formatAmount(note.amount)} SOL</p>
                                    {note.depositTimestamp && (
                                      <p className="text-xs text-muted-foreground">
                                        Deposited {new Date(note.depositTimestamp).toLocaleDateString()}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {note.leafIndex === undefined ? (
                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                      Pending
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />
                                      Ready
                                    </Badge>
                                  )}
                                  {selectedNote?.commitment === note.commitment && (
                                    <CheckCircle2 className="h-5 w-5 text-primary" />
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pending Settlement Warning */}
                    {selectedNote && selectedNote.leafIndex === undefined && (
                      <Alert className="bg-amber-500/10 border-amber-500/30">
                        <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
                        <AlertDescription className="text-amber-400">
                          <strong>Pending Settlement</strong> - Your deposit is being processed by the sequencer. 
                          This typically takes 1-2 minutes. Withdrawal will be enabled automatically once settled.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Settled Confirmation */}
                    {selectedNote && selectedNote.leafIndex !== undefined && (
                      <Alert className="bg-green-500/10 border-green-500/30">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <AlertDescription className="text-green-400">
                          Note settled at merkle tree index {selectedNote.leafIndex} - ready to withdraw
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Recipient Address */}
                    <GlowInput
                      label="Recipient Address (optional)"
                      type="text"
                      placeholder="Leave empty to withdraw to your wallet"
                      value={withdrawRecipient}
                      onChange={(e) => setWithdrawRecipient(e.target.value)}
                      gradientFrom="#06b6d4"
                      gradientTo="#22d3ee"
                    />

                    {withdrawSuccess && (
                      <Alert className="bg-green-500/10 border-green-500/50">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <AlertDescription className="text-green-500">
                          Withdrawal successful! Funds sent privately.
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Partial Withdrawal Amount */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Withdraw Amount (SOL)
                  <span className="text-[10px] text-slate-400 ml-1">
                    (leave empty for full withdrawal)
                  </span>
                </Label>
                <GlowInput
                  type="number"
                  step="0.001"
                  min="0.001"
                  max={selectedNote ? (parseFloat(selectedNote.amount) / 1e9).toString() : undefined}
                  placeholder={selectedNote ? `Max: ${(parseFloat(selectedNote.amount) / 1e9).toFixed(4)} SOL` : 'Select a note first'}
                  value={withdrawAmount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWithdrawAmount(e.target.value)}
                  disabled={!selectedNote}
                />
                {withdrawAmount && selectedNote && (
                  <p className="text-xs text-slate-400">
                    Withdrawing {parseFloat(withdrawAmount).toFixed(4)} SOL
                    {parseFloat(withdrawAmount) < parseFloat(selectedNote.amount) / 1e9
                      ? ` — remaining ${((parseFloat(selectedNote.amount) / 1e9) - parseFloat(withdrawAmount)).toFixed(4)} SOL will become a new note`
                      : ' (full withdrawal)'}
                  </p>
                )}
              </div>

              <Button
                      className="w-full h-12 bg-gradient-to-r from-cyan-500 to-primary hover:from-cyan-600 hover:to-primary/90 transition-all duration-300"
                      onClick={handleWithdraw}
                      disabled={withdrawLoading || !selectedNote || selectedNote?.leafIndex === undefined}
                    >
                      {withdrawLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Processing Withdrawal...
                        </>
                      ) : (
                        <>
                          <ArrowUpFromLine className="h-4 w-4 mr-2" />
                          Withdraw with ZK Proof
                        </>
                      )}
                    </Button>

                    <Alert className="bg-muted/30 border-border/50">
                      <Shield className="h-4 w-4 text-cyan-500" />
                      <AlertDescription className="text-xs">
                        Withdrawals use Groth16 zero-knowledge proofs. Your deposit <strong>cannot be linked</strong> to this withdrawal.
                      </AlertDescription>
                    </Alert>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </GlowCard>

            {/* Info Cards */}
            <div className="grid md:grid-cols-2 gap-4">
              <GlowCard gradientFrom="#a855f7" gradientTo="#c084fc" glowIntensity="low" animated={false}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lock className="h-4 w-4 text-purple-500" />
                    Privacy Features
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-500" />Groth16 zero-knowledge proofs</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-500" />Poseidon hash commitments</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-500" />Merkle tree membership proofs</p>
                  <p className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3 text-green-500" />Multi-asset shielded pool</p>
                </CardContent>
              </GlowCard>

              <GlowCard gradientFrom="#06b6d4" gradientTo="#22d3ee" glowIntensity="low" animated={false}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Info className="h-4 w-4 text-cyan-500" />
                    How It Works
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p className="flex items-center gap-2"><span className="text-purple-400">1.</span> Deposit SOL into the shielded pool</p>
                  <p className="flex items-center gap-2"><span className="text-purple-400">2.</span> Save your secret note file safely</p>
                  <p className="flex items-center gap-2"><span className="text-purple-400">3.</span> Wait for sequencer settlement (~1 min)</p>
                  <p className="flex items-center gap-2"><span className="text-purple-400">4.</span> Withdraw privately to any address</p>
                </CardContent>
              </GlowCard>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}