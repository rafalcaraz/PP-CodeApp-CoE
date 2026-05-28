/**
 * React hooks for the owner-scan controller singleton.
 *
 * Two thin wrappers over `useSyncExternalStore` so components can
 * subscribe to either the progress snapshot or the result without
 * triggering the other on unrelated updates. Both share the
 * controller's single subscriber set — only the snapshot reader
 * differs — and React 18's tearing protection guarantees a consistent
 * read across concurrent renders.
 *
 * Snapshot identity is owned by the controller (`getProgress` /
 * `getResult` return the same reference until the value actually
 * changes), so the hooks don't need any closed-over memoization.
 */

import { useSyncExternalStore } from "react";

import {
  getProgress,
  getResult,
  subscribe,
} from "./ownerScanController";
import type { ScanProgress, ScanResult } from "./types";

export function useOwnerScanProgress(): ScanProgress {
  return useSyncExternalStore(subscribe, getProgress, getProgress);
}

export function useOwnerScanResult(): ScanResult | null {
  return useSyncExternalStore(subscribe, getResult, getResult);
}
