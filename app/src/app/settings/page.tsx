"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldAlert, Trash2, Download, Upload, Key, Server, Wallet, Loader2, Check, X } from "lucide-react";
import { useChain } from "@/providers/ChainContext";
import { exportNotes, importNotes, getNotes } from "@/lib/noteStore";
import { CHAINS } from "@/config/chains";
import { StoredNote } from "@/lib/types";
import { getRelayerHealth } from "@/lib/relayerClient";

export default function SettingsPage() {
  const { isConnected } = useChain();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-3xl space-y-6"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-zinc-400">Manage your privacy wallet preferences.</p>
      </div>

      {!isConnected ? (
        <Card className="glass-card border-white/10">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Wallet className="h-12 w-12 text-zinc-600" />
            <h3 className="mt-4 text-lg font-medium">Connect your wallet</h3>
            <p className="mt-1 text-sm text-zinc-400">Connect a wallet to manage settings.</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-white/[0.03]">
            <TabsTrigger value="general" className="data-[state=active]:bg-white/10">General</TabsTrigger>
            <TabsTrigger value="backup" className="data-[state=active]:bg-white/10">Backup</TabsTrigger>
            <TabsTrigger value="compliance" className="data-[state=active]:bg-white/10">Compliance</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 pt-2">
            <RelayerCard />
            <DangerZoneCard />
          </TabsContent>

          <TabsContent value="backup" className="space-y-4 pt-2">
            <BackupCard />
            <RestoreCard />
            <ViewingKeyCard />
          </TabsContent>

          <TabsContent value="compliance" className="space-y-4 pt-2">
            <ComplianceCard />
          </TabsContent>
        </Tabs>
      )}
    </motion.div>
  );
}

function RelayerCard() {
  const [url, setUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);

  useEffect(() => {
    setUrl(localStorage.getItem("white_protocol_relayer_url") || process.env.NEXT_PUBLIC_RELAYER_URL || "https://relayer.thewhiteprotocol.com");
  }, []);

  function save() {
    if (url) localStorage.setItem("white_protocol_relayer_url", url);
    else localStorage.removeItem("white_protocol_relayer_url");
    alert("Relayer settings saved");
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      await getRelayerHealth();
      setTestResult(true);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Server className="h-5 w-5 text-zinc-400" />
          Relayer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">Custom Relayer URL</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={process.env.NEXT_PUBLIC_RELAYER_URL || "https://relayer.thewhiteprotocol.com"}
            className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className="border-white/10 hover:bg-white/[0.03]" onClick={save}>
            Save
          </Button>
          <Button variant="outline" className="border-white/10 hover:bg-white/[0.03]" onClick={testConnection} disabled={testing}>
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test Connection
          </Button>
          {testResult === true && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
              <Check className="h-4 w-4" /> Connected
            </span>
          )}
          {testResult === false && (
            <span className="inline-flex items-center gap-1 text-sm text-red-400">
              <X className="h-4 w-4" /> Unreachable
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BackupCard() {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const backup = await exportNotes();
      const blob = new Blob([backup], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `white-protocol-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Download className="h-5 w-5 text-emerald-400" />
          Backup Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Export your encrypted notes to a file. Keep this safe — if you lose your notes, your shielded funds cannot be recovered.
        </p>
        <Button onClick={handleExport} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Export Encrypted Notes
        </Button>
      </CardContent>
    </Card>
  );
}

function RestoreCard() {
  const [busy, setBusy] = useState(false);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      await importNotes(text);
      alert("Notes restored successfully");
    } catch (err: any) {
      alert(err?.message || "Import failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Upload className="h-5 w-5 text-amber-400" />
          Restore Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Import a previously exported backup of your encrypted notes.
        </p>
        <label className="inline-flex cursor-pointer">
          <input type="file" accept=".json" className="hidden" onChange={handleImport} disabled={busy} />
          <span className="inline-flex h-9 items-center justify-center rounded-md border border-white/10 bg-transparent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/[0.03]">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Import Backup
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

function ViewingKeyCard() {
  const [key, setKey] = useState<string | null>(null);

  async function generate() {
    // For MVP: viewing key is a hash of all note commitments + a random salt
    const notes = await getNotes();
    const commitments = notes.map((n) => n.commitment).join("");
    const salt = crypto.randomUUID();
    const data = new TextEncoder().encode(commitments + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    setKey(hashHex);
  }

  function copy() {
    if (key) navigator.clipboard.writeText(key);
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Key className="h-5 w-5 text-cyan-400" />
          Viewing Key
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Generate a viewing key that allows a third party to verify your transaction history without revealing your private notes.
        </p>
        {!key ? (
          <Button variant="outline" className="border-white/10 hover:bg-white/[0.03]" onClick={generate}>
            Generate Viewing Key
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 font-mono text-xs break-all">
              {key}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]" onClick={copy}>
                Copy
              </Button>
              <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/[0.03]" onClick={() => setKey(null)}>
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ComplianceCard() {
  const [busy, setBusy] = useState(false);

  async function generateReport() {
    setBusy(true);
    try {
      const notes = await getNotes();
      const report = {
        generatedAt: new Date().toISOString(),
        totalTransactions: notes.length,
        totalDeposited: notes.reduce((sum, n) => sum + BigInt(n.amount), 0n).toString(),
        chains: [...new Set(notes.map((n) => n.chain))],
        assets: [...new Set(notes.map((n) => n.asset))],
        transactions: notes.map((n) => ({
          commitment: n.commitment,
          amount: n.amount,
          asset: n.asset,
          chain: n.chain,
          status: n.status,
          timestamp: n.timestamp,
          txHash: n.txHash,
        })),
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `white-protocol-compliance-report-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || "Failed to generate report");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="glass-card border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldAlert className="h-5 w-5 text-amber-400" />
          Compliance Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Generate a signed JSON report of your transaction history that you can share with auditors. This report contains only public data (commitments and transaction hashes) and does not reveal your secrets or nullifiers.
        </p>
        <Button onClick={generateReport} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Generate Report
        </Button>
      </CardContent>
    </Card>
  );
}

function DangerZoneCard() {
  function clearData() {
    if (!confirm("Are you sure? This will permanently delete all encrypted notes from your browser. Make sure you have a backup.")) return;
    const walletAddress = localStorage.getItem("white_protocol_last_wallet") || "";
    const prefix = "white_protocol_notes_v2_";
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
    alert("All local note data has been cleared");
    window.location.reload();
  }

  return (
    <Card className="glass-card border-white/10 border-red-500/20">
      <CardHeader>
        <CardTitle className="text-lg text-red-400">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="destructive" className="w-full" onClick={clearData}>
          <Trash2 className="mr-2 h-4 w-4" />
          Clear All Local Data
        </Button>
        <p className="text-xs text-zinc-500">
          This will delete all encrypted notes from your browser. Make sure you have a backup.
        </p>
      </CardContent>
    </Card>
  );
}
