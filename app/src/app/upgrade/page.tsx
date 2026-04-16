"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getTierConfig,
  setTier,
  setBusinessProfile,
  isBusinessUser,
  type BusinessProfile,
} from "@/lib/userTier";
import { useChain } from "@/providers/ChainContext";
import {
  Check,
  Lock,
  Sparkles,
  FileText,
  Receipt,
  Download,
  Users,
  Loader2,
  Building2,
} from "lucide-react";

export default function UpgradePage() {
  const router = useRouter();
  const { isConnected, walletAddress } = useChain();
  const [isBusiness, setIsBusiness] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profile, setProfile] = useState<BusinessProfile>({ companyName: "" });

  useEffect(() => {
    if (!isConnected || !walletAddress) {
      setLoading(false);
      return;
    }
    isBusinessUser().then((biz) => {
      setIsBusiness(biz);
      setLoading(false);
    });
  }, [isConnected, walletAddress]);

  const handleActivate = async () => {
    setActivating(true);
    try {
      await setTier("business");
      setIsBusiness(true);
      setShowProfileModal(true);
    } finally {
      setActivating(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile.companyName.trim()) return;
    await setBusinessProfile(profile);
    setShowProfileModal(false);
    router.push("/dashboard");
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!isConnected || !walletAddress) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <h1 className="text-2xl font-bold text-white">Connect Your Wallet</h1>
        <p className="mt-2 text-zinc-400">Please connect your wallet to manage your account tier.</p>
      </div>
    );
  }

  if (isBusiness) {
    return (
      <div className="mx-auto max-w-3xl space-y-8 py-6">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
            <Sparkles className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white">Business Active</h1>
          <p className="mt-2 text-zinc-400">
            You have full access to The White Protocol Business features.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FeatureCard
            icon={FileText}
            title="Private Invoicing"
            description="Create branded invoices with private payment links."
            href="/invoices"
          />
          <FeatureCard
            icon={Receipt}
            title="Auto-Receipts"
            description="Every transaction automatically generates a PDF receipt."
            href="/receipts"
          />
          <FeatureCard
            icon={Download}
            title="Accounting Exports"
            description="Export CSVs for QuickBooks, Xero, and your accountant."
            href="/history"
          />
          <FeatureCard
            icon={Building2}
            title="Business Settings"
            description="Manage your company profile, logo, and branding."
            href="/business-settings"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Choose Your Plan</h1>
        <p className="mt-2 text-zinc-400">
          Personal is free forever. Business unlocks invoicing, receipts, and accounting tools.
        </p>
        <p className="mt-1 text-xs text-emerald-400">Testnet: Business is currently free to activate.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal */}
        <Card className="border-white/10 bg-white/[0.03]">
          <CardHeader>
            <CardTitle className="text-xl text-white">Personal</CardTitle>
            <p className="text-sm text-zinc-400">Free forever</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Shielded deposits & withdrawals
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Private send & receive via QR
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Transaction history
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Encrypted note backup
              </li>
              <li className="flex items-center gap-2 text-zinc-500">
                <Lock className="h-4 w-4" />
                Private invoicing
              </li>
              <li className="flex items-center gap-2 text-zinc-500">
                <Lock className="h-4 w-4" />
                Auto-receipts
              </li>
              <li className="flex items-center gap-2 text-zinc-500">
                <Lock className="h-4 w-4" />
                Accounting exports
              </li>
            </ul>
            <Button disabled className="w-full bg-zinc-700 text-zinc-300">
              Current Plan
            </Button>
          </CardContent>
        </Card>

        {/* Business */}
        <Card className="relative border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.03] to-transparent">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white">
            RECOMMENDED
          </div>
          <CardHeader>
            <CardTitle className="text-xl text-white">Business</CardTitle>
            <p className="text-sm text-zinc-400">
              Free on testnet · WHITE staking on mainnet
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Everything in Personal
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Private invoicing with payment links
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Auto-generated PDF receipts
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                QuickBooks & Xero exports
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-400" />
                Company branding on documents
              </li>
              <li className="flex items-center gap-2 text-zinc-500">
                <Lock className="h-4 w-4" />
                Team management (coming soon)
              </li>
            </ul>
            <Button
              onClick={handleActivate}
              disabled={activating}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {activating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Activating...
                </>
              ) : (
                "Activate Business"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Profile Modal */}
      <Dialog open={showProfileModal} onOpenChange={setShowProfileModal}>
        <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-md">
          <DialogHeader className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <Building2 className="h-6 w-6 text-emerald-500" />
            </div>
            <DialogTitle className="text-center text-xl">Business Profile</DialogTitle>
            <DialogDescription className="text-center text-zinc-400">
              Add your company details for branded invoices and receipts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Company Name</label>
              <Input
                value={profile.companyName}
                onChange={(e) => setProfile({ ...profile, companyName: e.target.value })}
                placeholder="Acme Inc."
                className="border-white/10 bg-white/[0.03] text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Email (optional)</label>
              <Input
                value={profile.email || ""}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                placeholder="billing@acme.com"
                className="border-white/10 bg-white/[0.03] text-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Website (optional)</label>
              <Input
                value={profile.website || ""}
                onChange={(e) => setProfile({ ...profile, website: e.target.value })}
                placeholder="https://acme.com"
                className="border-white/10 bg-white/[0.03] text-white"
              />
            </div>
            <Button
              onClick={handleSaveProfile}
              disabled={!profile.companyName.trim()}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              Save & Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-start gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
        <Icon className="h-5 w-5 text-emerald-400" />
      </div>
      <div>
        <h3 className="font-semibold text-white">{title}</h3>
        <p className="text-sm text-zinc-400">{description}</p>
      </div>
    </a>
  );
}
