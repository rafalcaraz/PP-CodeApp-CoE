import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router-dom";

import { ResultsTable } from "./ResultsTable";
import type { DeepScanRow } from "../data";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

const AGENT_ROW: DeepScanRow = {
  identity: {
    id: "agent-1",
    environmentId: "env-1",
    displayName: "Agent One",
    resourceType: "microsoft.copilotstudio/agents",
  },
  cells: { "capabilities.memoryEnabled": true },
  raw: {
    capabilities: { memoryEnabled: true },
    components: { records: [{ name: "Recurrence" }] },
  },
};

function renderTable() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <ResultsTable
          catalogGroups={[]}
          columns={["capabilities.memoryEnabled"]}
          defaultColumns={[]}
          rows={[AGENT_ROW]}
        />
        <LocationProbe />
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("ResultsTable", () => {
  beforeEach(() => localStorage.clear());
  it("adds a custom path from the raw scan result rather than the normalized cells", () => {
    renderTable();
    fireEvent.click(screen.getByText("Columns", { selector: "button" }));
    fireEvent.click(screen.getByText("Add custom column"));
    fireEvent.change(screen.getByLabelText("Custom property path"), { target: { value: "components.records.0.name" } });
    fireEvent.change(screen.getByLabelText("Custom column title"), { target: { value: "First component" } });
    fireEvent.click(screen.getByText("Add column", { selector: "button" }));
    fireEvent.click(screen.getByText("Done"));
    expect(screen.getByText("Recurrence")).toBeInTheDocument();
    expect(screen.getByLabelText("First component column options")).toBeInTheDocument();
  });
  it("routes Copilot Studio matches to the agent detail in the correct environment", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "Agent One" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/agents/agent-1?envId=env-1",
    );
  });

  it("shows normalized raw evidence for audit", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "View" }));

    expect(screen.getByText(/Scan evidence — Agent One/i)).toBeInTheDocument();
    expect(screen.getByText(/Normalized source evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/"memoryEnabled": true/)).toBeInTheDocument();
  });

  it("searches normalized evidence paths and values", async () => {
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: "View" }));

    await userEvent.type(
      await screen.findByRole("textbox", { name: "Search evidence" }),
      "memoryEnabled",
    );

    const results = screen.getByTestId("evidence-search-results");
    expect(results).toHaveTextContent("capabilities.memoryEnabled");
    expect(results).toHaveTextContent("true");
  });
  it("transforms incoming matches without losing evidence actions or storing records", async () => {
    const makeTable = (rows: DeepScanRow[], sourceId = "copilot-agents-dataverse") => <FluentProvider theme={webLightTheme}><MemoryRouter>
      <ResultsTable catalogGroups={[]} columns={["capabilities.memoryEnabled"]} defaultColumns={[]} rows={rows}
        sourceId={sourceId} scope="Scan ongoing — partial matches received so far." />
    </MemoryRouter></FluentProvider>;
    const view = render(makeTable([AGENT_ROW]));
    fireEvent.click(screen.getByRole("button", { name: "Name column options" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name filter value" }), { target: { value: "Two" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(screen.queryByRole("button", { name: "Agent One" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear column filters" })).toBeEnabled();
    const second = { ...AGENT_ROW, identity: { ...AGENT_ROW.identity, id: "agent-2", displayName: "Agent Two" } };
    view.rerender(makeTable([AGENT_ROW, second]));
    expect(screen.getByRole("button", { name: "Agent Two" })).toBeInTheDocument();
    expect(screen.getByText("1 matching / 2 loaded")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByText(/Scan evidence — Agent Two/)).toBeInTheDocument();
    const stored = localStorage.getItem("ppcoe.deep-inventory.results.v1:copilot-agents-dataverse");
    expect(stored).toContain("Two");
    expect(stored).not.toContain("agent-2");
    expect(stored).not.toContain("Recurrence");
    fireEvent.click(screen.getByText("Close"));
    view.rerender(makeTable([AGENT_ROW], "admin-apps"));
    expect(screen.getByRole("button", { name: "Agent One" })).toBeInTheDocument();
    view.rerender(makeTable([AGENT_ROW, second]));
    expect(screen.queryByRole("button", { name: "Agent One" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agent Two" })).toBeInTheDocument();
  });
});
