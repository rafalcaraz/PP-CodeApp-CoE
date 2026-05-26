/**
 * Stub for `@microsoft/power-apps/data` under Vitest/jsdom.
 *
 * The real package ships ESM with broken file extensions that node can't
 * resolve outside the Power Apps host runtime. We never want to hit the
 * live connector in tests anyway.
 *
 * The generated service classes call `getClient()` at module-load time
 * (static initializers), so we can't throw here — we'd block every test
 * that imports any module which transitively touches a service. Instead
 * we return a fake client whose methods reject loudly if invoked. Tests
 * that exercise a code path leading to a connector call must
 * `vi.mock("../../generated", () => ({ ... }))` to inject fake services.
 */
export type IOperationResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: { message: string } };

function deny(method: string): never {
  throw new Error(
    `[test-stub] @microsoft/power-apps client.${method}() called from a test. ` +
      "Mock the generated service with vi.mock() instead of relying on a real connector call.",
  );
}

export function getClient(): unknown {
  // Returns a Proxy so any method access throws a helpful error if invoked,
  // but evaluating typeof / static init code that just stores the reference
  // does not fail.
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        return () => deny(String(prop));
      },
    },
  );
}
