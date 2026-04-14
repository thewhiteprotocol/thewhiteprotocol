"use client";

import React from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Trash2 } from "lucide-react";

export default function SettingsPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-zinc-400">Manage your privacy wallet preferences.</p>
      </div>

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Relayer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Custom Relayer URL</label>
            <Input
              placeholder="https://relayer.thewhiteprotocol.org"
              className="border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-500"
            />
          </div>
          <Button variant="outline" className="border-white/10 hover:bg-white/[0.03]">
            Save
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">Compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-400" />
              <div>
                <p className="text-sm font-medium">Viewing Key</p>
                <p className="text-xs text-zinc-500">Allow auditors to read your history</p>
              </div>
            </div>
            <Badge variant="outline" className="border-white/10 text-zinc-400">
              Coming soon
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-white/10 border-red-500/20">
        <CardHeader>
          <CardTitle className="text-lg text-red-400">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" className="w-full">
            <Trash2 className="mr-2 h-4 w-4" />
            Clear All Local Data
          </Button>
          <p className="mt-2 text-xs text-zinc-500">
            This will delete all encrypted notes from your browser. Make sure you have a backup.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
