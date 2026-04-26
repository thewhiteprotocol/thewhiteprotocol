import { FileText, Receipt, Download, Users, ArrowRight, Shield } from "lucide-react";

const features = [
  {
    icon: FileText,
    title: "Private Invoicing",
    description: "Create branded invoices with shielded payment links. Your clients pay privately—no public transaction history.",
  },
  {
    icon: Receipt,
    title: "Auto-Receipts",
    description: "Every deposit, withdrawal, and payment automatically generates a PDF receipt for your records.",
  },
  {
    icon: Download,
    title: "Accounting Exports",
    description: "Export CSVs formatted for QuickBooks, Xero, and your accountant. Save hours at tax time.",
  },
  {
    icon: Shield,
    title: "Shielded Transactions",
    description: "Deposit, withdraw, and transfer with zero-knowledge proofs. Your balances stay private.",
  },
];

export function ForBusiness() {
  return (
    <section id="business" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-4">
            <Users className="w-3.5 h-3.5" />
            For Teams
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            All Features. Free. No Tiers.
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Invoicing, receipts, exports, and shielded transactions — every tool is available to everyone. No upgrade required.
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

        <div className="mt-12 text-center">
          <a
            href={import.meta.env.VITE_APP_URL || "https://app.thewhiteprotocol.com"}
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-all"
          >
            Start Free
            <ArrowRight className="w-4 h-4" />
          </a>
          <p className="mt-3 text-xs text-zinc-500">Free on testnet. Mainnet coming soon.</p>
        </div>
      </div>
    </section>
  );
}
