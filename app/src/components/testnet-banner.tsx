"use client";

import React from "react";

export function TestnetBanner() {
  return (
    <div className="flex h-8 items-center justify-center bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 text-xs font-medium text-amber-300">
      <span className="mr-2">⚠️</span>
      Testnet only. Do not use real funds. Private notes are stored locally in this browser unless you export or import them.
    </div>
  );
}
