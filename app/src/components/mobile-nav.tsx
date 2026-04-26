"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  MoreHorizontal,
} from "lucide-react";

const mainNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/send", label: "Send", icon: ArrowUpRight },
  { href: "/receive", label: "Receive", icon: ArrowDownLeft },
  { href: "/shield", label: "Shield", icon: Shield },
];

export function MobileNav() {
  const pathname = usePathname();

  const isMoreActive =
    pathname === "/history" ||
    pathname === "/settings" ||
    pathname === "/invoices" ||
    pathname === "/receipts";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/80 backdrop-blur-xl lg:hidden">
      <div className="flex h-16 items-center justify-around px-2">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                isActive ? "text-emerald-400" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <Link
          href="/history"
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-medium transition-all",
            isMoreActive ? "text-emerald-400" : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </Link>
      </div>
    </nav>
  );
}
