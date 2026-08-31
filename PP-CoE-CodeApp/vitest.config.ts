import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Dedicated Vitest config. We deliberately do NOT load the @microsoft/power-apps
// Vite plugin here — that plugin injects connector bootstrap code that requires
// a real Power Apps host shell which we don't have in jsdom.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The @microsoft/power-apps ESM bundle has broken file-extension imports
      // that node can't resolve in a plain test environment. Tests never need
      // the real client — they should vi.mock() the generated services. These
      // aliases satisfy the import graph at load time.
      "@microsoft/power-apps/data/metadata/dataverse": path.resolve(
        __dirname,
        "src/test/stubs/power-apps-data-metadata-dataverse.ts",
      ),
      "@microsoft/power-apps/data": path.resolve(
        __dirname,
        "src/test/stubs/power-apps-data.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    maxWorkers: 4,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", "src/generated/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/generated/**",
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
      ],
    },
  },
});
