import ProtocolFlowVisualizer from "@/components/ProtocolFlowVisualizer";

export function ProtocolFlow() {
  return (
    <section id="protocol-flow" className="relative py-20 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-700 mb-4">
            How The White Protocol v2 Works
          </h2>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Interactive visualization of our Multi-Asset Shielded Pool privacy protocol
          </p>
        </div>
        <ProtocolFlowVisualizer />
        <div className="mt-8 text-center">
          <div className="inline-block p-4 bg-[#E0E5EC] rounded-2xl shadow-[inset_4px_4px_8px_#b8b9be,inset_-4px_-4px_8px_#ffffff]">
            <p className="text-sm text-slate-500">
              Click "Start Deposit" or "Start Withdrawal" to see the flow in action. Hover over components for details.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
