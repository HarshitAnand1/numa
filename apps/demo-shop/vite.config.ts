import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5174,
      // The shop's "order endpoint" is numa's demo /orders route; in dev the browser reaches it
      // (and /relay) through this proxy, so no CORS is needed.
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY || "http://localhost:8787",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
  };
});
