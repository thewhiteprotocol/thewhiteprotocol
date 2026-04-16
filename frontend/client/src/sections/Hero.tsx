import { ArrowRight, ExternalLink, Github } from "lucide-react";

export function Hero() {
  const scrollToSection = (href: string) => {
    const element = document.querySelector(href);
    if (element) element.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="overview" className="min-h-screen flex items-center justify-center pt-16 px-4">
      <div className="max-w-4xl mx-auto text-center">
        <div className="flex justify-center mb-8">
          <div className="p-5 bg-white/[0.03] rounded-3xl border border-white/[0.06] shadow-[0_0_40px_rgba(0,200,240,0.08)] backdrop-blur-sm">
            <img src="/logo.png" alt="The White Protocol" className="w-20 h-20 md:w-24 md:h-24 rounded-2xl" />
          </div>
        </div>

        <div className="flex justify-center mb-6">
          <div className="px-4 py-2 bg-white/[0.04] rounded-full border border-white/[0.06] flex items-center gap-2 backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Live on Solana Devnet</span>
          </div>
        </div>

        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4">The White Protocol</h1>
        <p className="text-xl md:text-2xl text-transparent bg-clip-text bg-gradient-to-r from-[#9945FF] to-[#14F195] font-semibold mb-6">Multi-Chain Privacy Protocol</p>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          A privacy pool protocol enabling private transfers with Groth16 zero-knowledge proofs. Deposit SPL tokens, transfer privately, and withdraw securely.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <a href={import.meta.env.VITE_APP_URL || "http://localhost:3000"} className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-2xl hover:shadow-[0_0_30px_rgba(0,200,240,0.3)] active:scale-95 transition-all duration-300 flex items-center gap-2 text-white font-bold">
            Launch App <ArrowRight size={18} />
          </a>
          <button onClick={() => scrollToSection("#protocol")} className="px-8 py-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-2xl border border-cyan-400/20 hover:border-cyan-400/40 hover:shadow-[0_0_24px_rgba(0,200,240,0.12)] active:bg-cyan-500/15 transition-all duration-300 flex items-center gap-2 text-cyan-400 font-bold backdrop-blur-sm">
            Test Protocol <ArrowRight size={18} />
          </button>
          <button onClick={() => scrollToSection("#docs")} className="px-8 py-4 bg-white/[0.04] rounded-2xl border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.06] active:bg-white/[0.08] transition-all duration-300 flex items-center gap-2 text-slate-300 font-bold backdrop-blur-sm">
            Read Docs
          </button>
          <a href="https://github.com/thewhiteprotocol/thewhiteprotocol" target="_blank" rel="noopener noreferrer" className="px-8 py-4 bg-white/[0.04] rounded-2xl border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.06] active:bg-white/[0.08] transition-all duration-300 flex items-center gap-2 text-slate-300 font-bold backdrop-blur-sm">
            <Github size={18} /> GitHub <ExternalLink size={14} />
          </a>
        </div>

        <div className="grid grid-cols-4 gap-4 max-w-lg mx-auto">
          <div className="p-4 bg-black/20 rounded-2xl border border-white/[0.04] backdrop-blur-sm">
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">ZK Proofs</p>
            <p className="text-sm font-bold text-white">Groth16</p>
          </div>
          <div className="p-4 bg-black/20 rounded-2xl border border-white/[0.04] backdrop-blur-sm">
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Anonymity</p>
            <p className="text-sm font-bold text-white">Multi-Asset</p>
          </div>
          <div className="p-4 bg-black/20 rounded-2xl border border-white/[0.04] backdrop-blur-sm">
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">Security</p>
            <p className="text-sm font-bold text-white">Devnet Beta</p>
          </div>
          <div className="p-4 bg-black/20 rounded-2xl border border-white/[0.04] backdrop-blur-sm">
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-1">License</p>
            <p className="text-sm font-bold text-emerald-400">Open Source</p>
          </div>
        </div>
      </div>
    </section>
  );
}