import { Github, Twitter, ExternalLink, Code } from "lucide-react";
const links = [
  { icon: Github, label: "GitHub", description: "View source code and contribute", href: "https://github.com/thewhiteprotocol/thewhiteprotocol" },
  { icon: Twitter, label: "Twitter", description: "Follow for updates", href: "https://x.com/thewhiteprotocol" },
];
export function Links() {
  return (
    <section id="links" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-700 mb-4">Links & Resources</h2>
          <p className="text-lg text-slate-500">Connect with the The White Protocol community</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="group p-6 bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff] hover:shadow-[12px_12px_24px_#b8b9be,-12px_-12px_24px_#ffffff] active:shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] group-hover:shadow-[4px_4px_8px_#b8b9be,-4px_-4px_8px_#ffffff] transition-all"><link.icon className="h-6 w-6 text-blue-500" /></div>
                <div className="flex-1">
                  <div className="flex items-center gap-2"><h3 className="text-lg font-bold text-slate-700 group-hover:text-blue-500 transition-colors">{link.label}</h3><ExternalLink size={14} className="text-slate-400 group-hover:text-blue-500 transition-colors" /></div>
                  <p className="text-sm text-slate-500 mt-1">{link.description}</p>
                </div>
              </div>
            </a>
          ))}
        </div>
        <div className="mt-12 flex justify-center">
          <div className="flex items-center gap-3 px-6 py-3 bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff]">
            <Code className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-bold text-slate-700">100% Open Source Protocol</span>
          </div>
        </div>
        <div className="mt-16 text-center">
          <div className="inline-block p-6 bg-[#E0E5EC] rounded-2xl shadow-[inset_6px_6px_12px_#b8b9be,inset_-6px_-6px_12px_#ffffff]">
            <p className="text-sm text-slate-500">Built with love for Solana privacy</p>
            <p className="text-xs text-slate-400 mt-2">2025 The White Protocol</p>
          </div>
        </div>
      </div>
    </section>
  );
}
