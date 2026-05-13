import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { WalletProvider } from "@/providers/WalletProvider";
import { ToastProvider } from "@/providers/ToastContext";
import { Navbar } from "@/components/navbar";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { TestnetBanner } from "@/components/testnet-banner";
import { UnlockModal } from "@/components/unlock-modal";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import { ClientOnly } from "@/components/client-only";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "The White Protocol | Private Stablecoin Settlement",
  description:
    "The White Protocol is privacy-preserving stablecoin settlement infrastructure for individuals, companies, and financial teams. Shield, send, withdraw, and account for stablecoins privately using ZK proofs on testnet.",
  keywords: ["privacy", "zkp", "solana", "base", "crypto", "shielded", "stablecoin settlement"],
  authors: [{ name: "The White Protocol" }],
  openGraph: {
    title: "The White Protocol | Private Stablecoin Settlement",
    description: "Private stablecoin payments, shielded balances, and multi-chain ZK settlement on Solana and Base.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "The White Protocol | Private Stablecoin Settlement",
    description: "Private stablecoin payments, shielded balances, and multi-chain ZK settlement on Solana and Base.",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-black text-white">
        <TooltipProvider>
          <ClientOnly>
            <WalletProvider>
              <ToastProvider>
                <TestnetBanner />
                <Navbar />
                <div className="flex flex-1 overflow-hidden">
                  <Sidebar />
                  <main className="flex-1 overflow-y-auto p-4 pb-24 lg:p-8 lg:pb-8">
                    <ErrorBoundary>{children}</ErrorBoundary>
                  </main>
                </div>
                <MobileNav />
                <UnlockModal />
              </ToastProvider>
            </WalletProvider>
          </ClientOnly>
        </TooltipProvider>
      </body>
    </html>
  );
}
