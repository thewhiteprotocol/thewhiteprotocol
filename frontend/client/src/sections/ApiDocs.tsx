import { useState } from "react";
import { Code, ChevronDown, ChevronRight, Server, Database, Shield, Zap } from "lucide-react";

const API_BASE = "https://api.thewhiteprotocol.org";

const apiEndpoints = [
  {
    category: "Health & Status",
    icon: Server,
    endpoints: [
      {
        method: "GET",
        path: "/health",
        description: "Health check endpoint",
        response: `{ "status": "ok", "timestamp": 1706500000000 }`
      },
      {
        method: "GET",
        path: "/api/pool-state",
        description: "Get current pool state including Merkle tree and pending deposits",
        response: `{
  "merkle": {
    "nextLeafIndex": 6,
    "root": "2735742367...",
    "treeDepth": 20
  },
  "pending": {
    "count": 0,
    "commitmentsHex": []
  }
}`
      }
    ]
  },
  {
    category: "Deposit Operations",
    icon: Database,
    endpoints: [
      {
        method: "POST",
        path: "/api/generate-commitment",
        description: "Generate a deposit commitment from amount and asset",
        request: `{
  "amount": "100000000",
  "assetMint": "So11111111111111111111111111111111111111112"
}`,
        response: `{
  "commitment": "12350380732719438...",
  "secret": "...",
  "nullifier": "...",
  "note": { ... }
}`
      },
      {
        method: "POST",
        path: "/api/build-deposit-tx",
        description: "Build a deposit transaction for signing",
        request: `{
  "depositor": "YourWalletPubkey...",
  "amount": "100000000",
  "commitment": "12350380732719438..."
}`,
        response: `{
  "transaction": "base64EncodedTx...",
  "blockhash": "..."
}`
      },
      {
        method: "GET",
        path: "/api/check-commitment-status",
        description: "Check if a commitment has been settled",
        request: "?commitment=12350380732719438...",
        response: `{
  "status": "settled",
  "leafIndex": 2
}`
      }
    ]
  },
  {
    category: "Withdraw Operations",
    icon: Shield,
    endpoints: [
      {
        method: "POST",
        path: "/api/withdraw-proof",
        description: "Generate a ZK proof for withdrawal",
        request: `{
  "note": { "secret": "...", "nullifier": "...", ... },
  "recipient": "RecipientPubkey...",
  "leafIndex": 2
}`,
        response: `{
  "proof": "base64EncodedProof...",
  "publicSignals": [...]
}`
      },
      {
        method: "POST",
        path: "/api/withdraw",
        description: "Execute withdrawal with ZK proof",
        request: `{
  "proof": "...",
  "publicSignals": [...],
  "recipient": "RecipientPubkey...",
  "nullifierHash": "..."
}`,
        response: `{
  "success": true,
  "signature": "txSignature..."
}`
      }
    ]
  },
  {
    category: "Utilities",
    icon: Zap,
    endpoints: [
      {
        method: "POST",
        path: "/api/compute-asset-id",
        description: "Compute asset ID from mint address",
        request: `{ "mint": "So11111111111111111111111111111111111111112" }`,
        response: `{ "assetId": "..." }`
      },
      {
        method: "POST",
        path: "/api/pubkey-to-scalar",
        description: "Convert public key to BN254 scalar for circuit",
        request: `{ "pubkey": "YourPubkey..." }`,
        response: `{ "scalar": "123456789..." }`
      }
    ]
  }
];

export function ApiDocs() {
  const [openCategory, setOpenCategory] = useState<number | null>(0);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const copyToClipboard = (text: string, path: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <section id="api" className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-700 mb-4">
            API Reference <span className="ml-2 px-2 py-1 text-xs font-bold bg-amber-100 text-amber-700 rounded">BETA</span>
          </h2>
          <p className="text-lg text-slate-500 mb-4">
            RESTful API for The White Protocol Protocol operations. Note: Currently supports full withdrawals only (no partial).
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]">
            <Code size={16} className="text-slate-500" />
            <code className="text-sm text-slate-600 font-mono">{API_BASE}</code>
          </div>
        </div>

        <div className="space-y-4">
          {apiEndpoints.map((category, catIndex) => (
            <div
              key={category.category}
              className="bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff] overflow-hidden"
            >
              <button
                onClick={() => setOpenCategory(openCategory === catIndex ? null : catIndex)}
                className="w-full p-6 flex items-center gap-4 text-left hover:bg-[#E0E5EC]/80 transition-colors"
              >
                <div className={`p-3 bg-[#E0E5EC] rounded-xl transition-all ${
                  openCategory === catIndex 
                    ? "shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]" 
                    : "shadow-[4px_4px_8px_#b8b9be,-4px_-4px_8px_#ffffff]"
                }`}>
                  <category.icon className={`h-5 w-5 ${openCategory === catIndex ? "text-blue-500" : "text-slate-500"}`} />
                </div>
                <span className={`flex-1 font-bold ${openCategory === catIndex ? "text-blue-500" : "text-slate-700"}`}>
                  {category.category}
                </span>
                <span className="text-xs text-slate-400 mr-2">{category.endpoints.length} endpoints</span>
                {openCategory === catIndex ? (
                  <ChevronDown className="h-5 w-5 text-blue-500" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-slate-400" />
                )}
              </button>

              {openCategory === catIndex && (
                <div className="px-6 pb-6 space-y-4">
                  {category.endpoints.map((endpoint) => (
                    <div
                      key={endpoint.path}
                      className="p-4 bg-[#E0E5EC] rounded-xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          endpoint.method === "GET" 
                            ? "bg-emerald-100 text-emerald-700" 
                            : "bg-blue-100 text-blue-700"
                        }`}>
                          {endpoint.method}
                        </span>
                        <code 
                          className="text-sm font-mono text-slate-700 cursor-pointer hover:text-blue-500"
                          onClick={() => copyToClipboard(API_BASE + endpoint.path, endpoint.path)}
                          title="Click to copy full URL"
                        >
                          {endpoint.path}
                          {copiedPath === endpoint.path && (
                            <span className="ml-2 text-xs text-emerald-500">Copied!</span>
                          )}
                        </code>
                      </div>
                      <p className="text-sm text-slate-600 mb-3">{endpoint.description}</p>
                      
                      {endpoint.request && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-400 font-bold uppercase mb-1">Request</p>
                          <pre className="text-xs bg-slate-800 text-emerald-400 p-3 rounded-lg overflow-x-auto">
                            {endpoint.request}
                          </pre>
                        </div>
                      )}
                      
                      <div>
                        <p className="text-xs text-slate-400 font-bold uppercase mb-1">Response</p>
                        <pre className="text-xs bg-slate-800 text-emerald-400 p-3 rounded-lg overflow-x-auto">
                          {endpoint.response}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Pool Configuration */}
        <div className="mt-12 p-6 bg-[#E0E5EC] rounded-2xl shadow-[8px_8px_16px_#b8b9be,-8px_-8px_16px_#ffffff]">
          <h3 className="text-lg font-bold text-slate-700 mb-4">Current Pool Configuration (Devnet)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff]">
              <p className="text-xs text-slate-400 font-bold uppercase">Program ID</p>
              <code className="text-xs text-slate-600 break-all">BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb</code>
            </div>
            <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff]">
              <p className="text-xs text-slate-400 font-bold uppercase">Pool Config</p>
              <code className="text-xs text-slate-600 break-all">uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc</code>
            </div>
            <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff]">
              <p className="text-xs text-slate-400 font-bold uppercase">Merkle Tree</p>
              <code className="text-xs text-slate-600 break-all">DR3C2PRhgtcgZDiaAtKGHMK2Z3AZr1QUAHNCeLmJ37W4</code>
            </div>
            <div className="p-3 bg-[#E0E5EC] rounded-xl shadow-[inset_2px_2px_4px_#b8b9be,inset_-2px_-2px_4px_#ffffff]">
              <p className="text-xs text-slate-400 font-bold uppercase">Network</p>
              <code className="text-xs text-slate-600">Solana Devnet</code>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
