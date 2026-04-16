import { Shield, Lock, Cpu, Database, Globe, Zap } from "lucide-react";

const features = [
  {
    icon: Globe,
    title: "Multi-Chain by Design",
    description: "Deployed on Solana Devnet and Base Sepolia. Same privacy guarantees, adapted to each chain's architecture. One app, two ecosystems.",
  },
  {
    icon: Lock,
    title: "Client-Side Proof Generation",
    description: "Your secret and nullifier never leave the browser. Groth16 ZK proofs are generated locally and only public signals are sent to the relayer.",
  },
  {
    icon: Cpu,
    title: "Cryptographic Stack",
    description: "Poseidon hashes for commitments, Keccak256 for Merkle trees on Base, Groth16 on BN254. Verification keys stored and checked on-chain.",
  },
  {
    icon: Zap,
    title: "Gasless Relayer",
    description: "The relayer submits withdrawal transactions and pays the gas. Users enjoy private withdrawals without holding native tokens for fees.",
  },
];

export function Architecture() {
  return (
    <section id="architecture" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Architecture
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            A deep dive into the technical foundations of The White Protocol
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:bg-white/[0.05] hover:border-cyan-500/20"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-cyan-500/10 transition-all group-hover:scale-110">
                  <feature.icon className="h-6 w-6 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-8">
          <h3 className="text-xl font-bold text-white mb-6">Technical Stack</h3>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
                Core Features
              </h4>
              <div className="space-y-3">
                {[
                  "Deposit SPL or ERC-20 tokens into a privacy pool",
                  "Send and receive privately across chains",
                  "Withdraw to any wallet via relayer or direct",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <div className="w-2 h-2 rounded-full bg-cyan-400"></div>
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
                Cryptographic Stack
              </h4>
              <div className="space-y-3">
                {[
                  "Poseidon hash for commitments",
                  "Groth16 on BN254 curve",
                  "20-level Merkle tree (~1M capacity)",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-sm text-zinc-400">
              <span className="font-bold text-white">Note:</span> Currently deployed on Solana Devnet and Base Sepolia. Mainnet deployment is planned after comprehensive security audits.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
