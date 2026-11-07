import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { whitechainSepolia } from "@numa/shared";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";

/**
 * wagmi config for Numa: Whitechain only, injected wallets only (MetaMask, Rabby, ...), so no
 * third-party relay and no WalletConnect project id are needed. Pass `rpcUrl` to read through your
 * own RPC; it defaults to the public testnet RPC.
 */
export function numaWagmiConfig(rpcUrl?: string) {
  return createConfig({
    chains: [whitechainSepolia],
    connectors: [injected()],
    transports: { [whitechainSepolia.id]: http(rpcUrl) },
  });
}

/** For apps that don't already use wagmi. Apps that do should keep their own provider. */
export function NumaProvider({ children, rpcUrl }: { children: ReactNode; rpcUrl?: string }) {
  const [shared] = useState(() => ({
    config: numaWagmiConfig(rpcUrl),
    client: new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  }));
  return (
    <WagmiProvider config={shared.config}>
      <QueryClientProvider client={shared.client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
