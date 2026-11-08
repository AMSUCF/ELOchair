import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.ELOCHAIR_API ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": api, "/healthz": api } },
  build: { outDir: "dist", sourcemap: true },
});
