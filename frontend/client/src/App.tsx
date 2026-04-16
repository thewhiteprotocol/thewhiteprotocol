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
import NeonCrystalCity from "@/components/ui/neon-crystal-city";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletContextProvider>
        <TooltipProvider>
          <NeonCrystalCity 
            cameraSpeed={1.5}
            tileSize={2.5}
            maxSteps={70}
            maxDist={70}
          />
          <div className="relative min-h-screen text-foreground">
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
