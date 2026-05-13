import { FileText, Receipt, Download, Users, ArrowRight, Shield, Monitor } from "lucide-react";

const features = [
  {
    icon: Shield,
    title: "Private Payments",
    description: "Send and receive stablecoins privately using shielded notes and zero-knowledge proofs.",
  },
  {
    icon: FileText,
    title: "Invoices & Payment Links",
    description: "Create private payment requests that customers or counterparties can pay through The White Protocol.",
  },
  {
    icon: Receipt,
    title: "Receipts & Accounting Exports",
    description: "Generate receipts, CSV exports, PDF statements, and accounting-ready records for internal reporting.",
  },
  {
    icon: Monitor,
    title: "White Console",
    description: "A local desktop app layer for encrypted notes, local proof generation, compliance exports, and enterprise workflows.",
  },
];

export function ForBusiness() {
  return (
    <section id="business" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-4">
            <Users className="w-3.5 h-3.5" />
            For Individuals, Teams & Companies
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Private payments for users. Local controls and accounting workflows for businesses.
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            The White Protocol combines shielded stablecoin transfers, invoices, receipts, exports, and a desktop-console path for teams that cannot expose treasury metadata in a hosted dashboard.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition-all hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04]">
                <feature.icon className="h-5 w-5 text-zinc-300" />
              </div>
              <h3 className="mb-2 font-semibold text-white">{feature.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={import.meta.env.VITE_APP_URL || "https://app.thewhiteprotocol.com"}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-all"
          >
            Launch Testnet App
            <ArrowRight className="w-4 h-4" />
          </a>
          <button
            onClick={() => {
              const el = document.getElementById("console");
              if (el) el.scrollIntoView({ behavior: "smooth" });
            }}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white/[0.04] rounded-xl border border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.06] active:bg-white/[0.08] transition-all text-zinc-300 font-semibold"
          >
            Explore White Console
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-500 text-center">Testnet only. Mainnet and enterprise deployments are on the roadmap.</p>
      </div>
    </section>
  );
}
