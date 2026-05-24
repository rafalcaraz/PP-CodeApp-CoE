/**
 * Vitest setup file — runs once before the test suite.
 *
 * - Extends `expect` with jest-dom matchers (`toBeInTheDocument`, etc.)
 * - Cleans up rendered React trees between tests
 * - Provides browser globals that jsdom doesn't ship with but Fluent / Recharts expect
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// Fluent UI v9 uses ResizeObserver in a couple of places (Popover positioning,
// DataGrid auto-sizing). jsdom doesn't implement it. A no-op stub is enough.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Same story for matchMedia — Fluent's responsive utilities probe it.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
