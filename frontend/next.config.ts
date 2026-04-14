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
  turbopack: {
    root: "/workspaces/thewhiteprotocol/frontend",
  },
};

export default nextConfig;
