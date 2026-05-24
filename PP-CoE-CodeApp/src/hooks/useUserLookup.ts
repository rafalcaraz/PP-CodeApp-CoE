/**
 * Hook + context for the global user-lookup dialog. Split from
 * `UserLookupProvider.tsx` so the provider file exports only a
 * component — keeps Vite's fast-refresh happy
 * (`react-refresh/only-export-components`).
 */

import { createContext, useContext } from "react";

/** Opens the lookup dialog. Pass a GUID to pre-fill the input. */
export type OpenUserLookup = (guid?: string) => void;

const noop: OpenUserLookup = () => {};

export const UserLookupContext = createContext<OpenUserLookup>(noop);

/** Returns the `openUserLookup` function. Pre-fill is optional.
 *  Outside the provider tree this returns a no-op — components stay
 *  renderable in isolation (Storybook, tests). */
export function useUserLookup(): OpenUserLookup {
  return useContext(UserLookupContext);
}
