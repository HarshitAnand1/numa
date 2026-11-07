/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of apps/api. Defaults to "/api", which the dev server proxies to VITE_API_PROXY. */
  readonly VITE_API_URL?: string;
  /** "demo" forces clearly-labelled demo data and never calls the API. */
  readonly VITE_DATA_MODE?: "demo" | "live";
  /** NumaRouter / CampaignRegistry addresses. Override @numa/shared's recorded deployment. */
  readonly VITE_NUMA_ROUTER_ADDRESS?: string;
  readonly VITE_CAMPAIGN_REGISTRY_ADDRESS?: string;
  /** Whitechain RPC for reads (defaults to the public testnet RPC). */
  readonly VITE_RPC_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
