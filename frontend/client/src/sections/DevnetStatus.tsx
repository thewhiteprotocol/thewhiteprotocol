import { Globe, Cpu, Code, ExternalLink, CheckCircle, Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { DEVNET_CONFIG } from "@/config";

export function DevnetStatus() {
  const { connected } = useWallet();

  return (
    <section id="devnet" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">Testnet Deployment</h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            The White Protocol is live on Solana Devnet and Base Sepolia for testing.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]"><Globe className="h-5 w-5 text-zinc-300" /></div>
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Network</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                  <span className="text-sm font-semibold text-white">Solana Devnet</span>
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]"><Cpu className="h-5 w-5 text-zinc-300" /></div>
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Base Sepolia</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                  <span className="text-sm font-semibold text-white">Deployed</span>
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]"><Wallet className="h-5 w-5 text-zinc-300" /></div>
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Wallet</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-zinc-500"}`}></div>
                  <span className="text-sm font-semibold text-white">{connected ? "Connected" : "Not Connected"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]"><Code className="h-5 w-5 text-zinc-300" /></div>
              <h3 className="text-xl font-semibold text-white">Solana Deployment</h3>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Program ID</p>
                <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] overflow-x-auto">
                  <code className="text-sm font-mono text-zinc-300">{DEVNET_CONFIG.PROGRAM_ID}</code>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Pool Config</p>
                <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] overflow-x-auto">
                  <code className="text-sm font-mono text-zinc-300">{DEVNET_CONFIG.POOL_CONFIG}</code>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Merkle Tree</p>
                <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] overflow-x-auto">
                  <code className="text-sm font-mono text-zinc-300">{DEVNET_CONFIG.MERKLE_TREE}</code>
                </div>
              </div>
            </div>
            <a href={DEVNET_CONFIG.EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="mt-6 w-full px-6 py-4 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.06] active:bg-white/[0.08] transition-all flex items-center justify-center gap-2 text-zinc-300 font-bold">
              <ExternalLink size={16} /> View on Solana Explorer
            </a>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20"><Code className="h-5 w-5 text-blue-400" /></div>
              <h3 className="text-xl font-bold text-white">Base Sepolia Deployment</h3>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Protocol Contract</p>
                <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] overflow-x-auto">
                  <code className="text-sm font-mono text-zinc-300">0x396e539bCDeAF48ab9526A13c6E688CBA69C059a</code>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Asset Registry</p>
                <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] overflow-x-auto">
                  <code className="text-sm font-mono text-zinc-300">0xc2508F03c42B11b79ef4aA979b9FfA7f62D003B7</code>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Batch Verifier</p>
                <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] overflow-x-auto">
                  <code className="text-sm font-mono text-zinc-300">0x818E535D774F329dfE9Cdf8C95F8ff7Ee85c822B</code>
                </div>
              </div>
            </div>
            <a href="https://sepolia.basescan.org/address/0x396e539bCDeAF48ab9526A13c6E688CBA69C059a" target="_blank" rel="noopener noreferrer" className="mt-6 w-full px-6 py-4 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.06] active:bg-white/[0.08] transition-all flex items-center justify-center gap-2 text-zinc-300 font-bold">
              <ExternalLink size={16} /> View on BaseScan
            </a>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]"><CheckCircle className="h-5 w-5 text-zinc-300" /></div>
            <h3 className="text-xl font-semibold text-white">Zero-Knowledge Circuits</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
              <p className="text-2xl font-semibold text-white">4</p>
              <p className="text-xs text-zinc-500 font-semibold uppercase mt-1">Circuits</p>
            </div>
            <div className="p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
              <p className="text-2xl font-semibold text-white">Groth16</p>
              <p className="text-xs text-zinc-500 font-semibold uppercase mt-1">Proofs</p>
            </div>
            <div className="p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
              <p className="text-2xl font-semibold text-white">20</p>
              <p className="text-xs text-zinc-500 font-semibold uppercase mt-1">Tree Depth</p>
            </div>
            <div className="p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] text-center">
              <p className="text-2xl font-semibold text-white">1M</p>
              <p className="text-xs text-zinc-500 font-semibold uppercase mt-1">Testnet Capacity</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
