import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SUPPORTED_ASSETS, getAssetBySymbol, formatTokenAmount, parseTokenAmount, type AssetSymbol } from '../lib/assets';
import { 
  Lock, 
  ArrowRight, 
  CheckCircle, 
  Wallet,
  Send,
  User,
  ChevronDown,
  AlertCircle,
  Upload,
  Download,
  Trash2,
  Loader2,
  Eye
} from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { 
  createDepositNote, 
  prepareWithdrawal, 
  submitWithdrawal, 
  getNoteStatus,
  buildDepositTx,
  hexToBytes,
  bytesToHex
} from '../lib/relayer-api';
import { ensureAtaAndWrapIfNeeded } from "../lib/token-prereqs";

const RELAYER_API_URL = import.meta.env.VITE_RELAYER_API_URL;
const WRAPPED_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Dev-only logger - never logs in production
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
const devLog = (...args: any[]) => { if (isDev) devLog(...args); };

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

function solToLamports(solString: string): string {
  const trimmed = solString.trim();
  if (!trimmed || !/^\d*\.?\d+$/.test(trimmed)) throw new Error('Invalid SOL amount');
  const [whole, decimal = ''] = trimmed.split('.');
  const paddedDecimal = decimal.padEnd(9, '0').slice(0, 9);
  const lamportsStr = (whole || '0') + paddedDecimal;
  return lamportsStr.replace(/^0+/, '') || '0';
}

function formatAmount(amount: string): string {
  try {
    const lamports = BigInt(amount);
    return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
  } catch {
    return '0.0000';
  }
}

function validateNote(note: unknown): note is SerializedNote {
  if (!note || typeof note !== 'object') return false;
  const n = note as Record<string, unknown>;
  const requiredStrings = ['secret', 'nullifier', 'commitment', 'nullifierHash', 'amount', 'assetId'];
  for (const field of requiredStrings) {
    if (typeof n[field] !== 'string' || !n[field]) return false;
  }
  try {
    const amt = BigInt(n.amount as string);
    if (amt <= 0n) return false;
  } catch { return false; }
  return true;
}

function getStorageKey(walletPubkey: string): string {
  return `psol_notes_${walletPubkey}`;
}

export default function DepositWithdrawUI() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState('deposit');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [selectedNote, setSelectedNote] = useState<SerializedNote | null>(null);
  const [notes, setNotes] = useState<SerializedNote[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetSymbol>("SOL");
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const [showNotes, setShowNotes] = useState(false);
  
  const [status, setStatus] = useState('IDLE');
  const [depositLoading, setDepositLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  
  // Track which notes have already triggered settlement toast (prevents duplicates)
  const notifiedSettlements = useRef<Set<string>>(new Set());

  // Load notes from localStorage
  useEffect(() => {
    if (!publicKey) { setNotes([]); return; }
    try {
      const stored = localStorage.getItem(getStorageKey(publicKey.toBase58()));
      if (stored) {
        const parsedNotes = JSON.parse(stored);
        setNotes(parsedNotes.filter(validateNote));
      }
    } catch { setNotes([]); }
  }, [publicKey]);

  // Save notes
  const saveNotes = useCallback((updatedNotes: SerializedNote[]) => {
    if (publicKey) {
      localStorage.setItem(getStorageKey(publicKey.toBase58()), JSON.stringify(updatedNotes));
    }
    setNotes(updatedNotes);
  }, [publicKey]);

  // Poll for note settlement
  useEffect(() => {
    if (!RELAYER_API_URL) return;
    const checkNoteStatus = async () => {
      const pendingNotes = notes.filter(n => n.leafIndex === undefined);
      if (pendingNotes.length === 0) return;
      try {
        const results = await Promise.allSettled(
          pendingNotes.map(async (note) => {
            const s = await getNoteStatus(note.commitment);
            return { commitment: note.commitment, status: s };
          })
        );
        const updates: Map<string, number> = new Map();
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { commitment, status: s } = result.value;
            if (s.status === 'settled' && s.leafIndex !== undefined) {
              updates.set(commitment, s.leafIndex);
              // Only show toast if we haven't notified about this note before
              if (!notifiedSettlements.current.has(commitment)) {
                notifiedSettlements.current.add(commitment);
                toast({ variant: "success", title: "Note Settled!", description: `Ready to withdraw at index ${s.leafIndex}` });
              }
            }
          }
        }
        if (updates.size > 0) {
          setNotes(currentNotes => {
            const newNotes = currentNotes.map(n => {
              const leafIndex = updates.get(n.commitment);
              return leafIndex !== undefined ? { ...n, leafIndex } : n;
            });
            if (publicKey) localStorage.setItem(getStorageKey(publicKey.toBase58()), JSON.stringify(newNotes));
            return newNotes;
          });
        }
      } catch (error) { console.error('[Poll] Error:', error); }
    };
    checkNoteStatus();
    const interval = setInterval(checkNoteStatus, 10000);
    return () => clearInterval(interval);
  }, [notes.length, publicKey, toast]);

  // Fetch balance
  // Fetch all token balances
  const fetchBalances = useCallback(async () => {
    if (!publicKey) return;
    try {
      // SOL balance
      const solBal = await connection.getBalance(publicKey);
      setBalance(solBal / LAMPORTS_PER_SOL);
      
      // Token balances
      const balances: Record<string, string> = { SOL: solBal.toString() };
      
      for (const asset of SUPPORTED_ASSETS) {
        if (asset.isNative) continue;
        try {
          const mint = new PublicKey(asset.mint);
          const ata = await import('@solana/spl-token').then(m => 
            m.getAssociatedTokenAddressSync(mint, publicKey)
          );
          const info = await connection.getTokenAccountBalance(ata);
          balances[asset.symbol] = info.value.amount;
        } catch {
          balances[asset.symbol] = '0';
        }
      }
      setTokenBalances(balances);
    } catch (e) {
      console.error('fetchBalances error:', e);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    if (connected && publicKey) fetchBalances();
  }, [connected, publicKey, fetchBalances]);

  // DEPOSIT HANDLER
  const handleDeposit = async () => {
    if (!RELAYER_API_URL || !publicKey || !connected || !anchorWallet) {
      toast({ title: "Not ready", description: "Please connect your wallet", variant: "destructive" });
      return;
    }

    setDepositLoading(true);
    setStatus('PROVING');

    try {
      const asset = getAssetBySymbol(selectedAsset);
      const mintPubkey = new PublicKey(asset.mint);
      const amountBaseUnits = parseTokenAmount(amount, asset.decimals);
      
      if (BigInt(amountBaseUnits) < 1000n) {
        toast({ title: "Amount too small", description: "Minimum deposit required", variant: "destructive" });
        return;
      }
      
      const note = await createDepositNote(asset.mint, amountBaseUnits);
      setStatus('BUFFERED');

      await ensureAtaAndWrapIfNeeded({
        connection, owner: publicKey, payer: publicKey,
        mint: mintPubkey, requiredAmountBaseUnits: BigInt(amountBaseUnits), sendTransaction,
      });

      let proofHex = note.proofData;
      const proofBytes = hexToBytes(proofHex);
      if (proofBytes.length !== 256) throw new Error(`Invalid proof length: ${proofBytes.length}`);
      proofHex = bytesToHex(proofBytes);

      const txData = await buildDepositTx({
        amount: amountBaseUnits, commitment: note.commitment, assetIdHex: note.assetIdHex,
        proofData: proofHex, depositorPubkey: publicKey.toBase58(), mint: asset.mint,
      });

      setStatus('BATCHING');

      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(Buffer.from(txData.transaction, "base64"));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signedTx = await anchorWallet.signTransaction(tx);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight });

      const serializedNote: SerializedNote = {
        secret: note.secret, nullifier: note.nullifier, commitment: note.commitment,
        nullifierHash: note.nullifierHash, amount: amountBaseUnits, assetId: note.assetId,
        depositTimestamp: Date.now(), depositSignature: signature,
      };
      saveNotes([...notes, serializedNote]);

      // Auto-download note file
      const blob = new Blob([JSON.stringify(serializedNote, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `psol-note-${serializedNote.commitment.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus('SETTLED');
      setAmount('');
      await fetchBalances();
      toast({ variant: "success", title: "Deposit Successful! 🎉", description: <span>Note auto-downloaded. <a href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} target="_blank" rel="noopener" className="underline text-blue-500">View TX ↗</a></span> });
    } catch (error: any) {
      console.error('[Deposit] Error:', error);
      setStatus('IDLE');
      let msg = error?.message || "Unknown error";
      if (msg.includes('User rejected')) msg = "Transaction cancelled";
      if (msg.includes('insufficient')) msg = "Insufficient balance";
      toast({ title: "Deposit failed", description: msg, variant: "destructive" });
    } finally {
      setDepositLoading(false);
    }
  };

  // WITHDRAW HANDLER
  const handleWithdraw = async () => {
    if (!RELAYER_API_URL || !publicKey || !connected || !selectedNote) {
      toast({ title: "Not ready", description: "Connect wallet and select a note", variant: "destructive" });
      return;
    }
    if (selectedNote.leafIndex === undefined) {
      toast({ title: "Note not settled", description: "Wait for settlement (~1-2 min)", variant: "destructive" });
      return;
    }

    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = recipient ? new PublicKey(recipient) : publicKey;
    } catch {
      toast({ title: "Invalid address", description: "Enter a valid Solana address", variant: "destructive" });
      return;
    }

    setWithdrawLoading(true);
    setStatus('PROVING');

    try {
      toast({ variant: "loading", title: "Generating ZK Proof", description: "This takes 30-60 seconds..." });
      
      // Compute effective withdrawal amount (lamports) - safe string-based conversion
      const effectiveWithdrawAmount = withdrawAmount
        ? (() => {
            const parts = withdrawAmount.split('.');
            const whole = parts[0] || '0';
            const frac = (parts[1] || '').padEnd(9, '0').slice(0, 9);
            return String(BigInt(whole) * BigInt(1_000_000_000) + BigInt(frac));
          })()
        : selectedNote.amount;

      // Validate partial withdrawal amount
      const withdrawLamports = BigInt(effectiveWithdrawAmount);
      const noteLamports = BigInt(selectedNote.amount);
      if (withdrawLamports <= 0n) {
        toast({ title: "Invalid amount", description: "Withdrawal amount must be positive", variant: "destructive" });
        setWithdrawLoading(false);
        return;
      }
      if (withdrawLamports > noteLamports) {
        toast({ title: "Amount too large", description: "Cannot withdraw more than the note value", variant: "destructive" });
        setWithdrawLoading(false);
        return;
      }
      const MIN_CHANGE = BigInt(1_000_000); // 0.001 SOL minimum change
      if (withdrawLamports < noteLamports && (noteLamports - withdrawLamports) < MIN_CHANGE) {
        toast({ title: "Remaining too small", description: "Change note must be at least 0.001 SOL. Withdraw the full amount instead.", variant: "destructive" });
        setWithdrawLoading(false);
        return;
      }

      // Mark note as spending to prevent double-withdrawal
      const updatedNotesPreSpend = notes.map(n =>
        n.commitment === selectedNote.commitment ? { ...n, status: 'spending' as any } : n
      );
      saveNotes(updatedNotesPreSpend);

      const withdrawResult = await prepareWithdrawal(
        { secret: selectedNote.secret, nullifier: selectedNote.nullifier, amount: selectedNote.amount,
          assetId: selectedNote.assetId, nullifierHash: selectedNote.nullifierHash },
        recipientPubkey.toBase58(), publicKey.toBase58(), selectedNote.leafIndex,
        effectiveWithdrawAmount
      );

      setStatus('VERIFYING');
      const noteMint = SUPPORTED_ASSETS.find(a => a.mint === selectedNote.assetId)?.mint || SUPPORTED_ASSETS[0].mint;
      const result = await submitWithdrawal({
        recipient: recipientPubkey.toBase58(), amount: effectiveWithdrawAmount, mint: noteMint,
        merkleRoot: withdrawResult.merkleRoot, nullifierHash: withdrawResult.nullifierHash,
        proofData: withdrawResult.proofData, relayerFee: withdrawResult.relayerFee || withdrawResult.fee,
        assetId: withdrawResult.assetId, changeCommitment: withdrawResult.changeCommitment,
      });

      setStatus('COMPLETED');

      // Handle notes: remove spent note, add change note if partial
      let updatedNotes = notes.filter(n => n.commitment !== selectedNote.commitment);
      if (withdrawResult.changeNote) {
        // nullifierHash will be computed by the relayer when this change note is used for withdrawal.
        // The relayer computes it from (secret, nullifier, leafIndex) using Poseidon hash.
        const changeNote = {
          secret: withdrawResult.changeNote.secret,
          nullifier: withdrawResult.changeNote.nullifier,
          amount: withdrawResult.changeNote.amount,
          assetId: withdrawResult.changeNote.assetId,
          commitment: withdrawResult.changeNote.commitment,
          nullifierHash: 'PENDING_COMPUTATION',
          status: 'pending' as const,
        };
        updatedNotes.push(changeNote as any);
        devLog('[Withdraw] Change note saved:', changeNote.commitment?.slice(0, 20) + '...',
          'amount:', (parseFloat(changeNote.amount) / 1e9).toFixed(4), 'SOL');
      }

      saveNotes(updatedNotes);
      setSelectedNote(null);
      setWithdrawAmount('');
      await fetchBalances();
      toast({ variant: "success", title: "Withdrawal Successful! 🎉", description: <span>Funds received! <a href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noopener" className="underline text-blue-500">View TX ↗</a></span> });
    } catch (error: any) {
      console.error('[Withdraw] Error:', error);
      setStatus('IDLE');
      // Restore note status on failure
      const restoredNotes = notes.map(n =>
        n.commitment === selectedNote.commitment ? { ...n, status: n.leafIndex !== undefined ? 'settled' : 'pending' } : n
      );
      saveNotes(restoredNotes as any);
      toast({ title: "Withdrawal failed", description: error?.message || "Unknown error", variant: "destructive" });
    } finally {
      setWithdrawLoading(false);
    }
  };

  // Note management
  const importNote = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!validateNote(imported)) {
        toast({ title: "Invalid note", description: "Missing required fields", variant: "destructive" });
        return;
      }
      if (notes.some(n => n.commitment === imported.commitment)) {
        toast({ title: "Note exists", description: "Already in your list", variant: "destructive" });
        return;
      }
      saveNotes([...notes, imported]);
      toast({ title: "Note imported", description: "Successfully imported" });
    } catch {
      toast({ title: "Import failed", description: "Invalid JSON file", variant: "destructive" });
    }
    event.target.value = '';
  };

  const downloadNote = (note: SerializedNote) => {
    const blob = new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psol-note-${note.commitment.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: "Keep this file safe!" });
  };

  const deleteNote = (note: SerializedNote) => {
    if (!confirm("Delete this note? Make sure you have a backup!")) return;
    saveNotes(notes.filter(n => n.commitment !== note.commitment));
    if (selectedNote?.commitment === note.commitment) setSelectedNote(null);
    // Clean up notified settlements for deleted note
    notifiedSettlements.current.delete(note.commitment);
    toast({ title: "Note deleted" });
  };

  const reset = () => {
    setStatus('IDLE');
    setAmount('');
    setRecipient('');
    setSelectedNote(null);
  };

  const isProcessing = depositLoading || withdrawLoading;
  const pendingCount = notes.filter(n => n.leafIndex === undefined).length;
  const readyCount = notes.filter(n => n.leafIndex !== undefined).length;

  // Compute total shielded balance from unspent notes
  const shieldedBalance = useMemo(() => {
    if (!notes || notes.length === 0) return 0;
    const totalLamports = notes.reduce((sum, note) => {
      if (note.status === 'spent') return sum;
      try {
        return sum + BigInt(note.amount);
      } catch {
        return sum;
      }
    }, BigInt(0));
    return Number(totalLamports) / 1e9;
  }, [notes]);

  const getStepStatus = (step: number) => {
    let currentStepIndex = 0;
    if (activeTab === 'deposit') {
      currentStepIndex = status === 'IDLE' ? 0 : status === 'PROVING' ? 1 : status === 'BUFFERED' ? 2 : status === 'BATCHING' ? 2 : 3;
    } else {
      currentStepIndex = status === 'IDLE' ? 0 : status === 'PROVING' ? 1 : status === 'VERIFYING' ? 2 : 3;
    }
    if (currentStepIndex > step) return 'completed';
    if (currentStepIndex === step) return 'active';
    return 'pending';
  };

  // Not connected
  if (!connected) {
    return (
      <div className="w-full max-w-[420px] mx-auto">
        <div className="bg-[#1a1a1e] rounded-[2rem] p-8 border border-white/[0.06] text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#252529] border border-white/[0.08] flex items-center justify-center">
            <Wallet size={32} className="text-slate-500" />
          </div>
          <h3 className="text-xl font-bold text-slate-300 mb-2">Connect Wallet</h3>
          <p className="text-slate-500 mb-6">Connect your Solana wallet to use pSOL Protocol</p>
          <div className="flex justify-center">
            <WalletMultiButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[420px] mx-auto">
      {/* Balance & Notes Summary */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="px-4 py-2 bg-[#1a1a1e] rounded-xl border border-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
          <div className="flex flex-col">
            <div>
              <span className="text-xs text-slate-500 font-bold">Balance: </span>
              <span className="text-sm font-bold text-slate-200">{tokenBalances[selectedAsset] ? formatTokenAmount(tokenBalances[selectedAsset], getAssetBySymbol(selectedAsset).decimals) : "..."} {selectedAsset}</span>
            </div>
            {notes.length > 0 && (
              <div className="flex items-center gap-2 text-sm mt-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400/80 animate-pulse" />
                <span className="text-slate-500 font-medium">Shielded:</span>
                <span className="font-bold text-emerald-400/90">
                  {shieldedBalance.toFixed(4)} SOL
                </span>
                <span className="text-xs text-slate-500">
                  ({notes.filter(n => n.status !== 'spent').length} note{notes.filter(n => n.status !== 'spent').length !== 1 ? 's' : ''})
                </span>
              </div>
            )}
          </div>
        </div>
        {notes.length > 0 && (
          <button 
            onClick={() => setShowNotes(!showNotes)}
            className="px-4 py-2 bg-[#1a1a1e] rounded-xl border border-white/[0.06] hover:border-white/[0.10] hover:bg-[#1e1e22] transition-all flex items-center gap-2"
          >
            <Eye size={14} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-400">
              {pendingCount > 0 && <span className="text-amber-400/80">{pendingCount} pending</span>}
              {pendingCount > 0 && readyCount > 0 && ' · '}
              {readyCount > 0 && <span className="text-emerald-400/80">{readyCount} ready</span>}
            </span>
          </button>
        )}
      </div>

      {/* Notes Panel (collapsible) */}
      {showNotes && notes.length > 0 && (
        <div className="mb-4 p-4 bg-[#1a1a1e] rounded-2xl border border-white/[0.06]">
          <div className="flex items-center justify-between px-2 mb-3">
            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
              Your Shielded Notes
            </span>
            <div className="flex gap-3 text-[10px]">
              {notes.filter(n => n.leafIndex !== undefined && n.status !== 'spent' && n.status !== 'spending').length > 0 && (
                <span className="text-emerald-400/80 font-bold">
                  {notes.filter(n => n.leafIndex !== undefined && n.status !== 'spent' && n.status !== 'spending').length} Ready
                </span>
              )}
              {notes.filter(n => n.leafIndex === undefined && n.status !== 'spent').length > 0 && (
                <span className="text-amber-400/80 font-bold">
                  {notes.filter(n => n.leafIndex === undefined && n.status !== 'spent').length} Pending
                </span>
              )}
            </div>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {notes.map(note => (
              <div key={note.commitment} className="flex items-center justify-between p-2 bg-[#1e1e22] rounded-xl border border-white/[0.04] hover:border-white/[0.08] transition-colors">
                <div className="flex items-center gap-2">
                  <Lock size={12} className="text-slate-500" />
                  <span className="text-sm font-bold text-slate-300">{formatAmount(note.amount)} SOL</span>
                  {note.leafIndex === undefined ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 font-bold flex items-center gap-1 border border-amber-500/20">
                      <Loader2 size={8} className="animate-spin" /> Settling...
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400/80 font-bold border border-emerald-500/20">
                      Ready #{note.leafIndex}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => downloadNote(note)} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-slate-500 hover:text-blue-400 transition-colors">
                    <Download size={12} />
                  </button>
                  <button onClick={() => deleteNote(note)} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="bg-[#1a1a1e] rounded-2xl p-2 border border-white/[0.06] mb-6 flex">
        <button 
          onClick={() => { setActiveTab('deposit'); reset(); }}
          disabled={isProcessing}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
            activeTab === 'deposit' 
            ? 'text-blue-400 bg-[#252529] border border-white/[0.08] shadow-sm' 
            : 'text-slate-500 hover:text-slate-300 disabled:opacity-50 hover:bg-white/[0.02]'
          }`}
        >
          Deposit
        </button>
        <button 
          onClick={() => { setActiveTab('withdraw'); reset(); }}
          disabled={isProcessing}
          className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
            activeTab === 'withdraw' 
            ? 'text-blue-400 bg-[#252529] border border-white/[0.08] shadow-sm' 
            : 'text-slate-500 hover:text-slate-300 disabled:opacity-50 hover:bg-white/[0.02]'
          }`}
        >
          Withdraw
        </button>
      </div>

      {/* Main Card */}
      <div className="bg-[#1a1a1e] rounded-[2rem] p-8 border border-white/[0.06] relative overflow-hidden">
        
        {/* Success Overlay */}
        {(status === 'SETTLED' || status === 'COMPLETED') && (
          <div className="absolute inset-0 bg-[#1a1a1e]/98 backdrop-blur-sm z-30 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-500">
            <div className="w-24 h-24 rounded-full bg-[#252529] border border-white/[0.08] flex items-center justify-center text-emerald-400 mb-6">
              <CheckCircle size={48} strokeWidth={1.5} />
            </div>
            <h3 className="text-2xl font-bold text-slate-200">
              {status === 'SETTLED' ? 'Deposit Shielded!' : 'Withdrawal Sent!'}
            </h3>
            <p className="text-slate-400 mt-2 mb-4 text-center px-6 text-sm">
              {status === 'SETTLED' 
                ? 'Note file downloaded. Keep it safe to withdraw later!'
                : 'Funds sent privately via ZK proof.'}
            </p>
            {status === 'SETTLED' && (
              <p className="text-xs text-amber-400/80 mb-4 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                Settlement takes ~1-2 min before withdrawal
              </p>
            )}
            <button onClick={reset} className="px-8 py-3 rounded-xl bg-[#252529] border border-white/[0.08] hover:border-white/[0.12] hover:bg-[#2a2a2e] text-sm font-bold text-slate-300 hover:text-blue-400 transition-all">
              Done
            </button>
          </div>
        )}

        <div className="relative z-10">
          <h2 className="text-2xl font-bold text-slate-200 mb-1 text-center">
            {activeTab === 'deposit' ? 'Shield Assets' : 'Private Withdraw'}
          </h2>
          <div className="flex justify-center items-center gap-2 mb-6 opacity-60">
            <Lock size={12} className="text-slate-500" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
              {activeTab === 'deposit' ? 'Groth16 ZK Proof' : 'Unlinkable Transfer'}
            </span>
          </div>

          {/* DEPOSIT TAB */}
          {activeTab === 'deposit' && (
            <>
              <div className="mb-4">
                <div className="flex justify-between px-2 mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Amount to Shield</span>
                  <span className="text-[10px] text-slate-500">(Min: 0.001)</span>
                  <button className="text-xs font-bold text-blue-400/80 hover:text-blue-400" onClick={() => (() => { const asset = getAssetBySymbol(selectedAsset); const bal = tokenBalances[selectedAsset] || "0"; const maxAmt = formatTokenAmount(bal, asset.decimals); setAmount(maxAmt); })()}>
                    Max
                  </button>
                </div>
                <div className="h-16 rounded-2xl bg-[#1e1e22] border border-white/[0.06] flex items-center px-4 focus-within:border-white/[0.12] transition-colors">
                  <input 
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="bg-transparent w-full text-2xl font-bold text-slate-300 outline-none placeholder-slate-600" 
                    disabled={isProcessing}
                    step="0.01"
                    min="0.001"
                  />
                  <div className="flex items-center gap-2 pl-2 pr-2 border-l border-white/[0.08]">
                    <img key={selectedAsset} src={getAssetBySymbol(selectedAsset).icon} alt={selectedAsset} className="w-6 h-6 rounded-full object-cover" />
                    <select value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value as AssetSymbol)} className="bg-transparent text-sm font-bold text-slate-400 outline-none cursor-pointer">{SUPPORTED_ASSETS.map(a => <option key={a.symbol} value={a.symbol}>{a.displayName}</option>)}</select>
                  </div>
                </div>
              </div>

              <div className="mb-6 px-2 min-h-[48px]">
                {amount && parseFloat(amount) >= 0.001 && (
                  <div className="flex items-start gap-2 text-[11px] leading-tight text-amber-400/70">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>Note file will <strong>auto-download</strong> after deposit. Keep it safe - you need it to withdraw!</span>
                  </div>
                )}
                {amount && parseFloat(amount) > 0 && parseFloat(amount) < 0.001 && (
                  <div className="flex items-start gap-2 text-[11px] text-red-400/80">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>Minimum deposit is 0.001 {selectedAsset}</span>
                  </div>
                )}
                {amount && parseFloat(amount) > 1000 && (
                  <div className="flex items-start gap-2 text-[11px] text-red-400/80">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>Maximum deposit is 1000 {selectedAsset}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* WITHDRAW TAB */}
          {activeTab === 'withdraw' && (
            <>
              {/* Import Note */}
              <div className="mb-4">
                <div className="px-2 mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Import Note File</span>
                </div>
                <div className="relative">
                  <input type="file" accept=".json" onChange={importNote} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" disabled={isProcessing} />
                  <div className="flex items-center justify-center gap-2 p-4 rounded-xl bg-[#1e1e22] border border-white/[0.06] hover:border-white/[0.10] hover:bg-[#222226] transition-all">
                    <Upload className="h-5 w-5 text-slate-500" />
                    <span className="text-sm text-slate-400">Click to upload note</span>
                  </div>
                </div>
              </div>

              {/* Note List */}
              {notes.length > 0 && (
                <div className="mb-4">
                  <div className="px-2 mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select Note ({notes.length})</span>
                  </div>
                  <div className="space-y-2 max-h-36 overflow-y-auto">
                    {notes.map(note => (
                      <div
                        key={note.commitment}
                        onClick={() => !isProcessing && note.status !== 'spending' && setSelectedNote(note)}
                        className={`p-3 rounded-xl transition-all border ${
                          note.status === 'spending'
                            ? 'bg-[#1a1a1e]/50 border-white/[0.03] opacity-50 cursor-not-allowed'
                            : selectedNote?.commitment === note.commitment
                              ? 'bg-[#252529] border-blue-500/30 cursor-pointer'
                              : 'bg-[#1e1e22] border-white/[0.04] hover:border-white/[0.08] cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Lock size={14} className={selectedNote?.commitment === note.commitment ? 'text-blue-400' : 'text-slate-500'} />
                            <span className="font-bold text-slate-300">{formatAmount(note.amount)} SOL</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {note.status === 'spending' ? (
                              <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/10 text-blue-400/80 font-bold flex items-center gap-1 border border-blue-500/20">
                                <Loader2 size={10} className="animate-spin" /> Withdrawing...
                              </span>
                            ) : note.leafIndex === undefined ? (
                              <span className="text-[10px] px-2 py-1 rounded-full bg-amber-500/10 text-amber-400/80 font-bold flex items-center gap-1 border border-amber-500/20">
                                <Loader2 size={10} className="animate-spin" /> Pending
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400/80 font-bold border border-emerald-500/20">
                                Ready
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {notes.length === 0 && (
                <div className="mb-4 p-4 rounded-xl bg-[#1e1e22] border border-white/[0.04] text-center">
                  <p className="text-sm text-slate-500">No notes found. Import a note file or make a deposit first.</p>
                </div>
              )}

              {/* Pending Warning */}
              {selectedNote && selectedNote.leafIndex === undefined && (
                <div className="mb-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <div className="flex items-center gap-2 text-amber-400/80 text-xs">
                    <Loader2 size={14} className="animate-spin" />
                    <span><strong>Pending settlement</strong> - wait ~1-2 min</span>
                  </div>
                </div>
              )}

              {/* Ready confirmation */}
              {selectedNote && selectedNote.leafIndex !== undefined && (
                <div className="mb-4 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <div className="flex items-center gap-2 text-emerald-400/80 text-xs">
                    <CheckCircle size={14} />
                    <span><strong>Ready</strong> at merkle index #{selectedNote.leafIndex}</span>
                  </div>
                </div>
              )}

              {/* Recipient */}
              <div className="mb-4">
                <div className="px-2 mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Recipient (optional)</span>
                </div>
                <div className={`h-12 rounded-xl bg-[#1e1e22] border border-white/[0.06] flex items-center px-4 focus-within:border-white/[0.12] transition-colors ${recipient ? 'border-l-2 border-l-blue-400/60' : ''}`}>
                  {recipient ? <User size={16} className="text-blue-400/80 mr-2" /> : <Wallet size={16} className="text-slate-500 mr-2" />}
                  <input 
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Empty = your wallet"
                    className="bg-transparent w-full text-sm font-medium text-slate-300 outline-none placeholder-slate-600" 
                    disabled={isProcessing}
                  />
                </div>
                <div className="px-2 mt-1 text-[10px] font-bold text-right text-blue-400/80">
                  {recipient ? 'Private Transfer' : 'Withdraw to Self'}
                </div>
              </div>

              {/* Partial Withdrawal Amount */}
              {selectedNote && selectedNote.leafIndex !== undefined && (
                <div className="mb-4">
                  <div className="px-2 mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Withdraw Amount (SOL)
                    </span>
                    <span className="text-[10px] text-slate-500 ml-1">
                      Leave empty = full withdrawal
                    </span>
                  </div>
                  <div className="h-12 rounded-xl bg-[#1e1e22] border border-white/[0.06] flex items-center px-4 focus-within:border-white/[0.12] transition-colors">
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      max={(parseFloat(selectedNote.amount) / 1e9).toString()}
                      placeholder={`Max: ${(parseFloat(selectedNote.amount) / 1e9).toFixed(4)} SOL`}
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      className="bg-transparent w-full text-sm font-medium text-slate-300 outline-none placeholder-slate-600"
                      disabled={isProcessing}
                    />
                    <span className="text-xs font-bold text-slate-500 ml-2">SOL</span>
                  </div>
                  {withdrawAmount && (
                    <div className="px-2 mt-1 text-[10px] font-bold text-slate-500">
                      {parseFloat(withdrawAmount) < parseFloat(selectedNote.amount) / 1e9
                        ? `Partial: ${parseFloat(withdrawAmount).toFixed(4)} SOL — remaining ${((parseFloat(selectedNote.amount) / 1e9) - parseFloat(withdrawAmount)).toFixed(4)} SOL becomes a new note`
                        : 'Full withdrawal'}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Action Button */}
          <button 
            onClick={() => activeTab === 'deposit' ? handleDeposit() : handleWithdraw()}
            disabled={isProcessing || (activeTab === 'deposit' ? (!amount || parseFloat(amount) < 0.001 || parseFloat(amount) > 1000) : (!selectedNote || selectedNote?.leafIndex === undefined))}
            className={`w-full h-14 rounded-2xl font-bold text-base tracking-wide transition-all duration-300 flex items-center justify-center gap-2
              ${!isProcessing && ((activeTab === 'deposit' && amount && parseFloat(amount) >= 0.001 && parseFloat(amount) <= 1000) || (activeTab === 'withdraw' && selectedNote?.leafIndex !== undefined))
                ? 'bg-[#252529] text-blue-400 border border-white/[0.08] hover:border-white/[0.12] hover:bg-[#2a2a2e] hover:scale-[1.02] active:scale-[0.98]' 
                : 'bg-[#1e1e22] text-slate-600 border border-white/[0.04] cursor-not-allowed'}
            `}
          >
            {isProcessing ? (
              <><Loader2 className="animate-spin" size={20} /> Processing...</>
            ) : activeTab === 'deposit' ? (
              <>Deposit <ArrowRight size={20} /></>
            ) : (
              <>{recipient ? 'Transfer Private' : 'Withdraw'} <Send size={20} /></>
            )}
          </button>
          
          {/* Progress Tracker */}
          {isProcessing && (
            <div className="mt-6 px-2">
              <div className="flex justify-between mb-3 relative">
                <div className="absolute top-1/2 left-0 right-0 h-1 bg-white/[0.06] -z-10 rounded-full -translate-y-1/2"></div>
                <div 
                  className="absolute top-1/2 left-0 h-1 bg-blue-400/60 -z-10 rounded-full transition-all duration-1000 ease-in-out -translate-y-1/2"
                  style={{ width: status === 'IDLE' ? '0%' : status === 'PROVING' ? '33%' : (status === 'BUFFERED' || status === 'VERIFYING') ? '66%' : '100%' }}
                ></div>
                {[0, 1, 2].map((step) => (
                  <div key={step} className="flex flex-col items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 transition-all duration-500 z-10
                      ${getStepStatus(step) === 'completed' ? 'bg-blue-400 border-blue-400 scale-110' 
                      : getStepStatus(step) === 'active' ? 'bg-[#1a1a1e] border-blue-400/60 animate-pulse' 
                      : 'bg-[#1a1a1e] border-white/[0.08]'}
                    `}></div>
                    <span className="text-[10px] font-bold uppercase tracking-tighter text-slate-500">
                      {step === 0 ? 'Proof' : step === 1 ? (activeTab === 'deposit' ? 'Build' : 'Verify') : 'Submit'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="h-6 text-center">
                <p className="text-xs font-medium text-slate-500 animate-pulse">
                  {status === 'PROVING' && (activeTab === 'deposit' ? 'Creating commitment...' : 'Generating ZK proof (30-60s)...')}
                  {status === 'BUFFERED' && 'Building transaction...'}
                  {status === 'BATCHING' && 'Submitting to Solana...'}
                  {status === 'VERIFYING' && 'Submitting withdrawal...'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
