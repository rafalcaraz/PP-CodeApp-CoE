/**
 * Smoke test for the env-group Duplicator view.
 *
 * Mocks the data layers and asserts:
 *   1. Renders the source-group picker + auto-loaded rulesets summary.
 *   2. Duplicate stays disabled until source + name are set.
 *   3. Clicking duplicate calls `duplicateEnvironmentGroup` with the
 *      expected input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { EnvironmentGroupRow } from "../../data/inventory";

const {
  GROUP_A,
  duplicateMock,
  listGroupsMock,
  getRulesetsMock,
} = vi.hoisted(() => {
  const GROUP_A: EnvironmentGroupRow = {
    id: "group-a-guid",
    displayName: "Contoso Production",
    description: "Prod envs only",
    createdAt: "",
    createdBy: "",
    location: "",
  };
  return {
    GROUP_A,
    duplicateMock: vi.fn(),
    listGroupsMock: vi.fn(),
    getRulesetsMock: vi.fn(),
  };
});

vi.mock("../../data/inventory", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/inventory")
  >("../../data/inventory");
  return {
    ...actual,
    listEnvironmentGroups: listGroupsMock,
  };
});

vi.mock("../../data/adminEnrichment", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/adminEnrichment")
  >("../../data/adminEnrichment");
  return {
    ...actual,
    getEnvironmentGroupRulesets: getRulesetsMock,
  };
});

vi.mock("../../data/envGroupDuplicator", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/envGroupDuplicator")
  >("../../data/envGroupDuplicator");
  return {
    ...actual,
    duplicateEnvironmentGroup: duplicateMock,
  };
});

import { EnvGroupDuplicator } from "./EnvGroupDuplicator";

function renderView() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <EnvGroupDuplicator />
    </FluentProvider>,
  );
}

describe("EnvGroupDuplicator smoke", () => {
  beforeEach(() => {
    listGroupsMock.mockReset();
    getRulesetsMock.mockReset();
    duplicateMock.mockReset();
    listGroupsMock.mockResolvedValue({ ok: true, data: [GROUP_A] });
    getRulesetsMock.mockResolvedValue({
      ok: true,
      data: {
        matching: { value: [{ id: "rs-1", parameters: [] }] },
        all: { value: [{ id: "rs-1", parameters: [] }] },
        totalInTenant: 1,
        raw: {},
      },
    });
    duplicateMock.mockResolvedValue({
      ok: true,
      data: {
        newGroup: { id: "new-grp", displayName: "Copy of Contoso Production" },
        rulesets: [
          { sourceRuleSetId: "rs-1", newRuleSetId: "new-rs-1", ok: true },
        ],
      },
    });
  });

  it("renders the source-group picker from the mocked inventory layer", async () => {
    renderView();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Choose a group to duplicate…"),
      ).toBeInTheDocument();
    });
  });

  it("keeps Duplicate disabled until source + name are set", async () => {
    renderView();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Choose a group to duplicate…"),
      ).toBeInTheDocument();
    });
    const btn = screen.getByRole("button", { name: /duplicate group/i });
    expect(btn).toBeDisabled();
  });

  it("calls duplicateEnvironmentGroup with the right input on submit", async () => {
    renderView();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Choose a group to duplicate…"),
      ).toBeInTheDocument();
    });

    // Pick the source group.
    const combo = screen.getByPlaceholderText("Choose a group to duplicate…");
    fireEvent.click(combo);
    const option = await screen.findByRole("option", {
      name: /Contoso Production/,
    });
    fireEvent.click(option);

    // Auto-prefilled name should appear; wait for it.
    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Copy of Contoso Production"),
      ).toBeInTheDocument();
    });

    const btn = screen.getByRole("button", { name: /duplicate group/i });
    await waitFor(() => expect(btn).toBeEnabled());

    fireEvent.click(btn);
    await waitFor(() => expect(duplicateMock).toHaveBeenCalledTimes(1));
    const arg = duplicateMock.mock.calls[0][0];
    expect(arg.sourceGroupId).toBe(GROUP_A.id);
    expect(arg.displayName).toBe("Copy of Contoso Production");
  });
});
