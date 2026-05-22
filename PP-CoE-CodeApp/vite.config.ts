import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), powerApps()],
  build: {
    // The fluent vendor chunk is intentionally ~650 kB — Fluent UI as a whole
    // doesn't shrink meaningfully without per-component imports we don't do.
    // Bump the warning past it so the build log only shouts when *something
    // new* breaks the budget.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Pull big third-party libs into their own long-lived cache chunks so
        // app-code changes don't bust the vendor caches (and vice-versa).
        // The route chunks Vite already emits via React.lazy() pick these up
        // automatically when they need a vendor.
        manualChunks: {
          // Fluent is the heaviest dependency by a wide margin (components +
          // icons together). Splitting it isolates the bulk of the bundle.
          fluent: ["@fluentui/react-components", "@fluentui/react-icons"],
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
