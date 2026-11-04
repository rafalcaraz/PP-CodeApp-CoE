import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { UserCacheEntry } from "../data/userEnrichment";
import { UserLookupContext } from "../hooks/useUserLookup";
import { UserChip } from "./UserChip";

const cache = vi.hoisted(() => ({
  entry: { status: "unknown" } as UserCacheEntry,
  subscribers: new Set<() => void>(), resolve: vi.fn(),
}));
vi.mock("../data/userEnrichment", () => ({
  peekUser: () => cache.entry,
  subscribeUser: (_id: string, callback: () => void) => {
    cache.subscribers.add(callback); return () => { cache.subscribers.delete(callback); };
  },
  resolveUser: cache.resolve,
}));
const guid = "11111111-2222-4333-8444-555555555555";
beforeEach(() => {
  cache.entry = { status: "unknown" };
  cache.resolve.mockClear();
});
function update(entry: UserCacheEntry) {
  act(() => { cache.entry = entry; cache.subscribers.forEach((notify) => notify()); });
}
describe("UserChip full creator identity", () => {
  it("shows a complete clickable GUID before lookup and keeps it beside the name after resolution without automatic requests", () => {
    const open = vi.fn();
    render(<FluentProvider theme={webLightTheme}><UserLookupContext.Provider value={open}>
      <UserChip id={guid} showFullId avatarSize={0} />
    </UserLookupContext.Provider></FluentProvider>);
    expect(screen.getByText(guid)).toBeVisible();
    expect(screen.queryByText(/Unresolved|Unknown identity/)).not.toBeInTheDocument();
    expect(cache.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Click to look up ${guid}` }));
    expect(open).toHaveBeenCalledExactlyOnceWith(guid);
    update({ status: "resolved", user: { id: guid, displayName: "Synthetic creator" } });
    expect(screen.getByText("Synthetic creator")).toBeVisible();
    expect(screen.getByText(guid)).toBeVisible();
    expect(cache.resolve).not.toHaveBeenCalled();
  });
  it("retains a full GUID after a missing-user result and distinguishes missing identity metadata", () => {
    const { rerender } = render(<FluentProvider theme={webLightTheme}><UserChip id={guid} showFullId /></FluentProvider>);
    update({ status: "missing" });
    expect(screen.getByText(guid)).toBeVisible();
    expect(screen.getByText("No current user found")).toBeVisible();
    expect(screen.getByRole("button")).toHaveAccessibleName(/deleted user account or an Enterprise Application/);
    rerender(<FluentProvider theme={webLightTheme}><UserChip id="" showFullId fallback="Creator ID unavailable" /></FluentProvider>);
    expect(screen.getByText("Creator ID unavailable")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("keeps an inline name plus full identity while awaiting lookup and leaves incumbent compact chips unchanged", () => {
    const { rerender } = render(<FluentProvider theme={webLightTheme}>
      <UserChip id={guid} showFullId displayName="Inventory name" />
    </FluentProvider>);
    expect(screen.getByText("Inventory name")).toBeVisible();
    expect(screen.getByText(guid)).toBeVisible();
    rerender(<FluentProvider theme={webLightTheme}><UserChip id={guid} /></FluentProvider>);
    expect(screen.queryByText(guid)).not.toBeInTheDocument();
    expect(screen.getByText(guid.slice(-8))).toBeVisible();
  });
});
