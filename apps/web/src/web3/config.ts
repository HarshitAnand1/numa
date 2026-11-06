import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { DEPLOYED_ADDRESSES, WHITECHAIN_SEPOLIA_CHAIN_ID, USDT_ADDRESS, whitechainSepolia } from "@numa/shared";
import type { NumaConfig } from "@numa/sdk-react";
import { isAddress, type Address } from "viem";
import { API_BASE } from "../api/client";

/**
 * Wallet + chain configuration.
 * Only injected wallets (MetaMask, Rabby, Brave...) are supported: no third-party relay
 * service and no WalletConnect project id are needed, and nothing leaves the browser.
 */

export const CHAIN = whitechainSepolia;
export const CHAIN_ID = WHITECHAIN_SEPOLIA_CHAIN_ID;

const fromEnv = (v: string | undefined): Address | undefined => (v && isAddress(v) ? (v as Address) : undefined);

/** Router and registry: an explicit env override wins, else whatever Member 1 recorded in @numa/shared. */
export const ROUTER_ADDRESS: Address | undefined =
  fromEnv(import.meta.env.VITE_NUMA_ROUTER_ADDRESS) ?? DEPLOYED_ADDRESSES[CHAIN_ID]?.numaRouter;
export const REGISTRY_ADDRESS: Address | undefined =
  fromEnv(import.meta.env.VITE_CAMPAIGN_REGISTRY_ADDRESS) ?? DEPLOYED_ADDRESSES[CHAIN_ID]?.campaignRegistry;
export const TOKEN_ADDRESS: Address = DEPLOYED_ADDRESSES[CHAIN_ID]?.usdt ?? USDT_ADDRESS;

/** What @numa/sdk-react needs. Undefined until the contracts are deployed, so real checkout cannot start. */
export const NUMA_CONFIG: NumaConfig | undefined =
  ROUTER_ADDRESS && REGISTRY_ADDRESS
    ? {
        chainId: CHAIN_ID,
        router: ROUTER_ADDRESS,
        registry: REGISTRY_ADDRESS,
        token: TOKEN_ADDRESS,
        orderUrl: `${API_BASE}/orders`,
        relayUrl: `${API_BASE}/relay`,
      }
    : undefined;

/** True only when real, on-chain checkout can run. Until then the checkout is a labelled simulation. */
export const CONTRACTS_READY = Boolean(NUMA_CONFIG);

const rpc = import.meta.env.VITE_RPC_URL || CHAIN.rpcUrls.default.http[0];

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected()],
  transports: { [CHAIN.id]: http(rpc) },
});
