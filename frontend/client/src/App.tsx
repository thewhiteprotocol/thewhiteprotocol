import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletContextProvider } from "@/components/WalletContextProvider";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/sections/Hero";
import { ForBusiness } from "@/sections/ForBusiness";
import { ProtocolFlow } from "@/sections/ProtocolFlow";
import { Architecture } from "@/sections/Architecture";
import { Docs } from "@/sections/Docs";
import { Relayer } from "@/sections/Relayer";
import { DevnetStatus } from "@/sections/DevnetStatus";
import { Links } from "@/sections/Links";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletContextProvider>
        <TooltipProvider>
          <div className="relative min-h-screen text-foreground bg-[#0a0a0c]">
            <Navbar />
            <main>
              <Hero />
              <ForBusiness />
              <ProtocolFlow />
              <Architecture />
              <Docs />
              <Relayer />
              <DevnetStatus />
              <Links />
            </main>
          </div>
          <Toaster />
        </TooltipProvider>
      </WalletContextProvider>
    </QueryClientProvider>
  );
}

export default App;
