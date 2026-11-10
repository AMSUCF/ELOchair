import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.ELOCHAIR_API ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": api, "/healthz": api } },
  build: {
    outDir: "dist",
    sourcemap: true,
    // Never inline assets as data: URIs. The server's Content-Security-Policy allows fonts from
    // this origin only, and the smallest font subsets would otherwise be inlined and blocked.
    assetsInlineLimit: 0,
  },
});
