import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The dev server needs inline scripts for hot reload, which the app's strict policy blocks.
const relaxPolicyInDev: Plugin = {
  name: "relax-csp-in-dev",
  apply: "serve",
  transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, ""),
};

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), relaxPolicyInDev],
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { port: 5183, strictPort: true },
});
