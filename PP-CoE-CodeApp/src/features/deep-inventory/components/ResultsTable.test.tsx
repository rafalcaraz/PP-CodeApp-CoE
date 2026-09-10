import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
