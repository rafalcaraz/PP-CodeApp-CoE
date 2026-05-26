/**
 * Smoke tests for ResourceRollupCard.
 *
 * Verifies the four user-visible states of the stat-grid card:
 *   1. Loading → spinner
 *   2. Error → ErrorPane with the connector message
 *   3. Ready + empty → EmptyPane with the configured message
 *   4. Ready + counts → one stat tile per ResourceCountRow with the
 *      humanized type label and the comma-formatted number
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

import {
  ResourceRollupCard,
  type ResourceRollupState,
} from "./ResourceRollupCard";
import { ResourceType } from "../../../data/inventory";

function wrap(state: ResourceRollupState, emptyMessage?: string) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <ResourceRollupCard state={state} emptyMessage={emptyMessage} />
    </FluentProvider>,
  );
}

describe("ResourceRollupCard", () => {
  it("renders a loading spinner while the rollup is in flight", () => {
    wrap({ kind: "loading" });
    expect(screen.getByText(/Loading resource counts/i)).toBeInTheDocument();
  });

  it("renders an error pane with the message on failure", () => {
    wrap({ kind: "error", message: "rate limited" });
    expect(
      screen.getByText(/Couldn't load resource roll-up/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/rate limited/i)).toBeInTheDocument();
  });

  it("renders the empty-state message when there are no counts", () => {
    wrap({ kind: "ready", rows: [] }, "Add envs first.");
    expect(screen.getByText("Add envs first.")).toBeInTheDocument();
  });

  it("renders a stat tile per row with humanized labels and grouped totals", () => {
    wrap({
      kind: "ready",
      rows: [
        { type: ResourceType.CanvasApp, count: 1234 },
        { type: ResourceType.CloudFlow, count: 17 },
        { type: ResourceType.CopilotStudioAgent, count: 2 },
      ],
    });
    // Counts come out comma-formatted via toLocaleString().
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // Friendly labels (sourced from friendlyResourceType).
    expect(screen.getByText(/Canvas apps/i)).toBeInTheDocument();
    expect(screen.getByText(/Cloud flows/i)).toBeInTheDocument();
    expect(screen.getByText(/Copilot Studio/i)).toBeInTheDocument();
  });
});
