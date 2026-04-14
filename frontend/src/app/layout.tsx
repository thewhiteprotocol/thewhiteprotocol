import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { WalletProvider } from "@/providers/WalletProvider";
import { Navbar } from "@/components/navbar";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { TestnetBanner } from "@/components/testnet-banner";
import { UnlockModal } from "@/components/unlock-modal";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "The White Protocol | Multi-Chain Privacy",
  description:
    "The White Protocol is a multi-chain privacy protocol enabling confidential transfers on Solana and Base via zero-knowledge proofs.",
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
          <WalletProvider>
            <TestnetBanner />
            <Navbar />
            <div className="flex flex-1 overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-y-auto p-4 pb-24 lg:p-8 lg:pb-8">
                {children}
              </main>
            </div>
            <MobileNav />
            <UnlockModal />
          </WalletProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
