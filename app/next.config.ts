import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
    "@rainbow-me/rainbowkit",
  ],
  images: {
    unoptimized: true,
  },
  // Turbopack aliases not supported in this Next.js version
  // fs stub removed after eliminating proof.js from browser bundles
};

export default nextConfig;
