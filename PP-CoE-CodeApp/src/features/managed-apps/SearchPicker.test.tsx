import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { SearchPicker } from "./SearchPicker";

describe("searchable governance picker", () => {
  it("filters names and IDs, disambiguates duplicates and exposes no-match/clear states", async () => {
    const change = vi.fn();
    render(<FluentProvider theme={webLightTheme}><SearchPicker label="Synthetic group" value="" showIds onChange={change}
      options={[{ id: "one", name: "Same name" }, { id: "two", name: "Same name" }]} /></FluentProvider>);
    const picker = screen.getByRole("combobox", { name: "Synthetic group" });
    fireEvent.click(picker);
    fireEvent.change(picker, { target: { value: "TWO" } });
    expect(screen.queryByRole("option", { name: "Same name (one)" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: "Same name (two)" }));
    expect(change).toHaveBeenLastCalledWith("two");
    fireEvent.click(picker);
    fireEvent.change(picker, { target: { value: "missing" } });
    expect(await screen.findByRole("option", { name: "No matches" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Clear Synthetic group" }));
    expect(change).toHaveBeenLastCalledWith("");
  });
});
