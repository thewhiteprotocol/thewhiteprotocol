import { Shield, Lock, Cpu, Database } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Multi-Chain Architecture",
    description: "Built for both Solana (Anchor) and Base (Solidity), providing a secure and type-safe foundation for cross-chain privacy.",
  },
  {
    icon: Lock,
    title: "Privacy Pool Operations",
    description: "Deposit SPL tokens (Solana) or ERC-20 tokens (Base) into privacy pools, execute private transfers using Groth16 proofs.",
  },
  {
    icon: Cpu,
    title: "Cryptographic Model",
    description: "Commitments and nullifier hashes computed off-chain with Poseidon. Groth16 proof verification on BN254 curve.",
  },
  {
    icon: Database,
    title: "On-Chain Verification",
    description: "Verification keys stored on-chain with curve and identity checks. All proofs validated directly on Solana and Base.",
  },
];

export function Architecture() {
  return (
    <section id="architecture" className="py-24 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-700 mb-4">
            Architecture
          </h2>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            A deep dive into the technical foundations of The White Protocol
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="p-6 bg-[#E0E5EC] rounded-3xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff] hover:shadow-[12px_12px_24px_#b8b9be,-12px_-12px_24px_#ffffff] transition-all duration-300"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-[#E0E5EC] rounded-2xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]">
                  <feature.icon className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-700 mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Technical Details Card */}
        <div className="bg-[#E0E5EC] rounded-[2rem] p-8 shadow-[12px_12px_24px_#b8b9be,-12px_-12px_24px_#ffffff]">
          <h3 className="text-xl font-bold text-slate-700 mb-6">Technical Stack</h3>
          
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                Core Features
              </h4>
              <div className="space-y-3">
                {[
                  "Deposit SPL/ERC-20 tokens into privacy pools",
                  "Private transfers with ZK proofs",
                  "Withdraw back to transparent accounts",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_3px_3px_6px_#b8b9be,inset_-3px_-3px_6px_#ffffff]">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="text-sm text-slate-600">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">
                Cryptographic Stack
              </h4>
              <div className="space-y-3">
                {[
                  "Poseidon hash for commitments",
                  "Keccak256 for Merkle tree",
                  "Groth16 on BN254 curve",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_3px_3px_6px_#b8b9be,inset_-3px_-3px_6px_#ffffff]">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-sm text-slate-600">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Note */}
          <div className="mt-8 p-4 bg-[#E0E5EC] rounded-2xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]">
            <p className="text-sm text-slate-500">
              <span className="font-bold text-slate-700">Note:</span> Currently deployed on Solana devnet and Base Sepolia. Mainnet deployment planned after security hardening.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
