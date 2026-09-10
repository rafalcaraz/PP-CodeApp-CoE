import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

import { FilterBuilder } from "./FilterBuilder";
import type { CatalogGroup, DeepFilterClause } from "../data";

const CATALOG: CatalogGroup[] = [
  {
    label: "Behavior",
    entries: [
      {
        id: "cli",
        label: "CLI agent",
        path: "isCLIAgent",
        group: "Behavior",
        filter: { kind: "boolean" },
        origin: "curated",
        source: "copilot-agents-dataverse",
        addedIn: "2026-09-10",
      },
      {
        id: "model",
        label: "Model",
        path: "model",
        group: "Behavior",
        filter: { kind: "string" },
        origin: "curated",
        source: "copilot-agents-dataverse",
        addedIn: "2026-09-10",
      },
    ],
  },
];

function renderBuilder(
  filters: DeepFilterClause[],
  onChange = vi.fn(),
) {
  return {
    onChange,
    ...render(
      <FluentProvider theme={webLightTheme}>
        <FilterBuilder
          catalogGroups={CATALOG}
          filters={filters}
          onChange={onChange}
        />
      </FluentProvider>,
    ),
  };
}

describe("FilterBuilder", () => {
  it("shows the full property catalog when reopening a selected property", async () => {
    renderBuilder([{ path: "isCLIAgent", op: "eq", value: true }]);

    await userEvent.click(screen.getAllByRole("combobox")[0]);

    expect(
      await screen.findByRole("option", { name: "Model" }),
    ).toBeInTheDocument();
  });

  it("uses explicit True and False options for boolean values", async () => {
    const { onChange } = renderBuilder([
      { path: "isCLIAgent", op: "eq", value: true },
    ]);

    await userEvent.click(
      screen.getByRole("combobox", { name: "Boolean value" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "False" }));

    expect(onChange).toHaveBeenCalledWith([
      { path: "isCLIAgent", op: "eq", value: false },
    ]);
  });

  it("does not replace a selected path with its friendly label on blur", async () => {
    const { onChange } = renderBuilder([
      { path: "isCLIAgent", op: "eq", value: true },
    ]);

    await userEvent.click(screen.getAllByRole("combobox")[0]);
    await userEvent.click(await screen.findByRole("option", { name: "Model" }));

    expect(onChange).toHaveBeenLastCalledWith([
      { path: "model", op: "contains", value: "" },
    ]);
    expect(onChange).not.toHaveBeenCalledWith([
      expect.objectContaining({ path: "Model" }),
    ]);
  });
});
