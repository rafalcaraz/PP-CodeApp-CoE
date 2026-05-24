/**
 * Hook + context for the global admin-access gate. Split from
 * `AdminAccessGate.tsx` so the gate file exports only components —
 * keeps Vite's fast-refresh happy
 * (`react-refresh/only-export-components`).
 *
 * The gate runs a preflight permission probe at boot so users without
 * the required Power Platform Administrator (or activated PIM) role
 * see one clear actionable pane instead of a wall of cascading 403
 * toasts. See `docs/roadmap.md` → "Admin access gate" for the design.
 */

import { createContext, useContext } from "react";
import type { ConnectorErrorKind } from "../data/inventory";

/** Discriminated union mirroring the gate's internal state machine.
 *  `granted` is the happy path; the four error variants each map to a
 *  dedicated pane. `loading` is the brief boot state while the probe
 *  is in flight. */
export type AdminAccessStatus =
  | { kind: "loading" }
  | { kind: "granted" }
  | { kind: "denied"; error: string }
  | { kind: "connection-broken"; error: string }
  | { kind: "transient"; error: string; attempt: number }
  | { kind: "error"; error: string; classification: ConnectorErrorKind };

export interface AdminAccessContextValue {
  status: AdminAccessStatus;
  /** Re-run the probe (with cache bypass). Intended for the
   *  `<NoAccessPane>` "Re-check access" button so users who just
   *  activated their PIM role don't have to reload the app. */
  recheck: () => void;
}

const defaultContext: AdminAccessContextValue = {
  status: { kind: "loading" },
  recheck: () => {},
};

export const AdminAccessContext =
  createContext<AdminAccessContextValue>(defaultContext);

/** Read the gate's current state from anywhere inside `<AdminAccessGate>`.
 *  Outside the provider tree this returns a permanently-loading stub,
 *  so callers that aren't behind the gate stay renderable in isolation. */
export function useAdminAccess(): AdminAccessContextValue {
  return useContext(AdminAccessContext);
}
