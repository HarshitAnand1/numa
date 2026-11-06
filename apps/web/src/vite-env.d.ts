/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of apps/api. Defaults to "/api", which the dev server proxies to VITE_API_PROXY. */
  readonly VITE_API_URL?: string;
  /** "demo" forces clearly-labelled demo data and never calls the API. */
  readonly VITE_DATA_MODE?: "demo" | "live";
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
