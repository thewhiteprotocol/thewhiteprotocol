"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useChain } from "@/providers/ChainContext";
import { getTierConfig, isBusinessUser, type UserTier } from "@/lib/userTier";
import { getRelayerHealth } from "@/lib/relayerClient";
import {
  LayoutDashboard,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Clock,
  Settings,
  FileText,
  Receipt,
  Building2,
  Sparkles,
  Activity,
} from "lucide-react";

const personalNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/send", label: "Send", icon: ArrowUpRight },
  { href: "/receive", label: "Receive", icon: ArrowDownLeft },
  { href: "/shield", label: "Shield", icon: Shield },
  { href: "/history", label: "History", icon: Clock },
  { href: "/settings", label: "Settings", icon: Settings },
];

const businessNavItems = [
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/business-settings", label: "Business Settings", icon: Building2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { walletAddress, isConnected } = useChain();
  const [tier, setTier] = useState<UserTier>("personal");
  const [relayerOnline, setRelayerOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isConnected || !walletAddress) return;
    getTierConfig().then((config) => setTier(config.tier)).catch(() => setTier("personal"));
  }, [isConnected, walletAddress]);

  useEffect(() => {
    let mounted = true;
    async function check() {
      try {
        await getRelayerHealth();
        if (mounted) setRelayerOnline(true);
      } catch {
        if (mounted) setRelayerOnline(false);
      }
    }
    check();
    const interval = setInterval(check, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const renderNavItem = (item: { href: string; label: string; icon: React.ElementType }) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
          isActive
            ? "bg-white/[0.08] text-white shadow-sm border border-white/[0.06]"
            : "text-zinc-300 hover:bg-white/[0.04] hover:text-white"
        )}
      >
        <div className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.03] text-zinc-400 group-hover:text-zinc-200"
        )}>
          <item.icon className="h-4 w-4" />
        </div>
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="hidden w-72 flex-col border-r border-white/10 bg-black/40 backdrop-blur-sm lg:flex">
      <nav className="flex flex-1 flex-col gap-1 p-4">
        <div className="mb-3 px-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
          Personal
        </div>
        {personalNavItems.map(renderNavItem)}

        {tier === "business" && (
          <>
            <div className="mt-5 mb-3 px-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
              Business
            </div>
            {businessNavItems.map(renderNavItem)}
          </>
        )}
      </nav>

      <div className="border-t border-white/10 p-4 space-y-3">
        <RelayerStatus online={relayerOnline} />
        <TierBadge tier={tier} />
      </div>
    </aside>
  );
}

function RelayerStatus({ online }: { online: boolean | null }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg",
          online === true ? "bg-emerald-500/10" : online === false ? "bg-red-500/10" : "bg-zinc-500/10"
        )}>
          <Activity className={cn(
            "h-4 w-4",
            online === true ? "text-emerald-400" : online === false ? "text-red-400" : "text-zinc-400"
          )} />
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-200">Relayer</p>
          <p className="text-[11px] text-zinc-500">
            {online === true ? "Online" : online === false ? "Offline" : "Checking..."}
          </p>
        </div>
      </div>
      <span className={cn(
        "h-2 w-2 rounded-full",
        online === true ? "bg-emerald-400" : online === false ? "bg-red-400" : "bg-zinc-400"
      )} />
    </div>
  );
}

function TierBadge({ tier }: { tier: UserTier }) {
  if (tier === "business") {
    return (
      <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
            <Sparkles className="h-4 w-4 text-emerald-400" />
          </div>
          <span className="text-sm font-medium text-emerald-400">Business</span>
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/upgrade"
      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition-all hover:bg-white/[0.06]"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05]">
          <span className="inline-flex h-2 w-2 rounded-full bg-zinc-500" />
        </div>
        <span className="text-sm font-medium text-zinc-300">Personal</span>
      </div>
      <span className="text-xs font-semibold text-emerald-400">Upgrade</span>
    </Link>
  );
}
