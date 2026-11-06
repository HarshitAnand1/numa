import type { Address } from "viem";

/**
 * Everything a checkout needs to know about its environment. Nothing is read from globals or
 * environment variables, so the same package works in any app.
 */
export interface NumaConfig {
  /** Whitechain chain id (1874 on Sepolia) */
  chainId: number;
  /** NumaRouter: the buyer authorizes USDT to this address */
  router: Address;
  /** CampaignRegistry: the order is verified against it before the buyer signs */
  registry: Address;
  /** the USDT token */
  token: Address;
  /** merchant order endpoint (POST), returns the signed order */
  orderUrl: string;
  /** relayer endpoint (POST /relay) */
  relayUrl: string;
}
