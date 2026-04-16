import { Building2, FileText, Receipt, Download, Users, ArrowRight } from "lucide-react";

const features = [
  {
    icon: FileText,
    title: "Private Invoicing",
    description: "Create branded invoices with shielded payment links. Your clients pay privately—no public transaction history.",
  },
  {
    icon: Receipt,
    title: "Auto-Receipts",
    description: "Every deposit, withdrawal, and payment automatically generates a PDF receipt with your company branding.",
  },
  {
    icon: Download,
    title: "Accounting Exports",
    description: "Export CSVs formatted for QuickBooks, Xero, and your accountant. Save hours at tax time.",
  },
  {
    icon: Users,
    title: "Team Management",
    description: "Coming soon: invite team members, assign roles, and manage permissions for your business account.",
  },
];

export function ForBusiness() {
  return (
    <section id="business" className="py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-4">
            <Building2 className="w-3.5 h-3.5" />
            For Business
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Privacy-First Business Tools
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            The White Protocol Business tier gives you everything you need to accept private payments, stay compliant, and impress your clients.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:border-emerald-500/30 hover:bg-white/[0.05]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 transition-transform group-hover:scale-110">
                <feature.icon className="h-5 w-5 text-emerald-400" />
              </div>
              <h3 className="mb-2 font-semibold text-white">{feature.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <a
            href={import.meta.env.VITE_APP_URL || "https://app.thewhiteprotocol.com"}
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-all"
          >
            Start Free
            <ArrowRight className="w-4 h-4" />
          </a>
          <p className="mt-3 text-xs text-zinc-500">Free on testnet. WHITE staking on mainnet.</p>
        </div>
      </div>
    </section>
  );
}
