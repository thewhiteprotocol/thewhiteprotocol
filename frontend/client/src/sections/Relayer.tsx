import { useEffect, useState } from "react";
import { Server, Shield, Zap, Activity, CheckCircle, AlertCircle, Globe } from "lucide-react";

const RELAYER_URL = import.meta.env.VITE_RELAYER_API_URL || "https://relayer.thewhiteprotocol.com";

const relayerFeatures = [
  {
    icon: Shield,
    title: "Privacy Preserving",
    description: "The relayer only receives public signals — never your secret or nullifier. Proofs are generated client-side in your browser.",
  },
  {
    icon: Zap,
    title: "Gasless Withdrawals",
    description: "Withdraw without holding SOL or ETH for gas. The relayer pays transaction fees and recoups a small basis-point fee.",
  },
  {
    icon: Globe,
    title: "Multi-Chain Relay",
    description: "One relayer service routing withdrawals to both Solana and Base. Chain selection is automatic based on your active note.",
  },
];

const endpoints = [
  { method: "GET", path: "/health", desc: "Service health and status" },
  { method: "GET", path: "/quote", desc: "Fee quote for a given amount" },
  { method: "POST", path: "/withdraw", desc: "Submit a gasless withdrawal" },
];

export function Relayer() {
  const [health, setHealth] = useState<"ok" | "error" | "loading">("loading");

  useEffect(() => {
    fetch(`${RELAYER_URL}/health`, { cache: "no-store" })
      .then((r) => r.ok ? setHealth("ok") : setHealth("error"))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <section id="relayer" className="py-24 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-zinc-300 text-xs font-semibold uppercase tracking-wider mb-4">
            <Server className="w-3.5 h-3.5" />
            Infrastructure
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            The Relayer
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            A trust-minimized service that submits your on-chain withdrawal transactions so you don't need gas tokens in your wallet.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {relayerFeatures.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 transition-all hover:bg-white/[0.04] hover:border-white/[0.10]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04]">
                <f.icon className="h-5 w-5 text-zinc-300" />
              </div>
              <h3 className="mb-2 font-semibold text-white">{f.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]">
                <Activity className="h-5 w-5 text-zinc-300" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Relayer Status</h3>
                <p className="text-sm text-zinc-400">{RELAYER_URL}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              {health === "ok" ? (
                <>
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-400">Operational</span>
                </>
              ) : health === "error" ? (
                <>
                  <AlertCircle className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-semibold text-red-400">Unavailable</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-zinc-400" />
                  <span className="text-sm font-semibold text-zinc-400">Checking...</span>
                </>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {endpoints.map((ep) => (
              <div
                key={ep.path}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg bg-white/[0.03] border border-white/[0.06]"
              >
                <span
                  className={`px-2 py-1 rounded text-xs font-semibold w-fit ${
                    ep.method === "GET"
                      ? "bg-white/[0.04] text-zinc-300 border border-white/[0.08]"
                      : "bg-white/[0.04] text-zinc-300 border border-white/[0.08]"
                  }`}
                >
                  {ep.method}
                </span>
                <code className="text-sm font-mono text-zinc-300">{ep.path}</code>
                <span className="text-sm text-zinc-500 sm:ml-auto">{ep.desc}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <p className="text-sm text-zinc-400">
              <span className="font-semibold text-white">Fee Structure:</span> 50 bps (0.5%) relayer fee on withdrawals.
              Minimum and maximum withdrawal limits apply per chain.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
