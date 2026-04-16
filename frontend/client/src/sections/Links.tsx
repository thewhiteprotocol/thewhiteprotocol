import { Github, Twitter, ExternalLink, Code, MessageCircle } from "lucide-react";

const links = [
  { icon: Github, label: "GitHub", description: "View source code and contribute", href: "https://github.com/thewhiteprotocol" },
  { icon: Twitter, label: "Twitter", description: "Follow for updates", href: "https://x.com/thewhiteprotocol" },
  { icon: MessageCircle, label: "Telegram", description: "Join the community chat", href: "https://t.me/thewhiteprotocol" },
];

export function Links() {
  return (
    <section id="links" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Links & Resources</h2>
          <p className="text-lg text-zinc-400">Connect with The White Protocol community</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group p-6 rounded-2xl border border-white/10 bg-white/[0.03] transition-all hover:bg-white/[0.05] hover:border-cyan-500/20"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 transition-all group-hover:scale-110">
                  <link.icon className="h-6 w-6 text-cyan-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">{link.label}</h3>
                    <ExternalLink size={14} className="text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                  </div>
                  <p className="text-sm text-zinc-400 mt-1">{link.description}</p>
                </div>
              </div>
            </a>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <div className="flex items-center gap-3 px-6 py-3 rounded-2xl border border-white/10 bg-white/[0.03]">
            <Code className="h-5 w-5 text-emerald-400" />
            <span className="text-sm font-bold text-white">100% Open Source Protocol</span>
          </div>
        </div>

        <div className="mt-16 text-center">
          <div className="inline-block p-6 rounded-2xl bg-black/20 border border-white/[0.06]">
            <p className="text-sm text-zinc-400">Built with love for on-chain privacy</p>
            <p className="text-xs text-zinc-500 mt-2">2025 The White Protocol</p>
          </div>
        </div>
      </div>
    </section>
  );
}
