/**
 * Sources barrel. Exposes:
 *  - the public `DeepSource` registry (`SOURCES`), keyed by `DeepSourceId`
 *  - the source types module
 *
 * Adding a new source = add a new file under `sources/`, import it
 * here, and append to `SOURCES`. The runner / UI both pick the right
 * source by `DeepSourceId` lookup — no other code change needed.
 */

import type { DeepSourceId } from "../catalog/types";
import type { DeepSource } from "./types";
import { adminAppsSource } from "./adminApps";

export type { DeepSource, ScopeUnit, SourcePage } from "./types";

export const SOURCES: Record<DeepSourceId, DeepSource> = {
  "admin-apps": adminAppsSource,
};

/** Convenience accessor that throws when the id is unknown. Use this
 *  at the runner / UI boundary to fail loud on typos. */
export function getSource(id: DeepSourceId): DeepSource {
  const source = SOURCES[id];
  if (!source) {
    throw new Error(`Unknown deep-inventory source id: ${String(id)}`);
  }
  return source;
}
