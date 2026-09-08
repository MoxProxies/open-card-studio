import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Standalone app build — served on its own (e.g. studio.moxproxies.com)
 * for direct, full-page use of the editor.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    // Vite's DNS-rebinding protection blocks any Host header it doesn't
    // recognize; a leading "." matches the domain and every subdomain, so
    // this covers ngrok's free-tier tunnel domains for LAN/phone testing.
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev"],
  },
  build: {
    outDir: "dist/app",
  },
});
