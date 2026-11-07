import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In dev the browser talks to /api and Vite forwards it to the Numa API (which has no CORS headers by default).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: { port: 5174, proxy: { "/api": { target: env.VITE_API_PROXY || "http://localhost:8787", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } } },
  };
});
