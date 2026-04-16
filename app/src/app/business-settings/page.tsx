"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTierConfig, setBusinessProfile, type BusinessProfile } from "@/lib/userTier";
import { useChain } from "@/providers/ChainContext";
import { Building2, Loader2, Save } from "lucide-react";

export default function BusinessSettingsPage() {
  const { isConnected, walletAddress } = useChain();
  const [profile, setProfile] = useState<BusinessProfile>({ companyName: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isConnected || !walletAddress) {
      setLoading(false);
      return;
    }
    getTierConfig().then((config) => {
      if (config.businessProfile) {
        setProfile(config.businessProfile);
      }
      setLoading(false);
    });
  }, [isConnected, walletAddress]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setProfile((p) => ({ ...p, logo: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setBusinessProfile(profile);
    } finally {
      setSaving(false);
    }
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
      <div className="py-12 text-center">
        <h1 className="text-2xl font-bold text-white">Connect Your Wallet</h1>
        <p className="mt-2 text-zinc-400">Please connect your wallet to manage business settings.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Business Settings</h1>
        <p className="text-sm text-zinc-400">Manage your company profile for branded invoices and receipts.</p>
      </div>

      <Card className="border-white/10 bg-white/[0.03]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-white">
            <Building2 className="h-5 w-5 text-emerald-400" />
            Company Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <label className="text-sm font-medium text-zinc-300">Logo</label>
            <Input type="file" accept="image/*" onChange={handleLogoChange} className="border-white/10 bg-white/[0.03] text-white" />
            {profile.logo && (
              <img src={profile.logo} alt="Logo preview" className="mt-2 h-16 object-contain" />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Email</label>
            <Input
              value={profile.email || ""}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              placeholder="billing@acme.com"
              className="border-white/10 bg-white/[0.03] text-white"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Website</label>
            <Input
              value={profile.website || ""}
              onChange={(e) => setProfile({ ...profile, website: e.target.value })}
              placeholder="https://acme.com"
              className="border-white/10 bg-white/[0.03] text-white"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Address</label>
            <Input
              value={profile.address || ""}
              onChange={(e) => setProfile({ ...profile, address: e.target.value })}
              placeholder="123 Business St, City"
              className="border-white/10 bg-white/[0.03] text-white"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Tax ID</label>
            <Input
              value={profile.taxId || ""}
              onChange={(e) => setProfile({ ...profile, taxId: e.target.value })}
              placeholder="XX-XXXXXXX"
              className="border-white/10 bg-white/[0.03] text-white"
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Profile
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
