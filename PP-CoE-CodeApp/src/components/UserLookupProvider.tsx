/**
 * `UserLookupProvider` — app-wide context that lets any component open
 * the Cmd+K lookup dialog (pre-filled with a GUID) without prop drilling.
 *
 * Mounted once at the shell level (`App.tsx`). The provider owns the
 * dialog's open state, so `<UserChip>` (and anything else that wants
 * to surface the lookup) just calls `useUserLookup()(guid)` and the
 * dialog opens already populated with the value.
 *
 * The hook + context themselves live in `src/hooks/useUserLookup.ts` —
 * splitting them out keeps Vite's fast-refresh contract intact (this
 * file exports only a component).
 */

import { useCallback, useState, type ReactNode } from "react";
import { UserLookupDialog } from "./UserLookupDialog";
import { UserLookupContext, type OpenUserLookup } from "../hooks/useUserLookup";

export function UserLookupProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; guid?: string }>({
    open: false,
  });

  const open = useCallback<OpenUserLookup>((guid) => {
    setState({ open: true, guid });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ open: false, guid: prev.guid }));
  }, []);

  return (
    <UserLookupContext.Provider value={open}>
      {children}
      {/* Keyed remount on each open clears the dialog's internal state
          (input + result) without a setState-in-effect. */}
      <UserLookupDialog
        key={state.open ? `open-${state.guid ?? ""}` : "closed"}
        open={state.open}
        onClose={close}
        initialGuid={state.guid}
      />
    </UserLookupContext.Provider>
  );
}
