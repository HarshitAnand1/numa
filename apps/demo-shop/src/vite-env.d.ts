/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The shop's numa campaign id (a merchant has one campaign per product line). */
  readonly VITE_CAMPAIGN_ID?: string;
  /** NumaRouter / CampaignRegistry. Defaults to @numa/shared's recorded deployment. */
  readonly VITE_NUMA_ROUTER_ADDRESS?: string;
  readonly VITE_CAMPAIGN_REGISTRY_ADDRESS?: string;
  /** Base URL of numa's API (order + relay). Defaults to "/api" (Vite proxy in dev). */
  readonly VITE_API_URL?: string;
  /** Whitechain RPC for reads. */
  readonly VITE_RPC_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
