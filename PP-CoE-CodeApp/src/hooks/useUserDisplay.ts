/**
 * `useUserDisplay` — React hook for live owner/createdBy chips.
 *
 * Mounts a single subscription against the cache in
 * `src/data/userEnrichment.ts`. The hook is the canonical way for
 * components to consume the resolver — it handles:
 *
 *   1. **Synchronous first paint** from the cache via `peekUser`. If the
 *      GUID was already resolved by another chip, the lookup dialog, or
 *      a sibling component, no spinner, no flicker.
 *   2. **Auto-fetch** for unknown GUIDs via fire-and-forget `resolveUser`.
 *      The promise's resolution path doesn't drive the re-render — the
 *      subscription does. Microtask batching collapses many chips
 *      mounted in the same tick into one OData call.
 *   3. **Live re-render** when the GUID resolves anywhere in the app.
 *      Open the Cmd+K dialog, resolve a GUID that's currently rendered
 *      in a column, close — the column lights up automatically.
 *
 * Uses `useSyncExternalStore` (React 18+) for tear-free subscription
 * semantics with concurrent rendering.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  peekUser,
  subscribeUser,
  type UserCacheEntry,
} from "../data/userEnrichment";

/**
 * Subscribe a component to live cache state for a single GUID. **Pure
 * read** — never triggers a network call.
 *
 * This is the reactive surface for `<UserChip>` (and any other consumer
 * that wants to render an owner GUID). When the dialog (Ctrl+K) — or
 * any other explicitly user-initiated lookup — resolves a GUID,
 * subscribers for that GUID re-render with the resolved value
 * immediately, no extra fetch.
 *
 * **Why no auto-fetch?** Owner / createdBy GUIDs on inventory rows are
 * frequently service principals (Pipelines deployment identities) and
 * deleted users — both return "not found" against `aaduser`. Auto-
 * resolving every GUID a list view renders would burn a `retrieveRecord`
 * call per row and surface mostly "Could not locate" results — wasteful
 * and visually noisy. Instead, chips render the raw short-GUID by
 * default; clicking one opens the Cmd+K dialog (which IS allowed to
 * call the network) pre-filled so the user can resolve on demand.
 *
 * Snapshot identity is owned by the data layer (`peekUser` returns the
 * same `UserCacheEntry` object reference for the same state), so this
 * hook needs no closed-over snapshot caches — `useSyncExternalStore`
 * receives a referentially stable value out of the box.
 */
export function useUserDisplay(id: string | undefined | null): UserCacheEntry {
  const subscribe = useCallback(
    (cb: () => void): (() => void) => subscribeUser(id, cb),
    [id]
  );
  const getSnapshot = useCallback((): UserCacheEntry => peekUser(id), [id]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
