import { useState, useEffect } from "react";
import { Menu, X, Home, FlaskConical, Cpu, BookOpen, Globe, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlowWalletButton } from "@/components/ui/glow-wallet-button";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import logoImage from "@assets/1LuXV2vh_400x400_1764358305279.jpg";

const navLinks = [
  { label: "Overview", href: "#overview", icon: Home, gradientFrom: '#a855f7', gradientTo: '#c084fc' },
  { label: "Test Protocol", href: "#protocol", icon: FlaskConical, gradientFrom: '#06b6d4', gradientTo: '#22d3ee' },
  { label: "Architecture", href: "#architecture", icon: Cpu, gradientFrom: '#a855f7', gradientTo: '#06b6d4' },
  { label: "Docs", href: "#docs", icon: BookOpen, gradientFrom: '#c084fc', gradientTo: '#a855f7' },
  { label: "Devnet", href: "#devnet", icon: Globe, gradientFrom: '#22d3ee', gradientTo: '#06b6d4' },
  { label: "Links", href: "#links", icon: Link2, gradientFrom: '#a855f7', gradientTo: '#ec4899' },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (href: string) => {
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-background/90 backdrop-blur-md border-b border-border"
          : "bg-transparent"
      }`}
      data-testid="navbar"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection("#overview");
            }}
            className="flex items-center gap-3 group"
            data-testid="link-home"
          >
            <img
              src={logoImage}
              alt="The White Protocol Protocol"
              className="h-9 w-9 rounded-lg transition-transform duration-300 group-hover:scale-110"
            />
            <span className="font-semibold text-lg text-foreground">The White Protocol</span>
          </a>

          {/* Desktop Navigation - Gradient Pills */}
          <div className="hidden lg:flex items-center gap-2">
            {navLinks.map((link) => (
              <button
                key={link.href}
                onClick={() => scrollToSection(link.href)}
                style={{ 
                  '--gradient-from': link.gradientFrom, 
                  '--gradient-to': link.gradientTo 
                } as React.CSSProperties}
                className="relative h-9 px-3 bg-card/50 border border-border/50 rounded-full 
                           flex items-center justify-center gap-2
                           transition-all duration-500 
                           hover:bg-transparent hover:border-transparent hover:px-4
                           hover:shadow-lg group cursor-pointer"
                data-testid={`link-${link.label.toLowerCase().replace(' ', '-')}`}
              >
                {/* Gradient background on hover */}
                <span 
                  className="absolute inset-0 rounded-full opacity-0 transition-all duration-500 group-hover:opacity-100"
                  style={{ background: `linear-gradient(135deg, var(--gradient-from), var(--gradient-to))` }}
                />
                
                {/* Blur glow */}
                <span 
                  className="absolute top-1 inset-x-1 h-full rounded-full blur-md opacity-0 -z-10 
                             transition-all duration-500 group-hover:opacity-50"
                  style={{ background: `linear-gradient(135deg, var(--gradient-from), var(--gradient-to))` }}
                />
                
                {/* Icon */}
                <span className="relative z-10 transition-all duration-300 group-hover:scale-0 group-hover:w-0">
                  <link.icon className="h-4 w-4 text-muted-foreground group-hover:text-white" />
                </span>
                
                {/* Label */}
                <span 
                  className="relative z-10 text-sm font-medium text-muted-foreground
                             transition-all duration-300 group-hover:text-white"
                >
                  {link.label}
                </span>
              </button>
            ))}
          </div>

          {/* Wallet Button */}
          <div className="hidden lg:flex items-center gap-3">
            <GlowWalletButton />
          </div>

          {/* Mobile Menu Button */}
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {isMobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-background/95 backdrop-blur-md border-b border-border">
          <div className="px-6 py-4 space-y-2">
            {navLinks.map((link) => (
              <button
                key={link.href}
                onClick={() => scrollToSection(link.href)}
                style={{ 
                  '--gradient-from': link.gradientFrom, 
                  '--gradient-to': link.gradientTo 
                } as React.CSSProperties}
                className="relative w-full h-12 px-4 bg-card/30 border border-border/30 rounded-xl
                           flex items-center gap-3
                           transition-all duration-300 
                           hover:bg-transparent hover:border-transparent
                           active:scale-[0.98] group"
                data-testid={`link-mobile-${link.label.toLowerCase().replace(' ', '-')}`}
              >
                {/* Gradient background on hover */}
                <span 
                  className="absolute inset-0 rounded-xl opacity-0 transition-all duration-300 group-hover:opacity-100"
                  style={{ background: `linear-gradient(135deg, var(--gradient-from), var(--gradient-to))` }}
                />
                
                {/* Icon */}
                <span className="relative z-10">
                  <link.icon className="h-5 w-5 text-muted-foreground group-hover:text-white transition-colors" />
                </span>
                
                {/* Label */}
                <span 
                  className="relative z-10 text-sm font-medium text-foreground
                             group-hover:text-white transition-colors"
                >
                  {link.label}
                </span>
              </button>
            ))}
            
            <div className="pt-3">
              <WalletMultiButton className="!w-full !bg-primary hover:!bg-primary/90 !h-12 !rounded-xl !text-sm !font-medium transition-colors" />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
