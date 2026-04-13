import DepositWithdrawUI from "@/components/DepositWithdrawUI";

export function DepositWithdraw() {
  return (
    <section id="protocol" className="py-24 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-700 mb-4">
            Privacy Protocol
          </h2>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Shield your assets with zero-knowledge proofs on Solana
          </p>
        </div>
        
        <DepositWithdrawUI />
      </div>
    </section>
  );
}
