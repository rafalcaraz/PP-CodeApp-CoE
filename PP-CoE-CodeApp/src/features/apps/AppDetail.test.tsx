/**
 * Smoke test for AppDetail — load mechanics + "Load admin details"
 * button wiring.
 *
 * The page calls `getApp(appId)` on mount and renders the resulting
 * row. For canvas / code / app-builder apps (the types where
 * `isAppAdminDetailsSupported` returns true) it also exposes a
 * `<SupplementalAdminCard>` that fires `getAppAdminDetails(envId, id)`
 * on click.
 *
 * The card itself is tested generically in SupplementalAdminCard.test.tsx
 * — here we only verify the *wiring* between AppDetail and the enrichment
 * call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("../../features/apps/data", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/apps/data")
  >("../../features/apps/data");
  return { ...actual, getApp: vi.fn() };
});

vi.mock("../../data/adminEnrichment", async () => {
  const actual = await vi.importActual<
    typeof import("../../data/adminEnrichment")
  >("../../data/adminEnrichment");
  return {
    ...actual,
    getAppAdminDetails: vi.fn(),
  };
});

vi.mock("../../components/UserChip", () => ({
  UserChip: ({ id }: { id: string }) => (
    <span data-testid="user-chip">{id}</span>
  ),
}));

import { AppDetail } from "../../features/apps/AppDetail";
import { getApp } from "../../features/apps/data";
import { getAppAdminDetails } from "../../data/adminEnrichment";

function appRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "app-1",
    type: "microsoft.powerapps/canvasapps",
    displayName: "Onboarding App",
    environmentId: "env-1",
    environmentName: "Production",
    tenantId: "tenant-1",
    ownerId: "00000000-0000-0000-0000-000000000001",
    ownerDisplayName: "Alice Maker",
    createdBy: "",
    createdAt: "2024-01-01T00:00:00Z",
    lastModifiedBy: "",
    lastModifiedAt: "2024-09-01T00:00:00Z",
    lastLaunchedAt: "",
    region: "unitedstates",
    appType: "",
    subType: "",
    logicalName: "",
    appModuleId: "",
    isFeatured: false,
    bypassConsent: false,
    isQuarantined: false,
    sharedUsersCount: 0,
    sharedGroupsCount: 0,
    connectors: [],
    ...overrides,
  };
}

function renderAppDetail(route = "/apps/app-1") {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/apps/:appId" element={<AppDetail />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

describe("AppDetail smoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and renders the app display name in the breadcrumb", async () => {
    vi.mocked(getApp).mockResolvedValue({
      ok: true,
      data: { row: appRow() as never, raw: {} },
    });
    renderAppDetail();
    await waitFor(() => {
      // Display name appears twice (breadcrumb + header) — use getAllByText.
      expect(screen.getAllByText("Onboarding App").length).toBeGreaterThan(0);
    });
    expect(getApp).toHaveBeenCalledWith("app-1", undefined);
    expect(screen.queryByRole("heading", { name: "Managed app properties" })).not.toBeInTheDocument();
  });

  describe("AppDetail managed app metadata", () => {
    it("shows runtime/sharing and searches returned package names and versions without enrichment calls", async () => {
      vi.mocked(getApp).mockResolvedValue({ ok: true, data: {
        row: appRow({ type: "microsoft.powerapps/apps", subType: "microsoftApp" }) as never,
        raw: { properties: {
          createdIn: "Copilot Studio", hasCustomMiddleTier: false,
          sharing: { run: { userCount: 2, groupCount: 0, entireTenant: false } },
          npmPackages: [{ name: "@example/widgets", version: "6.3.1" }, { name: "react", version: "19.2.5" }],
          npmPackageCount: 2, npmPackageInventoryScope: "directProduction",
          npmPackageInventoryTruncated: false, npmPackageUnresolvedCount: 0, npmPackageInventoryVersion: 1,
        } },
      } });
      renderAppDetail();
      expect(await screen.findByRole("heading", { name: "Managed app properties" })).toBeVisible();
      expect(screen.getByText("Copilot Studio")).toBeVisible();
      expect(screen.getByText("Custom middle tier").parentElement).toHaveTextContent("No");
      expect(screen.queryByText("Shared users")).not.toBeInTheDocument();
      const sharing = within(screen.getByRole("table", { name: "Managed app sharing" }));
      expect(sharing.getAllByRole("row")[2]).toHaveTextContent("Run20Not reportedNot reportedNo");
      expect(screen.getByText("Direct production dependencies, not a full transitive inventory.")).toBeVisible();
      fireEvent.change(screen.getByRole("textbox", { name: "Search packages" }), { target: { value: "19.2" } });
      const packages = within(screen.getByRole("table", { name: "Returned packages" }));
      expect(packages.getByText("react")).toBeVisible();
      expect(packages.queryByText("@example/widgets")).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole("textbox", { name: "Search packages" }), { target: { value: "@EXAMPLE" } });
      expect(packages.getByText("@example/widgets")).toBeVisible();
      expect(getAppAdminDetails).not.toHaveBeenCalled();
      expect(getApp).toHaveBeenCalledTimes(1);
    });
    it("surfaces partial/unknown metadata without inventing zero sharing or full dependency coverage", async () => {
      vi.mocked(getApp).mockResolvedValue({ ok: true, data: {
        row: appRow({ type: "microsoft.powerapps/apps", subType: "microsoftApp" }) as never,
        raw: { properties: {
          npmPackages: [{ name: "partial-package" }, null], npmPackageCount: 5,
          npmPackageInventoryTruncated: true, npmPackageUnresolvedCount: 2,
          npmPackageInventoryScope: "futureScope", npmPackageInventoryVersion: 3,
        } },
      } });
      renderAppDetail();
      expect(await screen.findByText("partial-package")).toBeVisible();
      expect(screen.getByText(/2 entries returned/)).toHaveTextContent("Declared count: 5");
      expect(screen.getByText(/returned package inventory is truncated/)).toHaveTextContent("2 unresolved packages");
      expect(screen.getByRole("table", { name: "Managed app sharing" })).not.toHaveTextContent("0");
      fireEvent.click(screen.getByText("Package inventory coverage"));
      expect(screen.getByText("futureScope")).toBeVisible();
      expect(screen.getByText("3")).toBeVisible();
    });
  });

  it("renders the missing-state ErrorPane when getApp returns ok:true but no data", async () => {
    vi.mocked(getApp).mockResolvedValue({ ok: true, data: null });
    renderAppDetail();
    await waitFor(() => {
      expect(screen.getByText("App not found")).toBeInTheDocument();
    });
  });

  it("renders the error-state ErrorPane when getApp returns ok:false", async () => {
    vi.mocked(getApp).mockResolvedValue({ ok: false, error: "boom" });
    renderAppDetail();
    await waitFor(() => {
      expect(screen.getByText("Couldn't load app")).toBeInTheDocument();
    });
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("passes envId from the URL query to getApp", async () => {
    vi.mocked(getApp).mockResolvedValue({
      ok: true,
      data: { row: appRow() as never, raw: {} },
    });
    renderAppDetail("/apps/app-1?envId=env-9");
    await waitFor(() => {
      expect(screen.getAllByText("Onboarding App").length).toBeGreaterThan(0);
    });
    expect(getApp).toHaveBeenCalledWith("app-1", "env-9");
  });
});

describe("AppDetail — admin details enrichment wiring", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["microsoft.powerapps/codeapps", "vibeApp", "Vibe app"],
    ["microsoft.powerapps/apps", "microsoftApp", "Managed app"],
  ])("labels %s / %s correctly", async (type, subType, label) => {
    vi.mocked(getApp).mockResolvedValue({
      ok: true,
      data: { row: appRow({ type, subType }) as never, raw: {} },
    });
    renderAppDetail();
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("clicking 'Load admin details' calls getAppAdminDetails(envId, appId)", async () => {
    vi.mocked(getApp).mockResolvedValue({
      ok: true,
      data: { row: appRow() as never, raw: {} },
    });
    vi.mocked(getAppAdminDetails).mockResolvedValue({
      ok: true,
      data: { data: { displayName: "Onboarding App" }, raw: {} } as never,
    });
    renderAppDetail();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load admin details" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Load admin details" }),
    );
    await waitFor(() => {
      expect(getAppAdminDetails).toHaveBeenCalledWith("env-1", "app-1");
    });
  });

  it("hides the admin details card for unsupported app types (e.g. model-driven)", async () => {
    vi.mocked(getApp).mockResolvedValue({
      ok: true,
      data: {
        row: appRow({
          type: "microsoft.powerapps/modeldrivenapps",
        }) as never,
        raw: {},
      },
    });
    renderAppDetail();
    await waitFor(() => {
      expect(screen.getAllByText("Onboarding App").length).toBeGreaterThan(0);
    });
    // The card is rendered conditionally on isAppAdminDetailsSupported.
    expect(
      screen.queryByRole("button", { name: "Load admin details" }),
    ).not.toBeInTheDocument();
  });
});
