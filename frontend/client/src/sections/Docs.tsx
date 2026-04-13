import { useState } from "react";
import { Book, ChevronDown, ChevronRight, Lock, Zap, Shield, Code, Coins, RefreshCw } from "lucide-react";

const docs = [
  {
    icon: Book,
    title: "Getting Started",
    content: "The White Protocol enables private transactions on Solana and Base using zero-knowledge proofs. Connect your wallet, deposit tokens into the privacy pool, and withdraw privately to any address. This is a 100% open source protocol.",
  },
  {
    icon: Lock,
    title: "How Privacy Works",
    content: "When you deposit, your tokens are added to a shared pool and you receive a cryptographic note. This note proves ownership without revealing which deposit is yours. Withdrawals use ZK proofs to verify your claim without linking to the original deposit.",
  },
  {
    icon: Zap,
    title: "Deposit Flow",
    content: "1. Enter amount and connect wallet\n2. Approve token transfer\n3. Generate commitment (off-chain)\n4. Submit to privacy pool\n5. Save your secret note file\n\nThe note file is your key to withdraw - keep it safe!\n\nDeposits go to a pending buffer and are settled by the sequencer in batches.",
  },
  {
    icon: Shield,
    title: "Withdraw Flow",
    content: "1. Load your saved note file\n2. Enter recipient address\n3. Generate ZK proof (30-60 seconds)\n4. Submit proof to relayer\n5. Receive tokens privately\n\nYour withdrawal cannot be linked to your deposit.\n\nNote: Current API supports full withdrawals only. Partial withdrawals coming soon.",
  },
  {
    icon: Coins,
    title: "Yield Earn (LST Support)",
    content: "pSOL v2 supports yield-bearing assets like Liquid Staking Tokens:\n\n• JitoSOL, mSOL, bSOL supported\n• Deposit LSTs and keep earning staking yield\n• Tokens appreciate while in the shielded pool\n• 5% performance fee on gains only (not principal)\n• Example: Deposit 100 JitoSOL → grows to 105 → receive 104.75\n\nYield is calculated off-chain by the yield relayer.",
  },
  {
    icon: RefreshCw,
    title: "Batch Settlement",
    content: "pSOL uses a two-phase deposit flow:\n\n1. Deposit Phase: Your commitment goes to pending buffer\n2. Settlement Phase: Sequencer batches commits (up to 16)\n3. Batch proof generated off-chain\n4. Merkle tree updated on-chain\n\nThis design keeps on-chain verification bounded and amortizes costs across multiple deposits.",
  },
  {
    icon: Code,
    title: "Technical Details",
    content: "• Groth16 proofs on BN254 curve\n• Poseidon hash for commitments\n• 20-level Merkle tree (~1M capacity)\n• Nullifiers prevent double-spending\n• On-chain verification via alt_bn128\n• Circuits: Deposit (807), Withdraw (12,330), Membership (11,807), BatchUpdate (466,858)\n• Chains: Solana Devnet & Base Sepolia\n• 100% open source: github.com/thewhiteprotocol",
  },
];

export function Docs() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="docs" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-700 mb-4">
            Documentation
          </h2>
          <p className="text-lg text-slate-500">
            Learn how to use The White Protocol
          </p>
        </div>

        <div className="space-y-4">
          {docs.map((doc, index) => (
            <div
              key={doc.title}
              className="bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff] overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full p-6 flex items-center gap-4 text-left hover:bg-[#E0E5EC]/80 transition-colors"
              >
                <div className={`p-3 bg-[#E0E5EC] rounded-xl transition-all ${
                  openIndex === index 
                    ? "shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]" 
                    : "shadow-[4px_4px_8px_#b8b9be,-4px_-4px_8px_#ffffff]"
                }`}>
                  <doc.icon className={`h-5 w-5 ${openIndex === index ? "text-blue-500" : "text-slate-500"}`} />
                </div>
                <span className={`flex-1 font-bold ${openIndex === index ? "text-blue-500" : "text-slate-700"}`}>
                  {doc.title}
                </span>
                {openIndex === index ? (
                  <ChevronDown className="h-5 w-5 text-blue-500" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                )}
              </button>
              
              {openIndex === index && (
                <div className="px-6 pb-6">
                  <div className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]">
                    <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">
                      {doc.content}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
