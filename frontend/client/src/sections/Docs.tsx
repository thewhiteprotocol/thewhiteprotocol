import { useState } from "react";
import { Book, ChevronDown, ChevronRight, Lock, Zap, Shield, Code, Coins, RefreshCw } from "lucide-react";

const docs = [
  {
    icon: Book,
    title: "Getting Started",
    content: "The White Protocol is a multi-chain privacy protocol. Connect your wallet at app.thewhiteprotocol.com, deposit tokens into the shielded pool, and withdraw privately to any address. All user data — notes, invoices, and receipts — is encrypted with AES-GCM and stored locally in your browser.",
  },
  {
    icon: Lock,
    title: "How Privacy Works",
    content: "When you deposit, your tokens enter a shared pool and you receive a cryptographic note. This note proves ownership without revealing which deposit is yours. When withdrawing, a Groth16 zero-knowledge proof is generated in your browser to verify your claim without ever linking it to the original deposit.",
  },
  {
    icon: Zap,
    title: "Deposit Flow",
    content: "1. Choose amount and token\n2. Approve token transfer in your wallet\n3. Generate commitment (client-side)\n4. Submit to the privacy pool\n5. Save your encrypted note\n\nDeposits go to a pending buffer and are batched into the Merkle tree by the sequencer.",
  },
  {
    icon: Shield,
    title: "Withdraw Flow",
    content: "1. Select a settled note\n2. Enter recipient address\n3. Generate ZK proof in-browser (30-60 seconds)\n4. Submit via relayer for gasless withdrawal\n5. Receive tokens privately\n\nIf the relayer is unavailable, you can still withdraw directly on-chain.",
  },
  {
    icon: Coins,
    title: "Business Tier",
    content: "Upgrade to Business to unlock:\n\n• Private invoicing with branded payment links\n• Automatic PDF receipt generation\n• Accounting exports (QuickBooks, Xero, CSV)\n• Public pay pages that settle privately\n\nPerfect for freelancers, agencies, and crypto-native businesses.",
  },
  {
    icon: RefreshCw,
    title: "Batch Settlement",
    content: "The protocol uses a two-phase deposit system:\n\n1. Deposit Phase: Commitments enter a pending buffer\n2. Settlement Phase: The sequencer batches up to 16 commits\n3. A batch proof is generated off-chain\n4. The Merkle tree is updated on-chain in a single transaction\n\nThis amortizes costs and keeps on-chain verification bounded.",
  },
  {
    icon: Code,
    title: "Technical Details",
    content: "• Groth16 proofs on BN254 curve\n• Poseidon hash for commitments\n• 20-level Merkle tree (~1M capacity)\n• Nullifiers prevent double-spending\n• On-chain verification via alt_bn128\n• Circuits: Deposit, Withdraw, Membership, Merkle Batch Update\n• 100% open source: github.com/thewhiteprotocol",
  },
];

export function Docs() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="docs" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Documentation
          </h2>
          <p className="text-lg text-zinc-400">
            Learn how to use The White Protocol
          </p>
        </div>

        <div className="space-y-4">
          {docs.map((doc, index) => (
            <div
              key={doc.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden transition-all hover:bg-white/[0.04]"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full p-6 flex items-center gap-4 text-left transition-colors"
              >
                <div className={`p-3 rounded-xl transition-all border ${
                  openIndex === index 
                    ? "bg-cyan-500/10 border-cyan-500/20" 
                    : "bg-white/[0.03] border-white/[0.06]"
                }`}>
                  <doc.icon className={`h-5 w-5 ${openIndex === index ? "text-cyan-400" : "text-zinc-400"}`} />
                </div>
                <span className={`flex-1 font-bold ${openIndex === index ? "text-cyan-400" : "text-white"}`}>
                  {doc.title}
                </span>
                {openIndex === index ? (
                  <ChevronDown className="h-5 w-5 text-cyan-400" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-zinc-500" />
                )}
              </button>
              
              {openIndex === index && (
                <div className="px-6 pb-6">
                  <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06]">
                    <p className="text-sm text-zinc-300 whitespace-pre-line leading-relaxed">
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
