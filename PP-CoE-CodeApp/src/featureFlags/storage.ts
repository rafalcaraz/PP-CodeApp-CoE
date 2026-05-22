// ---------------------------------------------------------------------------
// Feature-flag persistence layer.
//
// Single source of truth for *where* flag values come from. Today: local
// storage. Tomorrow: real environment variables (probably surfaced via a
// Power Platform Dataverse environment-variable lookup or a build-time
// `import.meta.env.VITE_*` value once the team picks an approach).
//
// All consumers go through this module so the swap is contained — the
// React context provider, hooks, and Settings UI never touch storage
// directly.
//
// TODO(env-vars): When code apps grow a documented runtime-env API, layer
// it on top of these functions:
//   1. `readFlag` should consult env first, fall back to localStorage so
//      a user can still toggle locally for dev.
//   2. `writeFlag` should remain localStorage-only (env vars are
//      operator-controlled, not user-controlled).
//   3. The Settings page should display a "Locked by environment" badge
//      and disable the toggle when the env override is present.
// ---------------------------------------------------------------------------

import type { FeatureFlagKey } from "./types";

const STORAGE_PREFIX = "ppcoe.featureFlag.";

export function getStorageKey(key: FeatureFlagKey): string {
  return STORAGE_PREFIX + key;
}

export function readFlag(key: FeatureFlagKey, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(getStorageKey(key));
    if (raw === null) return defaultValue;
    return raw === "true";
  } catch {
    // localStorage can throw in private-browsing / quota scenarios.
    return defaultValue;
  }
}

export function writeFlag(key: FeatureFlagKey, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getStorageKey(key), String(value));
  } catch {
    // Swallow — see readFlag().
  }
}
