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
          <img src="/logo.webp" alt="The White Protocol" className="w-20 h-20 md:w-24 md:h-24 object-contain" />
        </div>

        <div className="flex justify-center mb-6">
          <div className="px-4 py-2 bg-white/[0.04] rounded-full border border-white/[0.08] flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Testnet: Solana Devnet + Base Sepolia</span>
          </div>
        </div>

        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 tracking-tight">Private Stablecoin Settlement</h1>
        <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Shield, send, withdraw, and account for stablecoins privately across public chains. Private notes stay local, ZK proofs protect transaction details, and relayers improve UX without taking custody.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <a href={import.meta.env.VITE_APP_URL || "https://app.thewhiteprotocol.com"} className="px-8 py-4 bg-white text-black rounded-xl hover:bg-zinc-200 active:scale-95 transition-all duration-200 flex items-center gap-2 font-semibold">
            Launch App <ArrowRight size={18} />
          </a>
          <button onClick={() => scrollToSection("#docs")} className="px-8 py-4 bg-white/[0.04] rounded-xl border border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.06] active:bg-white/[0.08] transition-all duration-200 flex items-center gap-2 text-zinc-300 font-semibold">
            Read Docs
          </button>
          <a href="https://github.com/thewhiteprotocol" target="_blank" rel="noopener noreferrer" className="px-8 py-4 bg-white/[0.04] rounded-xl border border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.06] active:bg-white/[0.08] transition-all duration-200 flex items-center gap-2 text-zinc-300 font-semibold">
            <Github size={18} /> GitHub <ExternalLink size={14} />
          </a>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-lg mx-auto">
          <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-1">Privacy</p>
            <p className="text-sm font-bold text-white">ZK Proofs</p>
          </div>
          <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-1">Networks</p>
            <p className="text-sm font-bold text-white">Solana + Base Testnet</p>
          </div>
          <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-1">Local-First</p>
            <p className="text-sm font-bold text-white">Browser + Desktop Path</p>
          </div>
          <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
            <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider mb-1">Receipts</p>
            <p className="text-sm font-bold text-emerald-400">Audit Exports</p>
          </div>
        </div>
      </div>
    </section>
  );
}
