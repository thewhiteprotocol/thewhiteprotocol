import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Mode = "idle" | "deposit" | "withdraw" | "privacy";

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  body: string;
};

const COLORS = {
  bg: "#0a0a0c",
  card: "#111114",
  deposit: "#22c55e",
  withdraw: "#ef4444",
  proof: "#60a5fa",
  pool: "#818cf8",
  ink: "#f4f4f5",
  muted: "#71717a",
  shadow: "#000000",
  highlight: "#18181b",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const fmtHash = (h: string) => {
  if (!h) return "";
  const s = h.replace(/^0x/i, "0x");
  return s.length <= 12 ? s : `${s.slice(0, 10)}...`;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function glow(color: string) {
  return `drop-shadow(0 0 3px ${color}40)`;
}

function useTimers() {
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const set = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
  };
  useEffect(() => () => clear(), []);
  return { set, clear };
}

function AnimatedPath({
  d,
  active,
  color,
  width = 2.25,
  dashed = true,
  glowOn = true,
  duration = 1.2,
  delay = 0,
}: {
  d: string;
  active: boolean;
  color: string;
  width?: number;
  dashed?: boolean;
  glowOn?: boolean;
  duration?: number;
  delay?: number;
}) {
  const dash = dashed ? "8 10" : undefined;
  return (
    <g>
      <path d={d} stroke="#c8ccd4" strokeWidth={width} fill="none" opacity={0.5} />
      <motion.path
        d={d}
        stroke={color}
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        initial={{ opacity: 0.15, strokeDashoffset: 0 }}
        animate={
          active
            ? {
                opacity: 1,
                strokeDashoffset: dashed ? -90 : 0,
                transition: {
                  opacity: { duration: 0.25, delay },
                  strokeDashoffset: { duration, ease: "linear", repeat: Infinity },
                },
              }
            : { opacity: 0.2, strokeDashoffset: 0, transition: { duration: 0.25 } }
        }
        style={{ filter: active && glowOn ? glow(color) : "none" }}
      />
    </g>
  );
}

function NodeBox({
  x, y, w, h, title, subtitle, color, active, onHover, onLeave, onMove, tag,
}: {
  x: number; y: number; w: number; h: number; title: string; subtitle?: string;
  color: string; active: boolean; onHover?: () => void; onLeave?: () => void;
  onMove?: (e: React.MouseEvent) => void; tag?: string;
}) {
  return (
    <g onMouseEnter={onHover} onMouseLeave={onLeave} onMouseMove={onMove} style={{ cursor: onHover ? "help" : "default" }}>
      <defs>
        <filter id={`neumorph-${x}-${y}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="3" dy="3" stdDeviation="5" floodColor="#000000" floodOpacity="0.6" />
          <feDropShadow dx="-2" dy="-2" stdDeviation="4" floodColor="#1e293b" floodOpacity="0.4" />
        </filter>
      </defs>
      <motion.rect
        x={x} y={y} width={w} height={h} rx={16}
        fill={COLORS.card}
        stroke={active ? color : "#334155"}
        strokeWidth={active ? 2.5 : 1.25}
        filter={`url(#neumorph-${x}-${y})`}
        initial={false}
        animate={{ opacity: active ? 1 : 0.9, filter: active ? glow(color) : `url(#neumorph-${x}-${y})` }}
        transition={{ duration: 0.25 }}
      />
      <text x={x + 16} y={y + 26} fill={COLORS.ink} fontFamily={MONO} fontSize={14} fontWeight="600">{title}</text>
      {subtitle && <text x={x + 16} y={y + 46} fill={COLORS.muted} fontFamily={MONO} fontSize={11}>{subtitle}</text>}
      {tag && (
        <g>
          <rect x={x + w - 70} y={y + 10} width={56} height={22} rx={11} fill={COLORS.card} stroke={active ? color : "#334155"} strokeWidth={1.25} />
          <text x={x + w - 42} y={y + 26} textAnchor="middle" fill={active ? color : COLORS.muted} fontFamily={MONO} fontSize={10} fontWeight="600">{tag}</text>
        </g>
      )}
    </g>
  );
}

function CheckBadge({ x, y, ok }: { x: number; y: number; ok: boolean }) {
  return (
    <g>
      <motion.circle cx={x} cy={y} r={12} fill={ok ? "#064e3b" : "#450a0a"} stroke={ok ? COLORS.deposit : COLORS.withdraw} strokeWidth={2}
        initial={false} animate={{ scale: ok ? 1 : 0.92, opacity: 1 }} transition={{ duration: 0.2 }} style={{ filter: glow(ok ? COLORS.deposit : COLORS.withdraw) }} />
      <motion.path d={ok ? "M-4 1 L-1 4 L5 -4" : "M-4 -4 L4 4 M4 -4 L-4 4"} transform={`translate(${x}, ${y})`} fill="none" stroke={ok ? COLORS.deposit : COLORS.withdraw} strokeWidth={2.25} strokeLinecap="round"
        initial={false} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.25 }} />
    </g>
  );
}

function ECPoints({ x, y, visible, tint }: { x: number; y: number; visible: boolean; tint: string }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.g initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.25 }}>
          <g style={{ filter: glow(tint) }}>
            <text x={x} y={y - 10} fill={COLORS.muted} fontFamily={MONO} fontSize={12}>proof {"{A, B, C}"}</text>
            <g transform={`translate(${x}, ${y})`}>
              <circle cx={0} cy={0} r={9} fill={COLORS.card} stroke={tint} strokeWidth={2} />
              <text x={18} y={4} fill={COLORS.ink} fontFamily={MONO} fontSize={12}>A (G1, 64B)</text>
            </g>
            <g transform={`translate(${x}, ${y + 26})`}>
              <circle cx={0} cy={0} r={9} fill={COLORS.card} stroke={tint} strokeWidth={2} />
              <circle cx={0} cy={0} r={5} fill="none" stroke={tint} strokeWidth={2} />
              <text x={18} y={4} fill={COLORS.ink} fontFamily={MONO} fontSize={12}>B (G2, 128B)</text>
            </g>
            <g transform={`translate(${x}, ${y + 52})`}>
              <circle cx={0} cy={0} r={9} fill={COLORS.card} stroke={tint} strokeWidth={2} />
              <text x={18} y={4} fill={COLORS.ink} fontFamily={MONO} fontSize={12}>C (G1, 64B)</text>
            </g>
          </g>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-white/[0.03] border border-white/[0.06] px-3 py-1.5">
      <span className="font-mono text-xs text-zinc-400">{label}</span>
      <span className="font-mono text-xs font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

export default function ProtocolFlowVisualizer() {
  const base = useMemo(() => ({
    deposit: { amount: 0.1, asset_id: "SOL", secret: "0x7d0c1e2b...", nullifier: "0xa9b12c03...", commitment: "0x2168d409a1b7c1fe...", proofA: "(0x1025e308..., 0x1710a7ec...)", proofB: "[[x_real,x_imag],[y_real,y_imag]]", proofC: "(0x11c021c8..., 0x0e9ae5f4...)" },
    tree: { depth: 20, leaves: 1234, root: "0x3a7f9c21f18d0b6e..." },
    pool: { totalDeposits: 5678, tvl: 1234.56, assets: ["SOL", "USDC", "BONK"] },
  }), []);

  const [mode, setMode] = useState<Mode>("idle");
  const [speed, setSpeed] = useState<number>(1);
  const [depositStep, setDepositStep] = useState<number>(0);
  const [withdrawStep, setWithdrawStep] = useState<number>(0);
  const [commitments, setCommitments] = useState<number>(base.tree.leaves);
  const [tvl, setTvl] = useState<number>(base.pool.tvl);
  const [totalDeposits, setTotalDeposits] = useState<number>(base.pool.totalDeposits);
  const [root, setRoot] = useState<string>(base.tree.root);
  const [spentCount, setSpentCount] = useState<number>(842);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, title: "", body: "" });

  const timers = useTimers();

  const reset = () => { timers.clear(); setMode("idle"); setDepositStep(0); setWithdrawStep(0); setTooltip((t) => ({ ...t, visible: false })); };

  const startDeposit = () => {
    timers.clear(); setMode("deposit"); setWithdrawStep(0); setDepositStep(1);
    const t = (ms: number) => Math.round(ms / clamp(speed, 0.5, 2));
    timers.set(() => setDepositStep(2), t(900));
    timers.set(() => setDepositStep(3), t(1600));
    timers.set(() => setDepositStep(4), t(2400));
    timers.set(() => setDepositStep(5), t(3200));
    timers.set(() => { setDepositStep(6); setCommitments((c) => c + 1); setTvl((v) => Math.round((v + base.deposit.amount) * 100) / 100); setTotalDeposits((d) => d + 1); setRoot((prev) => { const hex = ((Date.now() & 0xffffffff) >>> 0).toString(16).padStart(8, "0"); return `0x${hex}${prev.slice(10)}`; }); }, t(4000));
    timers.set(() => { setDepositStep(0); setMode("idle"); }, t(5600));
  };

  const startWithdrawal = () => {
    timers.clear(); setMode("withdraw"); setDepositStep(0); setWithdrawStep(1);
    const t = (ms: number) => Math.round(ms / clamp(speed, 0.5, 2));
    timers.set(() => setWithdrawStep(2), t(900));
    timers.set(() => setWithdrawStep(3), t(1800));
    timers.set(() => setWithdrawStep(4), t(2600));
    timers.set(() => setWithdrawStep(5), t(3400));
    timers.set(() => { setWithdrawStep(6); setSpentCount((s) => s + 1); setTvl((v) => Math.max(0, Math.round((v - base.deposit.amount) * 100) / 100)); }, t(4200));
    timers.set(() => { setWithdrawStep(0); setMode("idle"); }, t(5600));
  };

  const showPrivacy = () => { timers.clear(); setMode("privacy"); setDepositStep(0); setWithdrawStep(0); };

  const tip = (title: string, body: string) => setTooltip((t) => ({ ...t, visible: true, title, body }));
  const hideTip = () => setTooltip((t) => ({ ...t, visible: false }));
  const moveTip = (e: React.MouseEvent) => { const rect = (e.currentTarget as SVGElement).getBoundingClientRect(); setTooltip((t) => ({ ...t, x: e.clientX - rect.left, y: e.clientY - rect.top })); };

  const W = 1080, H = 640;
  const nodes = useMemo(() => ({ user: { x: 40, y: 70, w: 290, h: 120 }, poseidon: { x: 40, y: 220, w: 290, h: 92 }, circuit: { x: 395, y: 90, w: 290, h: 110 }, prover: { x: 395, y: 230, w: 290, h: 110 }, solana: { x: 750, y: 70, w: 290, h: 140 }, spent: { x: 750, y: 230, w: 290, h: 110 }, pool: { x: 200, y: 360, w: 680, h: 230 } }), []);

  const active = {
    user: mode === "deposit" ? depositStep >= 1 && depositStep <= 2 : mode === "withdraw" ? withdrawStep >= 1 && withdrawStep <= 2 : false,
    poseidon: mode === "deposit" ? depositStep === 2 : mode === "withdraw" ? withdrawStep === 2 : false,
    circuit: mode === "deposit" ? depositStep === 3 : mode === "withdraw" ? withdrawStep === 3 : false,
    prover: mode === "deposit" ? depositStep === 4 : mode === "withdraw" ? withdrawStep === 4 : false,
    solana: mode === "deposit" ? depositStep === 5 : mode === "withdraw" ? withdrawStep === 5 : false,
    spent: mode === "withdraw" ? withdrawStep >= 5 && withdrawStep <= 6 : false,
    pool: mode === "deposit" ? depositStep >= 5 && depositStep <= 6 : mode === "withdraw" ? withdrawStep >= 5 && withdrawStep <= 6 : mode === "privacy",
  };

  const depositPath1 = `M${nodes.user.x + nodes.user.w / 2} ${nodes.user.y + nodes.user.h} C${nodes.user.x + nodes.user.w / 2} ${nodes.user.y + nodes.user.h + 30}, ${nodes.poseidon.x + nodes.poseidon.w / 2} ${nodes.poseidon.y - 30}, ${nodes.poseidon.x + nodes.poseidon.w / 2} ${nodes.poseidon.y}`;
  const depositPath2 = `M${nodes.poseidon.x + nodes.poseidon.w} ${nodes.poseidon.y + nodes.poseidon.h / 2} C${nodes.poseidon.x + nodes.poseidon.w + 40} ${nodes.poseidon.y + nodes.poseidon.h / 2}, ${nodes.circuit.x - 40} ${nodes.circuit.y + nodes.circuit.h / 2}, ${nodes.circuit.x} ${nodes.circuit.y + nodes.circuit.h / 2}`;
  const depositPath3 = `M${nodes.circuit.x + nodes.circuit.w} ${nodes.circuit.y + nodes.circuit.h / 2} C${nodes.circuit.x + nodes.circuit.w + 40} ${nodes.circuit.y + nodes.circuit.h / 2}, ${nodes.prover.x - 40} ${nodes.prover.y + nodes.prover.h / 2}, ${nodes.prover.x} ${nodes.prover.y + nodes.prover.h / 2}`;
  const depositPath4 = `M${nodes.prover.x + nodes.prover.w} ${nodes.prover.y + nodes.prover.h / 2} C${nodes.prover.x + nodes.prover.w + 40} ${nodes.prover.y + nodes.prover.h / 2}, ${nodes.solana.x - 40} ${nodes.solana.y + nodes.solana.h / 2}, ${nodes.solana.x} ${nodes.solana.y + nodes.solana.h / 2}`;
  const toPoolPath = `M${nodes.solana.x + nodes.solana.w / 2} ${nodes.solana.y + nodes.solana.h} C${nodes.solana.x + nodes.solana.w / 2} ${nodes.solana.y + nodes.solana.h + 60}, ${nodes.pool.x + nodes.pool.w - 120} ${nodes.pool.y - 40}, ${nodes.pool.x + nodes.pool.w - 120} ${nodes.pool.y}`;
  const withdrawPath1 = `M${nodes.user.x + nodes.user.w} ${nodes.user.y + nodes.user.h / 2} C${nodes.user.x + nodes.user.w + 60} ${nodes.user.y + nodes.user.h / 2}, ${nodes.circuit.x - 60} ${nodes.circuit.y + nodes.circuit.h / 2}, ${nodes.circuit.x} ${nodes.circuit.y + nodes.circuit.h / 2}`;
  const withdrawPath2 = `M${nodes.prover.x + nodes.prover.w} ${nodes.prover.y + nodes.prover.h / 2} C${nodes.prover.x + nodes.prover.w + 40} ${nodes.prover.y + nodes.prover.h / 2}, ${nodes.spent.x - 40} ${nodes.spent.y + nodes.spent.h / 2}, ${nodes.spent.x} ${nodes.spent.y + nodes.spent.h / 2}`;
  const fromPoolPath = `M${nodes.pool.x + 120} ${nodes.pool.y} C${nodes.pool.x + 120} ${nodes.pool.y - 60}, ${nodes.spent.x + 140} ${nodes.spent.y + nodes.spent.h + 60}, ${nodes.spent.x + 140} ${nodes.spent.y + nodes.spent.h}`;

  const showProof = (mode === "deposit" && depositStep === 4) || (mode === "withdraw" && withdrawStep === 4);
  const showCheck = (mode === "deposit" && depositStep === 5) || (mode === "withdraw" && withdrawStep === 5);
  const tokenIntoPool = mode === "deposit" && depositStep >= 5;
  const tokenOutPool = mode === "withdraw" && withdrawStep >= 6;

  const mixParticles = useMemo(() => new Array(8).fill(0).map((_, i) => ({ id: i, color: i % 3 === 0 ? COLORS.deposit : i % 3 === 1 ? COLORS.proof : "#06b6d4", phase: i * 0.8 })), []);

  return (
    <div className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[300px]">
              <div className="text-lg font-bold text-white">The White Protocol — Private Settlement Flow</div>
              <div className="text-sm text-zinc-400">Groth16 (BN254), Poseidon Merkle, Circom/snarkjs, Multi-chain verification</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { label: "Start Deposit", onClick: startDeposit },
                { label: "Start Withdrawal", onClick: startWithdrawal },
                { label: "Privacy Guarantees", onClick: showPrivacy },
                { label: "Reset", onClick: reset },
              ].map((btn) => (
                <button key={btn.label} onClick={btn.onClick} className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.12] active:bg-white/[0.08] transition-all">
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/[0.06] px-4 py-2">
              <span className="text-xs font-mono text-zinc-400">Speed</span>
              <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="w-32 accent-zinc-400" />
              <span className="text-xs font-mono text-white font-semibold">{speed.toFixed(1)}x</span>
            </div>
            <StatPill label="Commitments" value={commitments.toLocaleString()} color={COLORS.pool} />
            <StatPill label="TVL" value={`${tvl.toLocaleString(undefined, { minimumFractionDigits: 2 })} SOL`} color={COLORS.pool} />
            <StatPill label="Deposits" value={totalDeposits.toLocaleString()} color={COLORS.deposit} />
            <StatPill label="Nullifiers" value={spentCount.toLocaleString()} color={COLORS.withdraw} />
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#0a0a0c] border border-white/[0.06]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[580px] w-full select-none">
            <defs>
              <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1e293b" strokeWidth="0.5" opacity="0.5" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={W} height={H} fill={COLORS.bg} />
            <rect x="0" y="0" width={W} height={H} fill="url(#grid)" />

            <AnimatedPath d={depositPath1} active={mode === "deposit" && depositStep >= 1 && depositStep <= 2} color={COLORS.deposit} duration={1.2 / speed} />
            <AnimatedPath d={depositPath2} active={mode === "deposit" && depositStep >= 3} color={COLORS.deposit} duration={1.1 / speed} />
            <AnimatedPath d={depositPath3} active={mode === "deposit" && depositStep >= 4} color={COLORS.proof} duration={1.1 / speed} />
            <AnimatedPath d={depositPath4} active={mode === "deposit" && depositStep >= 4} color={COLORS.proof} duration={1.05 / speed} />
            <AnimatedPath d={toPoolPath} active={tokenIntoPool} color={COLORS.pool} duration={1.0 / speed} dashed />
            <AnimatedPath d={withdrawPath1} active={mode === "withdraw" && withdrawStep >= 3} color={COLORS.withdraw} duration={1.1 / speed} />
            <AnimatedPath d={withdrawPath2} active={mode === "withdraw" && withdrawStep >= 4} color={COLORS.proof} duration={1.05 / speed} />
            <AnimatedPath d={fromPoolPath} active={mode === "withdraw" && withdrawStep >= 5} color={COLORS.withdraw} duration={1.1 / speed} dashed />

            <NodeBox x={nodes.user.x} y={nodes.user.y} w={nodes.user.w} h={nodes.user.h} title="User" subtitle={mode === "deposit" ? "secret, nullifier, amount" : mode === "withdraw" ? "secret, nullifier, path" : "inputs and witness"} color={mode === "withdraw" ? COLORS.withdraw : COLORS.deposit} active={active.user} tag="INPUT" onHover={() => tip("User Inputs", "Deposit: commitment = Poseidon(secret, nullifier, amount). Withdrawal: prove membership without revealing commitment.")} onLeave={hideTip} onMove={moveTip} />
            <NodeBox x={nodes.poseidon.x} y={nodes.poseidon.y} w={nodes.poseidon.w} h={nodes.poseidon.h} title="Commitment Hash" subtitle={mode === "withdraw" ? `nullifier = ${fmtHash("0x2d4d9aa7...")}` : `commit = ${fmtHash(base.deposit.commitment)}`} color={mode === "withdraw" ? COLORS.withdraw : COLORS.deposit} active={active.poseidon} tag="HASH" onHover={() => tip("Commitment Hash", "ZK-friendly hash for commitments and Merkle tree.")} onLeave={hideTip} onMove={moveTip} />
            <NodeBox x={nodes.circuit.x} y={nodes.circuit.y} w={nodes.circuit.w} h={nodes.circuit.h} title="Circom Circuit" subtitle={mode === "deposit" ? "commitment constraints" : mode === "withdraw" ? "membership constraints" : "Groth16 constraints"} color={COLORS.proof} active={active.circuit} tag="CIRCUIT" onHover={() => tip("Circom Circuit", "Generates R1CS constraints for Groth16 proving.")} onLeave={hideTip} onMove={moveTip} />
            <NodeBox x={nodes.prover.x} y={nodes.prover.y} w={nodes.prover.w} h={nodes.prover.h} title="Local Prover" subtitle={mode === "withdraw" ? "withdrawal proof" : "deposit proof"} color={COLORS.proof} active={active.prover} tag="PROVE" onHover={() => tip("Local Prover", "Generates proof {A,B,C} on BN254 curve.")} onLeave={hideTip} onMove={moveTip} />
            <NodeBox x={nodes.solana.x} y={nodes.solana.y} w={nodes.solana.w} h={nodes.solana.h} title="On-chain Program" subtitle="verify + update pool" color={COLORS.pool} active={active.solana} tag="VERIFY" onHover={() => tip("On-chain Verification", "Verifies Groth16 proof and updates Merkle tree or nullifier set.")} onLeave={hideTip} onMove={moveTip} />
            <NodeBox x={nodes.spent.x} y={nodes.spent.y} w={nodes.spent.w} h={nodes.spent.h} title="Nullifier Registry" subtitle="prevents double-spend" color={COLORS.withdraw} active={active.spent} tag="SET" onHover={() => tip("Nullifier Registry", "Tracks spent notes to prevent double-spending.")} onLeave={hideTip} onMove={moveTip} />

            <ECPoints x={420} y={380} visible={showProof} tint={COLORS.proof} />

            <AnimatePresence>
              {showCheck && (
                <motion.g initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.25 }}>
                  <rect x={740} y={220} width={300} height={70} rx={16} fill={COLORS.card} stroke="#c8ccd4" />
                  <text x={755} y={248} fill={COLORS.muted} fontFamily={MONO} fontSize={11}>e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ)=1</text>
                  <text x={755} y={270} fill={COLORS.ink} fontFamily={MONO} fontSize={11}>pairing check: 4×(G1,G2)</text>
                  <CheckBadge x={1014} y={255} ok />
                </motion.g>
              )}
            </AnimatePresence>

            <motion.rect x={nodes.pool.x} y={nodes.pool.y} width={nodes.pool.w} height={nodes.pool.h} rx={22} fill={COLORS.card} stroke={active.pool ? COLORS.pool : "#c8ccd4"} strokeWidth={active.pool ? 2.5 : 1.25}
              initial={false} animate={{ filter: active.pool ? glow(COLORS.pool) : "none" }} transition={{ duration: 0.25 }} />
            <text x={nodes.pool.x + 18} y={nodes.pool.y + 30} fill={COLORS.ink} fontFamily={MONO} fontSize={14} fontWeight="600">Shielded Pool</text>
            <text x={nodes.pool.x + 18} y={nodes.pool.y + 54} fill={COLORS.muted} fontFamily={MONO} fontSize={12}>Root: {fmtHash(root)} · Depth: {base.tree.depth} · Leaves: {commitments}</text>
            <text x={nodes.pool.x + 18} y={nodes.pool.y + 74} fill={COLORS.muted} fontFamily={MONO} fontSize={12}>TVL: {tvl.toFixed(2)} SOL · Assets: {base.pool.assets.length}</text>

            <g transform={`translate(${nodes.pool.x + 30}, ${nodes.pool.y + 102})`}>
              <text x={0} y={-10} fill={COLORS.muted} fontFamily={MONO} fontSize={12}>Merkle Tree</text>
              {new Array(7).fill(0).map((_, i) => {
                const lx = i * 44, ly = 88;
                const leafActive = mode === "deposit" && depositStep >= 6 && i === 6;
                const provingPath = mode === "withdraw" && withdrawStep >= 3 && (i === 2 || i === 3);
                const c = leafActive ? COLORS.deposit : provingPath ? COLORS.withdraw : "#94a3b8";
                return <motion.rect key={i} x={lx} y={ly} width={28} height={16} rx={6} fill={COLORS.card} stroke={c} strokeWidth={provingPath || leafActive ? 2 : 1.25} initial={false} animate={{ opacity: provingPath || leafActive ? 1 : 0.7, filter: provingPath || leafActive ? glow(c) : "none" }} transition={{ duration: 0.25 }} />;
              })}
              {new Array(4).fill(0).map((_, i) => { const px = i * 66 + 12, py = 58; const act = (mode === "deposit" && depositStep >= 6) || (mode === "withdraw" && withdrawStep >= 3); return <motion.circle key={`p-${i}`} cx={px} cy={py} r={7} fill={COLORS.card} stroke={act ? COLORS.pool : "#94a3b8"} strokeWidth={act ? 2 : 1.25} initial={false} animate={{ opacity: act ? 1 : 0.6, filter: act ? glow(COLORS.pool) : "none" }} transition={{ duration: 0.25 }} />; })}
              {new Array(2).fill(0).map((_, i) => { const px = i * 132 + 45, py = 28; const act = (mode === "deposit" && depositStep >= 6) || (mode === "withdraw" && withdrawStep >= 3); return <motion.circle key={`pp-${i}`} cx={px} cy={py} r={8} fill={COLORS.card} stroke={act ? COLORS.pool : "#94a3b8"} strokeWidth={act ? 2 : 1.25} initial={false} animate={{ opacity: act ? 1 : 0.6, filter: act ? glow(COLORS.pool) : "none" }} transition={{ duration: 0.25 }} />; })}
              <motion.circle cx={110} cy={0} r={10} fill={COLORS.card} stroke={COLORS.pool} strokeWidth={2.5} initial={false} animate={{ filter: glow(COLORS.pool), scale: (mode === "deposit" && depositStep >= 6) || (mode === "withdraw" && withdrawStep >= 3) ? [1, 1.06, 1] : 1 }} transition={{ duration: 0.55 / speed, repeat: ((mode === "deposit" && depositStep >= 6) || (mode === "withdraw" && withdrawStep >= 3)) ? Infinity : 0 }} />
              <text x={126} y={4} fill={COLORS.ink} fontFamily={MONO} fontSize={12}>root</text>
              <g opacity={0.5} stroke="#94a3b8" strokeWidth={1.5} fill="none">
                {new Array(7).fill(0).map((_, i) => <path key={`l-${i}`} d={`M${i * 44 + 14} 88 L${Math.floor(i / 2) * 66 + 12} 58`} />)}
                {new Array(4).fill(0).map((_, i) => <path key={`p2-${i}`} d={`M${i * 66 + 12} 58 L${Math.floor(i / 2) * 132 + 45} 28`} />)}
                {new Array(2).fill(0).map((_, i) => <path key={`u2-${i}`} d={`M${i * 132 + 45} 28 L110 0`} />)}
              </g>
            </g>

            <AnimatePresence>{tokenIntoPool && <motion.circle r={7} fill={COLORS.deposit} style={{ filter: glow(COLORS.deposit) }} initial={{ cx: nodes.solana.x + nodes.solana.w / 2, cy: nodes.solana.y + nodes.solana.h - 6 }} animate={{ cx: nodes.pool.x + nodes.pool.w - 120, cy: nodes.pool.y + 16 }} transition={{ duration: 1.2 / speed, ease: "easeInOut" }} />}</AnimatePresence>
            <AnimatePresence>{tokenOutPool && <motion.circle r={7} fill={COLORS.withdraw} style={{ filter: glow(COLORS.withdraw) }} initial={{ cx: nodes.pool.x + 120, cy: nodes.pool.y + 16 }} animate={{ cx: nodes.spent.x + 140, cy: nodes.spent.y + nodes.spent.h - 8 }} transition={{ duration: 1.2 / speed, ease: "easeInOut" }} />}</AnimatePresence>

            <AnimatePresence>

                          {mode === "privacy" && (
                            <motion.g 
                              initial={{ opacity: 0 }} 
                              animate={{ opacity: 1 }} 
                              exit={{ opacity: 0 }} 
                              transition={{ duration: 0.5 }}
                            >
                              <defs>
                                <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                  <stop offset="0%" stopColor={COLORS.proof} stopOpacity={0.15} />
                                  <stop offset="100%" stopColor={COLORS.proof} stopOpacity={0.0} />
                                </linearGradient>
                                <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                  <stop offset="0%" stopColor={COLORS.card} stopOpacity={0.9} />
                                  <stop offset="100%" stopColor={COLORS.bg} stopOpacity={0.8} />
                                </linearGradient>
                                <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                                  <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                                  <feMerge>
                                    <feMergeNode in="coloredBlur"/>
                                    <feMergeNode in="SourceGraphic"/>
                                  </feMerge>
                                </filter>
                              </defs>

                              {/* --- BACKGROUND --- */}
                              <rect x={20} y={20} width={W - 40} height={H - 40} rx={24} fill={COLORS.bg} opacity={1} stroke={COLORS.pool} strokeWidth={0.5} strokeOpacity={0.3} />

                              {/* --- HEADER --- */}
                              <g transform={`translate(${W/2}, 60)`}>
                                <text textAnchor="middle" fill={COLORS.ink} fontFamily={MONO} fontSize={20} fontWeight="800">The White Protocol v2 SHIELDED POOL</text>
                                <text y={20} textAnchor="middle" fill={COLORS.muted} fontFamily={MONO} fontSize={10} letterSpacing="1px">
                                  BATCHED SETTLEMENT • LOCAL PROOFS • ZERO KNOWLEDGE
                                </text>
                              </g>

                              {/* --- LAYOUT CALCULATIONS --- */}
                              {(() => {
                                const COL_L = W * 0.15; // Users
                                const COL_SEQ = W * 0.30; // Sequencer/Buffer
                                const COL_POOL = W * 0.55; // Main Pool
                                const COL_R = W * 0.85; // Recipients
                                const ROW_START = 140;

                                return (
                                  <>
                                    {/* --- STEP 1: DEPOSITORS (Users) --- */}
                                    <g transform={`translate(${COL_L}, ${ROW_START})`}>
                                       <text y={-20} textAnchor="middle" fill={COLORS.deposit} fontFamily={MONO} fontSize={10} fontWeight="700">USER INTENT</text>
                                       {[0, 1, 2].map(i => (
                                         <motion.g key={i} transform={`translate(0, ${i * 50})`}>
                                           <circle r={15} fill={COLORS.card} stroke={COLORS.deposit} strokeWidth={1} />
                                           <text dy={4} textAnchor="middle" fontSize={10}>◉</text>
                                           {/* Individual Deposit Flying to Buffer */}
                                           <motion.circle r={3} fill={COLORS.deposit} 
                                             animate={{cx: [15, 80], opacity: [0, 1, 0]}}
                                             transition={{duration: 1.5, delay: i * 0.5, repeat: Infinity}}
                                           />
                                         </motion.g>
                                       ))}
                                    </g>

                                    {/* --- STEP 2: PENDING BUFFER & SEQUENCER (The Unique v2 Feature) --- */}
                                    <g transform={`translate(${COL_SEQ}, ${H/2 + 20})`}>
                                      {/* The Buffer Box */}
                                      <rect x={-40} y={-80} width={80} height={160} rx={12} fill="url(#cardGrad)" stroke={COLORS.deposit} strokeWidth={1} strokeDasharray="4 4" />
                                      <text y={-95} textAnchor="middle" fill={COLORS.deposit} fontFamily={MONO} fontSize={10} fontWeight="700">PENDING BUFFER</text>

                                      {/* Buffer Items Accumulating */}
                                      {[0, 1, 2, 3].map(i => (
                                        <motion.circle key={`buf-${i}`} r={4} fill={COLORS.deposit} cx={(i%2 === 0 ? -15 : 15)} cy={-40 + i * 20}
                                          animate={{ opacity: [0.3, 1, 0.3], scale: [1, 1.2, 1] }}
                                          transition={{ duration: 2, delay: i * 0.2, repeat: Infinity }}
                                        />
                                      ))}

                                      {/* The Sequencer "Batcher" Arm */}
                                      <motion.g animate={{ x: [40, 100, 40], opacity: [0, 1, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
                                        <rect x={-10} y={-15} width={60} height={30} rx={15} fill={COLORS.pool} />
                                        <text x={20} y={4} textAnchor="middle" fill="#fff" fontFamily={MONO} fontSize={9}>BATCH</text>
                                      </motion.g>

                                      {/* Connecting Line to Pool */}
                                      <path d={`M 40 0 L ${COL_POOL - COL_SEQ - 60} 0`} stroke={COLORS.pool} strokeWidth={2} strokeDasharray="4 4" opacity={0.5} />
                                    </g>

                                    {/* --- STEP 3: YIELD-BEARING POOL --- */}
                                    <g transform={`translate(${COL_POOL}, ${H/2 + 20})`}>
                                      {/* Outer rotating Merkle rings */}
                                      <motion.circle r={100} fill="none" stroke={COLORS.pool} strokeWidth={1} strokeDasharray="8 8" opacity={0.4}
                                        animate={{ rotate: 360 }} transition={{ duration: 40, ease: "linear", repeat: Infinity }} />

                                      {/* Shield Core */}
                                      <path d="M0 -60 C40 -60 55 -30 55 10 C55 50 0 80 0 80 C0 80 -55 50 -55 10 C-55 -30 -40 -60 0 -60 Z" 
                                            fill="url(#shieldGrad)" stroke={COLORS.proof} strokeWidth={2} filter="url(#neonGlow)" />

                                      {/* Yield "Gold" Particles Rising (New Feature) */}
                                      {[...Array(6)].map((_, i) => (
                                         <motion.text key={`yield-${i}`}
                                           x={(Math.random() - 0.5) * 60}
                                           fontSize={10} fill="{COLORS.pool}" fontWeight="bold"
                                           initial={{ y: 40, opacity: 0 }}
                                           animate={{ y: -40, opacity: [0, 1, 0] }}
                                           transition={{ duration: 3, delay: i * 0.5, repeat: Infinity }}
                                         >+</motion.text>
                                      ))}

                                      {/* Center Text */}
                                      <text y={5} textAnchor="middle" fill={COLORS.proof} fontFamily={MONO} fontSize={16} fontWeight="bold">LST POOL</text>
                                      <motion.text y={25} textAnchor="middle" fill="{COLORS.pool}" fontFamily={MONO} fontSize={10} 
                                        animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
                                        SHIELDED
                                      </motion.text>
                                    </g>

                                    {/* --- STEP 4: WITHDRAWAL & RELAYER --- */}
                                    <g transform={`translate(${COL_R}, ${ROW_START + 50})`}>
                                      <text y={-60} textAnchor="middle" fill={COLORS.withdraw} fontFamily={MONO} fontSize={10} fontWeight="700">RELAYER & USER</text>

                                      {/* Relayer Node */}
                                      <g transform="translate(0, -20)">
                                        <rect x={-30} y={-15} width={60} height={30} rx={6} fill={COLORS.card} stroke={COLORS.withdraw} strokeWidth={1} />
                                        <text y={4} textAnchor="middle" fill={COLORS.muted} fontFamily={MONO} fontSize={9}>RELAYER</text>

                                        {/* Fee Splitting Animation */}
                                        <motion.circle r={2} fill="red" cx={0} cy={15} 
                                           animate={{ cy: [15, 30], opacity: [1, 0] }} transition={{ duration: 2, repeat: Infinity }} 
                                        />
                                        <text x={10} y={35} fontSize={8} fill={COLORS.muted}>5% Fee</text>
                                      </g>

                                      {/* Connector from Pool */}
                                      <path d={`M -${COL_R - COL_POOL - 60} 40 C -100 40, -50 -20, -35 -20`} fill="none" stroke={COLORS.withdraw} strokeWidth={1} strokeDasharray="4 4" />

                                      {/* Recipient Wallets */}
                                      {[0, 1].map(i => (
                                        <g key={i} transform={`translate(0, ${40 + i * 50})`}>
                                          <rect x={-40} y={-15} width={80} height={30} rx={8} fill={COLORS.card} stroke={COLORS.withdraw} strokeWidth={1} strokeOpacity={0.5} />
                                          <text y={4} textAnchor="middle" fill={COLORS.muted} fontFamily={MONO} fontSize={9}>Wallet {i === 0 ? 'A' : 'B'}</text>
                                          <circle cx={-50} cy={0} r={3} fill={COLORS.withdraw} />
                                        </g>
                                      ))}
                                    </g>
                                  </>
                                );
                              })()}

                              {/* --- FOOTER: PROJECT SPECS --- */}
                              <g transform={`translate(60, ${H - 50})`}>
                                <text fill={COLORS.muted} fontFamily={MONO} fontSize={10}>
                                  <tspan fill={COLORS.deposit} fontWeight="bold">BUFFER:</tspan> Off-chain batching
                                  <tspan dx={20} fill={COLORS.proof} fontWeight="bold">PROOF:</tspan> Groth16 (BN254)
                                  <tspan dx={20} fill={COLORS.pool} fontWeight="bold">ASSET:</tspan> JitoSOL / mSOL
                                </text>
                              </g>
                            </motion.g>
                          )}
            </AnimatePresence>
          </svg>

          <AnimatePresence>
            {tooltip.visible && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.15 }}
                className="pointer-events-none absolute z-50 max-w-xs rounded-lg bg-[#111114] border border-white/[0.08] p-3 shadow-xl"
                style={{ left: tooltip.x + 15, top: tooltip.y + 15 }}>
                <div className="text-sm font-bold text-white">{tooltip.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-400">{tooltip.body}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
