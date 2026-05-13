import { Shield, Lock, Cpu, Database, Globe, Zap } from "lucide-react";

const features = [
  {
    icon: Globe,
    title: "Multi-Chain Settlement",
    description: "Designed for Solana, Ethereum, Base, BNB Chain, and Polygon, with TRON on the roadmap.",
  },
  {
    icon: Lock,
    title: "Local Proof Generation",
    description: "Proof inputs and private notes stay local in the browser today and in White Console for desktop workflows.",
  },
  {
    icon: Cpu,
    title: "Cryptographic Core",
    description: "Groth16 proofs, commitments, nullifiers, and Merkle roots protect private settlement flows.",
  },
  {
    icon: Zap,
    title: "Relayer + Sequencer Network",
    description: "Relayers improve withdrawal UX while sequencers batch settlement updates.",
  },
];

export function Architecture() {
  return (
    <section id="architecture" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Architecture
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Local-first privacy infrastructure for stablecoin settlement.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition-all hover:bg-white/[0.04] hover:border-white/[0.10]"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-white/[0.04]">
                  <feature.icon className="h-6 w-6 text-zinc-300" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
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

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
          <h3 className="text-xl font-semibold text-white mb-6">Technical Stack</h3>

          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
                Product Layer
              </h4>
              <div className="space-y-3">
                {[
                  "Shield stablecoins into a shared pool",
                  "Send and receive private payments",
                  "Withdraw to any wallet via relayer or direct",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-500"></div>
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
                Protocol Layer
              </h4>
              <div className="space-y-3">
                {[
                  "Groth16 proofs on BN254 curve",
                  "Poseidon hash for commitments",
                  "20-level Merkle tree (~1M capacity)",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-500"></div>
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-4">
                Infrastructure Layer
              </h4>
              <div className="space-y-3">
                {[
                  "Off-chain sequencer for batch settlement",
                  "Relayer network for gasless UX",
                  "Compliance receipts and accounting exports",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-500"></div>
                    <span className="text-sm text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 p-4 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <p className="text-sm text-zinc-400">
              <span className="font-semibold text-white">Note:</span> Currently deployed on Solana Devnet and Base Sepolia. Mainnet deployment is planned after comprehensive security audits.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
