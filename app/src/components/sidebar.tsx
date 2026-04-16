"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useChain } from "@/providers/ChainContext";
import { getTierConfig, isBusinessUser, type UserTier } from "@/lib/userTier";
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

  useEffect(() => {
    if (!isConnected || !walletAddress) return;
    getTierConfig().then((config) => setTier(config.tier)).catch(() => setTier("personal"));
  }, [isConnected, walletAddress]);

  const renderNavItem = (item: { href: string; label: string; icon: React.ElementType }) => {
    const isActive = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
          isActive
            ? "bg-white/10 text-white"
            : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
        )}
      >
        <item.icon className="h-5 w-5" />
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="hidden w-64 flex-col border-r border-white/10 bg-black/30 lg:flex">
      <nav className="flex flex-1 flex-col gap-1 p-4">
        <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Personal
        </div>
        {personalNavItems.map(renderNavItem)}

        {tier === "business" && (
          <>
            <div className="mt-4 mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Business
            </div>
            {businessNavItems.map(renderNavItem)}
          </>
        )}
      </nav>

      <div className="border-t border-white/10 p-4">
        <TierBadge tier={tier} />
      </div>
    </aside>
  );
}

function TierBadge({ tier }: { tier: UserTier }) {
  if (tier === "business") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium text-emerald-400">Business</span>
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/upgrade"
      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 transition-all hover:bg-white/[0.06]"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-zinc-500" />
        <span className="text-sm font-medium text-zinc-400">Personal</span>
      </div>
      <span className="text-xs font-semibold text-emerald-400">Upgrade</span>
    </Link>
  );
}
