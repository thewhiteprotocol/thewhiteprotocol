"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useChain } from "@/providers/ChainContext";
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
  Activity,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/send", label: "Send", icon: ArrowUpRight },
  { href: "/receive", label: "Receive", icon: ArrowDownLeft },
  { href: "/shield", label: "Shield", icon: Shield },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/history", label: "History", icon: Clock },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isConnected } = useChain();
  const [relayerOnline, setRelayerOnline] = useState<boolean | null>(null);

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
        {navItems.map(renderNavItem)}
      </nav>

      <div className="border-t border-white/10 p-4">
        <RelayerStatus online={relayerOnline} />
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
