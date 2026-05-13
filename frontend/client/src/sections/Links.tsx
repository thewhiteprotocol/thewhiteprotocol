import { Github, ExternalLink, Code } from "lucide-react";

const links = [
  { icon: Github, label: "GitHub", description: "View source code and contribute", href: "https://github.com/thewhiteprotocol" },
  { icon: ExternalLink, label: "X", description: "Follow for updates", href: "https://x.com/TheWhite_prtcl" },
];

export function Links() {
  return (
    <section id="links" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">Links & Resources</h2>
          <p className="text-lg text-zinc-400">Connect with The White Protocol community</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group p-6 rounded-xl border border-white/[0.06] bg-white/[0.02] transition-all hover:bg-white/[0.04] hover:border-white/[0.10]"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08]">
                  <link.icon className="h-6 w-6 text-zinc-300" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-white group-hover:text-white transition-colors">{link.label}</h3>
                    <ExternalLink size={14} className="text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                  </div>
                  <p className="text-sm text-zinc-400 mt-1">{link.description}</p>
                </div>
              </div>
            </a>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <div className="flex items-center gap-3 px-6 py-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <Code className="h-5 w-5 text-zinc-300" />
            <span className="text-sm font-semibold text-white">Open-source protocol</span>
          </div>
        </div>

        <div className="mt-16 text-center">
          <div className="inline-block p-6 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <p className="text-sm text-zinc-400">Open-source protocol • Local-first privacy • Built for stablecoin settlement</p>
            <p className="text-xs text-zinc-500 mt-2">© 2026 The White Protocol</p>
          </div>
        </div>
      </div>
    </section>
  );
}
