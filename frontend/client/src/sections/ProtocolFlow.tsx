import ProtocolFlowVisualizer from "@/components/ProtocolFlowVisualizer";

export function ProtocolFlow() {
  return (
    <section id="protocol-flow" className="relative py-24 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            How The White Protocol Works
          </h2>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
            Interactive visualization of our multi-chain shielded pool privacy protocol.
          </p>
        </div>
        <ProtocolFlowVisualizer />
        <div className="mt-8 text-center">
          <div className="inline-block p-4 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <p className="text-sm text-zinc-400">
              Click the buttons above to see the deposit and withdrawal flows in action.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
