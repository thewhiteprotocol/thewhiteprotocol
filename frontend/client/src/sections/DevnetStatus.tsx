import { useWallet } from "@solana/wallet-adapter-react";
import { Globe, Cpu, Code, ExternalLink, CheckCircle, Wallet } from "lucide-react";
import { DEVNET_CONFIG } from "@/config";

export function DevnetStatus() {
  const { connected } = useWallet();

  return (
    <section id="devnet" className="py-24 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-700 mb-4">Devnet Deployment</h2>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">The White Protocol v2 is live on Solana devnet for testing</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="p-6 bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff]">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]"><Globe className="h-5 w-5 text-blue-500" /></div>
              <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Network</p><div className="flex items-center gap-2 mt-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-sm font-bold text-slate-700">Solana Devnet</span></div></div>
            </div>
          </div>
          <div className="p-6 bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff]">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]"><Cpu className="h-5 w-5 text-blue-500" /></div>
              <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Program</p><div className="flex items-center gap-2 mt-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-sm font-bold text-slate-700">Deployed</span></div></div>
            </div>
          </div>
          <div className="p-6 bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff]">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]"><Wallet className="h-5 w-5 text-blue-500" /></div>
              <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Wallet</p><div className="flex items-center gap-2 mt-1"><div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-slate-400"}`}></div><span className="text-sm font-bold text-slate-700">{connected ? "Connected" : "Not Connected"}</span></div></div>
            </div>
          </div>
        </div>

        <div className="bg-[#E0E5EC] rounded-[2rem] p-8 shadow-[12px_12px_24px_#b8b9be,-12px_-12px_24px_#ffffff] mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]"><Code className="h-5 w-5 text-blue-500" /></div>
            <h3 className="text-xl font-bold text-slate-700">Program Deployment</h3>
          </div>
          <div className="space-y-4">
            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">RPC Endpoint</p><div className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] overflow-x-auto"><code className="text-sm font-mono text-slate-600">{DEVNET_CONFIG.RPC_URL}</code></div></div>
            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Program ID</p><div className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] overflow-x-auto"><code className="text-sm font-mono text-slate-600">{DEVNET_CONFIG.PROGRAM_ID}</code></div></div>
            <div><p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Pool Config</p><div className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] overflow-x-auto"><code className="text-sm font-mono text-slate-600">{DEVNET_CONFIG.POOL_CONFIG}</code></div></div>
          </div>
          <a href={DEVNET_CONFIG.EXPLORER_URL} target="_blank" rel="noopener noreferrer" className="mt-6 w-full px-6 py-4 bg-[#E0E5EC] rounded-xl shadow-[6px_6px_12px_#b8b9be,-6px_-6px_12px_#ffffff] hover:shadow-[3px_3px_6px_#b8b9be,-3px_-3px_6px_#ffffff] active:shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] transition-all flex items-center justify-center gap-2 text-slate-600 font-bold"><ExternalLink size={16} /> View on Solana Explorer</a>
        </div>

        <div className="bg-[#E0E5EC] rounded-[2rem] p-8 shadow-[12px_12px_24px_#b8b9be,-12px_-12px_24px_#ffffff]">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]"><CheckCircle className="h-5 w-5 text-emerald-500" /></div>
            <h3 className="text-xl font-bold text-slate-700">Zero-Knowledge Circuits</h3>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] text-center"><p className="text-2xl font-bold text-emerald-500">3</p><p className="text-xs text-slate-400 font-bold uppercase mt-1">Circuits</p></div>
            <div className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] text-center"><p className="text-2xl font-bold text-emerald-500">466,858</p><p className="text-xs text-slate-400 font-bold uppercase mt-1">Max Constraints</p></div>
            <div className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff] text-center"><p className="text-2xl font-bold text-emerald-500">72</p><p className="text-xs text-slate-400 font-bold uppercase mt-1">Test Vectors</p></div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 bg-[#E0E5EC] rounded-xl shadow-[4px_4px_8px_#b8b9be,-4px_-4px_8px_#ffffff]"><span className="text-sm text-slate-600">Deposit Circuit</span><span className="px-3 py-1 bg-[#E0E5EC] rounded-lg shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff] text-xs font-bold text-emerald-500">807 constraints</span></div>
            <div className="flex items-center justify-between p-4 bg-[#E0E5EC] rounded-xl shadow-[4px_4px_8px_#b8b9be,-4px_-4px_8px_#ffffff]"><span className="text-sm text-slate-600">Withdraw Circuit</span><span className="px-3 py-1 bg-[#E0E5EC] rounded-lg shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff] text-xs font-bold text-emerald-500">12,330 constraints</span></div>
            <div className="flex items-center justify-between p-4 bg-[#E0E5EC] rounded-xl shadow-[4px_4px_8px_#b8b9be,-4px_-4px_8px_#ffffff]"><span className="text-sm text-slate-600">Membership Circuit</span><span className="px-3 py-1 bg-[#E0E5EC] rounded-lg shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff] text-xs font-bold text-emerald-500">11,807 constraints</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}