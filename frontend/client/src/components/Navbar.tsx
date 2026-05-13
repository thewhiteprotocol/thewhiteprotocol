import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const navLinks = [
  { label: "Product", href: "#overview" },
  { label: "Console", href: "#console" },
  { label: "Protocol", href: "#protocol-flow" },
  { label: "Architecture", href: "#architecture" },
  { label: "Docs", href: "#docs" },
  { label: "Relayer", href: "#relayer" },
  { label: "Testnet", href: "#devnet" },
  { label: "Links", href: "#links" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
      const sections = navLinks.map(l => l.href.slice(1));
      for (const section of sections.reverse()) {
        const el = document.getElementById(section);
        if (el && el.getBoundingClientRect().top <= 100) {
          setActiveSection(section);
          break;
        }
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (href: string) => {
    const element = document.querySelector(href);
    if (element) element.scrollIntoView({ behavior: "smooth" });
    setIsMobileMenuOpen(false);
  };

  const navBg = isScrolled ? "bg-[#090B13]/90 backdrop-blur-xl border-b border-white/[0.06] shadow-[0_4px_30px_rgba(0,0,0,0.4)]" : "bg-transparent";

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${navBg}`}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <button onClick={() => scrollToSection("#overview")} className="flex items-center gap-3 group">
            <img src="/logo-shield.webp" alt="White" className="w-9 h-9 object-contain rounded-lg" />
            <span className="font-bold text-lg text-white tracking-tight">The White Protocol</span>
          </button>

          <div className="hidden lg:flex items-center">
            <div className="bg-white/[0.03] rounded-2xl p-1.5 border border-white/[0.06] flex gap-1 backdrop-blur-sm">
              {navLinks.map((link) => {
                const isActive = activeSection === link.href.slice(1);
                const cls = isActive
                  ? "bg-white/[0.08] text-white border border-white/10"
                  : "text-zinc-400 hover:text-white border border-transparent";
                return (
                  <button key={link.href} onClick={() => scrollToSection(link.href)} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${cls}`}>
                    {link.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            <WalletMultiButton />
          </div>

          <button
            className="lg:hidden p-3 bg-white/[0.04] rounded-xl border border-white/[0.08] active:bg-white/[0.08] transition-all"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="h-5 w-5 text-slate-300" /> : <Menu className="h-5 w-5 text-slate-300" />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="lg:hidden bg-[#090B13]/95 backdrop-blur-xl border-t border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
          <div className="px-6 py-4 space-y-2">
            {navLinks.map((link) => {
              const isActive = activeSection === link.href.slice(1);
              const cls = isActive
                ? "bg-white/[0.08] text-white border border-white/10"
                : "text-zinc-400 hover:text-white bg-white/[0.03] border border-white/[0.04]";
              return (
                <button key={link.href} onClick={() => scrollToSection(link.href)} className={`w-full text-left px-4 py-3 rounded-xl font-medium transition-all ${cls}`}>
                  {link.label}
                </button>
              );
            })}
            <div className="pt-2 flex flex-col gap-2">
              <WalletMultiButton />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
