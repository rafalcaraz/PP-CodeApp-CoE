import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), powerApps()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        // Pull big third-party libs into their own long-lived cache chunks so
        // app-code changes don't bust the vendor caches (and vice-versa).
        // The route chunks Vite already emits via React.lazy() pick these up
        // automatically when they need a vendor.
        manualChunks: {
          // Keep the runtime cacheable, but let Vite split Fluent by actual
          // usage so route-only widgets don't all get fetched at startup.
          react: ["react", "react-dom/client"],
          // Recharts is only used inside the dashboards subtree but lives in
          // its own ~300 kB chunk regardless, so other routes don't pay for
          // it on first load.
          charts: ["recharts"],
          // React Router is small but shared by every route; isolating it
          // keeps caching predictable across releases.
          router: ["react-router-dom"],
        },
      },
    },
  },
});
