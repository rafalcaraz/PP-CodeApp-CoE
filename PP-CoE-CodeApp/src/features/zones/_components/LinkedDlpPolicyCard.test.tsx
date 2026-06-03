/**
 * Smoke tests for LinkedDlpPolicyCard.
 *
 * Verifies the four user-visible states of the card:
 *   1. Unlinked → empty state with the "Link a DLP policy" CTA.
 *   2. Linked + loading → cached display name + loading spinner.
 *   3. Linked + loaded → policy name, scope badge, drift summary.
 *   4. Linked + error → cached display name + warning MessageBar.
 *
 * Drift math is unit-tested in `standardGroupDlpDrift.test.ts`; here
 * we only need a single happy-path assertion that the summary line
 * shows up with the expected count.
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
    getDlpPolicy: vi.fn(),
  };
});

import { LinkedDlpPolicyCard } from "./LinkedDlpPolicyCard";
import { getDlpPolicy } from "../../../data/dlpPolicies";
import type { StandardCustomGroup } from "../../../data/standardGroups";
import type { EnvironmentRow } from "../../../data/inventory";
import type { PolicyV2 } from "../../../generated/models/PowerPlatformforAdminsModel";

function group(
  overrides: Partial<StandardCustomGroup> = {},
): StandardCustomGroup {
  return {
    id: "grp-1",
    displayName: "Sales (Dev/Test/Prod)",
    description: "",
    color: "#000",
    icon: "📦",
    envIds: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function env(id: string, displayName: string): EnvironmentRow {
  return {
    id,
    displayName,
    environmentType: "Standard",
    region: "unitedstates",
    isManaged: false,
    createdAt: "",
    createdBy: "",
    lastModifiedAt: "",
    environmentGroupId: "",
    environmentGroup: "",
    tenantId: "",
  };
}

function policy(
  overrides: Partial<PolicyV2> & Pick<PolicyV2, "name">,
): PolicyV2 {
  return {
    name: overrides.name,
    displayName: overrides.displayName ?? "Tenant default DLP",
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

function renderCard(
  props: Partial<React.ComponentProps<typeof LinkedDlpPolicyCard>> = {},
) {
  const onLinkClick = vi.fn();
  const onUnlink = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <LinkedDlpPolicyCard
        group={group()}
        envsInGroup={[]}
        allEnvs={[]}
        onLinkClick={onLinkClick}
        onUnlink={onUnlink}
        {...props}
      />
    </FluentProvider>,
  );
  return { onLinkClick, onUnlink };
}

describe("LinkedDlpPolicyCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the empty state when no policy is linked and invokes onLinkClick", async () => {
    const { onLinkClick } = renderCard();
    expect(
      screen.getByRole("button", { name: /link a dlp policy/i }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /link a dlp policy/i }),
    );
    expect(onLinkClick).toHaveBeenCalledTimes(1);
    // getDlpPolicy must NOT fire when there's no linked policy id.
    expect(getDlpPolicy).not.toHaveBeenCalled();
  });

  it("shows the cached display name and a spinner while the policy loads", async () => {
    // Never-resolving promise so we stay in the loading state.
    vi.mocked(getDlpPolicy).mockReturnValue(new Promise(() => {}));
    renderCard({
      group: group({
        dlpPolicyId: "pol-1",
        dlpPolicyDisplayName: "Tenant default DLP",
      }),
    });
    expect(screen.getByText("Tenant default DLP")).toBeInTheDocument();
    expect(screen.getByText(/loading coverage/i)).toBeInTheDocument();
  });

  it("renders the drift summary once the policy resolves", async () => {
    vi.mocked(getDlpPolicy).mockResolvedValue({
      ok: true,
      data: policy({
        name: "pol-1",
        displayName: "Tenant default DLP",
        environmentType: "OnlyEnvironments",
        environments: [
          {
            id: "/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/env-a",
            name: "env-a",
            _type: "Microsoft.BusinessAppPlatform/scopes/environments",
          },
        ],
      }),
    });
    const a = env("env-a", "Apple");
    const b = env("env-b", "Banana");
    renderCard({
      group: group({
        dlpPolicyId: "pol-1",
        dlpPolicyDisplayName: "Tenant default DLP",
        envIds: ["env-a", "env-b"],
      }),
      envsInGroup: [a, b],
      allEnvs: [a, b],
    });
    await waitFor(() => {
      // "1 of 2 environments in this group are covered by this policy."
      expect(
        screen.getByText(/1 of 2 environments in this group/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("OnlyEnvironments")).toBeInTheDocument();
    // The not-covered accordion header should reflect the one
    // uncovered env (env-b).
    expect(
      screen.getByText(/1 not covered — show details/i),
    ).toBeInTheDocument();
  });

  it("falls back to the cached name and shows a warning bar when the policy fetch fails", async () => {
    vi.mocked(getDlpPolicy).mockResolvedValue({
      ok: false,
      error: "Policy not found",
    });
    renderCard({
      group: group({
        dlpPolicyId: "pol-1",
        dlpPolicyDisplayName: "Tenant default DLP",
      }),
    });
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load dlp policy/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Tenant default DLP")).toBeInTheDocument();
  });

  it("calls onUnlink when the Unlink button is clicked", async () => {
    vi.mocked(getDlpPolicy).mockResolvedValue({
      ok: true,
      data: policy({ name: "pol-1" }),
    });
    const { onUnlink } = renderCard({
      group: group({
        dlpPolicyId: "pol-1",
        dlpPolicyDisplayName: "Tenant default DLP",
      }),
    });
    await userEvent.click(screen.getByRole("button", { name: /unlink/i }));
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });
});
