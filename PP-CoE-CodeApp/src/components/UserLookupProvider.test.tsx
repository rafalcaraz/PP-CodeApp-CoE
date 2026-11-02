import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserLookupProvider } from "./UserLookupProvider";
import { useUserLookup } from "../hooks/useUserLookup";

const { dialogLoaded } = vi.hoisted(() => ({ dialogLoaded: vi.fn() }));

vi.mock("./UserLookupDialog", () => {
  dialogLoaded();
  return {
    UserLookupDialog: ({ initialGuid, onClose }: { initialGuid?: string; onClose: () => void }) => (
      <div role="dialog" aria-label="User lookup">
        <input aria-label="GUID" defaultValue={initialGuid} />
        <button onClick={onClose}>Close lookup</button>
      </div>
    ),
  };
});

function LookupTrigger() {
  const open = useUserLookup();
  return <button onClick={() => open("test-guid")}>Open lookup</button>;
}

describe("UserLookupProvider", () => {
  it("loads the dialog only on demand and resets its input when reopened", async () => {
    render(<UserLookupProvider><LookupTrigger /></UserLookupProvider>);
    expect(dialogLoaded).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open lookup" }));
    await screen.findByRole("dialog", { name: "User lookup" });
    expect(dialogLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("GUID")).toHaveValue("test-guid");
    fireEvent.change(screen.getByLabelText("GUID"), { target: { value: "edited-guid" } });
    fireEvent.click(screen.getByRole("button", { name: "Close lookup" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open lookup" }));
    await waitFor(() => expect(screen.getByLabelText("GUID")).toHaveValue("test-guid"));
    expect(dialogLoaded).toHaveBeenCalledTimes(1);
  });
});
