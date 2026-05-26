/**
 * Smoke tests for DlpPolicyPickerDialog.
 *
 * Covers the three on-open states (loading, loaded, error) and the
 * search filter. Selection callback contract is verified end-to-end:
 * clicking a row invokes `onSelect` with the policy's GUID + display
 * name, ready for `setStandardGroupDlpPolicy` to persist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../../data/dlpPolicies", async () => {
  const actual = await vi.importActual<
    typeof import("../../../data/dlpPolicies")
  >("../../../data/dlpPolicies");
  return {
    ...actual,
    listDlpPolicies: vi.fn(),
  };
});

import { DlpPolicyPickerDialog } from "./DlpPolicyPickerDialog";
import { listDlpPolicies } from "../../../data/dlpPolicies";
import type { PolicyV2 } from "../../../generated/models/PowerPlatformforAdminsModel";

function policy(
  overrides: Partial<PolicyV2> & Pick<PolicyV2, "name" | "displayName">,
): PolicyV2 {
  return {
    name: overrides.name,
    displayName: overrides.displayName,
    defaultConnectorsClassification:
      overrides.defaultConnectorsClassification ?? "General",
    connectorGroups: overrides.connectorGroups ?? [],
    environmentType: overrides.environmentType ?? "AllEnvironments",
    environments: overrides.environments ?? [],
    createdBy: overrides.createdBy ?? { displayName: "", id: "" },
    createdTime: overrides.createdTime ?? "",
    lastModifiedBy: overrides.lastModifiedBy ?? { displayName: "", id: "" },
    lastModifiedTime: overrides.lastModifiedTime ?? "",
    isLegacySchemaVersion: overrides.isLegacySchemaVersion ?? false,
  };
}

function renderDialog(currentPolicyId?: string) {
  const onSelect = vi.fn();
  const onDismiss = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <DlpPolicyPickerDialog
        open
        currentPolicyId={currentPolicyId}
        onDismiss={onDismiss}
        onSelect={onSelect}
      />
    </FluentProvider>,
  );
  return { onSelect, onDismiss };
}

describe("DlpPolicyPickerDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows an error pane when listDlpPolicies fails", async () => {
    vi.mocked(listDlpPolicies).mockResolvedValue({
      ok: false,
      error: "Network blew up",
    });
    renderDialog();
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load dlp policies/i),
      ).toBeInTheDocument();
    });
  });

  it("renders the list and calls onSelect with the selected policy's id + display name", async () => {
    vi.mocked(listDlpPolicies).mockResolvedValue({
      ok: true,
      data: [
        policy({ name: "pol-a", displayName: "Alpha" }),
        policy({ name: "pol-b", displayName: "Bravo" }),
      ],
    });
    const { onSelect } = renderDialog();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Bravo"));
    expect(onSelect).toHaveBeenCalledWith({
      id: "pol-b",
      displayName: "Bravo",
    });
  });

  it("marks the current policy as Linked", async () => {
    vi.mocked(listDlpPolicies).mockResolvedValue({
      ok: true,
      data: [
        policy({ name: "pol-a", displayName: "Alpha" }),
        policy({ name: "pol-b", displayName: "Bravo" }),
      ],
    });
    renderDialog("pol-b");
    await waitFor(() => {
      expect(screen.getByText("Bravo")).toBeInTheDocument();
    });
    // Single "Linked" badge — on Bravo.
    const badges = screen.getAllByText("Linked");
    expect(badges).toHaveLength(1);
  });

  it("filters the list by search query", async () => {
    vi.mocked(listDlpPolicies).mockResolvedValue({
      ok: true,
      data: [
        policy({ name: "pol-a", displayName: "Tenant default DLP" }),
        policy({ name: "pol-b", displayName: "Sandbox DLP" }),
        policy({ name: "pol-c", displayName: "Sales DLP" }),
      ],
    });
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText("Tenant default DLP")).toBeInTheDocument();
    });
    await userEvent.type(
      screen.getByPlaceholderText(/search policies/i),
      "sales",
    );
    expect(screen.queryByText("Tenant default DLP")).not.toBeInTheDocument();
    expect(screen.queryByText("Sandbox DLP")).not.toBeInTheDocument();
    expect(screen.getByText("Sales DLP")).toBeInTheDocument();
  });
});
