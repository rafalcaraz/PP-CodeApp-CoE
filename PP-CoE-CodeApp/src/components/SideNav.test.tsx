import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SideNav } from "./SideNav";

vi.mock("../featureFlags", () => ({ useFeatureFlag: () => false }));

function Location() {
  const { pathname } = useLocation();
  return <output aria-label="Current route">{pathname}</output>;
}

function renderNav(path = "/connector-playground") {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[path]}>
        <SideNav />
        <Location />
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe("SideNav playgrounds", () => {
  it("keeps dedicated Cost Controls separate from the API playground", () => {
    renderNav("/cost-controls/reporting");
    const header = screen.getByRole("button", { name: "Cost Controls" });
    const group = document.getElementById(header.getAttribute("aria-controls") ?? "");
    if (!group) throw new Error("Cost Controls navigation group is missing.");
    const reporting = within(group).getByRole("tab", { name: "Credit reporting" });
    const management = within(group).getByRole("tab", { name: "Policies & requests" });
    expect(reporting).toHaveAttribute("aria-selected", "true");
    expect(within(group).queryByRole("tab", { name: "Cost Management API" })).not.toBeInTheDocument();
    fireEvent.click(management);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/cost-controls/management");
    expect(management).toHaveAttribute("aria-selected", "true");
  });
  it("groups all playgrounds together and preserves their navigation", () => {
    renderNav();
    const header = screen.getByRole("button", { name: "Playgrounds" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    const groupId = header.getAttribute("aria-controls");
    if (!groupId) throw new Error("Playgrounds header must control a navigation group.");
    const group = document.getElementById(groupId);
    if (!group) throw new Error("Playgrounds navigation group is missing.");
    const connector = within(group).getByRole("tab", { name: "Connector playground" });
    const api = within(group).getByRole("tab", { name: "Power Platform API" });
    const cost = within(group).getByRole("tab", { name: "Cost Management API" });
    expect(connector).toHaveAttribute("aria-selected", "true");
    expect(within(group).queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();

    fireEvent.click(api);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/power-platform-api");
    expect(api).toHaveAttribute("aria-selected", "true");
    fireEvent.click(cost);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/cost-management-api");
    expect(cost).toHaveAttribute("aria-selected", "true");
    fireEvent.click(connector);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/connector-playground");
  });

  it("collapses and remembers the shared group without hiding Settings", () => {
    const { unmount } = renderNav();
    fireEvent.click(screen.getByRole("button", { name: "Playgrounds" }));
    expect(screen.getByRole("button", { name: "Playgrounds" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tab", { name: "Connector playground" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Power Platform API" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Cost Management API" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();

    unmount();
    renderNav();
    const header = screen.getByRole("button", { name: "Playgrounds" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header);
    expect(screen.getByRole("tab", { name: "Connector playground" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Power Platform API" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cost Management API" })).toBeInTheDocument();
  });
});
