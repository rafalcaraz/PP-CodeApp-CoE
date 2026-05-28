/**
 * Smoke tests for the Ownerless Resources page.
 *
 * Mocks the controller singleton so the page state is fully under the
 * test's control — no real network, no real subscriber subscriptions.
 * `UserChip` is stubbed because it independently subscribes to the
 * resolver cache (which would require its own mock layer for no value
 * in a UI smoke test).
 *
 * Coverage:
 *   - Idle state renders the "no scan yet" prompt and a Scan button.
 *   - Clicking Scan calls `startScan`.
 *   - Running state shows the cancel button and progress card.
 *   - Completed state shows bucket tabs with counts and the auto-
 *     selected highest-count bucket's rows.
 *   - From-snapshot state shows the "Re-scan to view affected resources"
 *     drill-in message instead of a resource list.
 *   - Error state shows the error message bar.
 *
 * Follows the data-layer-mock-then-import pattern from
 * `features/security/DlpDuplicator.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router-dom";

import type {
  OwnerEntry,
  ScanProgress,
  ScanResult,
} from "./_ownerless/types";

const {
  startScanMock,
  cancelScanMock,
  clearLastSnapshotMock,
  getProgressMock,
  getResultMock,
  subscribeMock,
} = vi.hoisted(() => ({
  startScanMock: vi.fn(),
  cancelScanMock: vi.fn(),
  clearLastSnapshotMock: vi.fn(),
  getProgressMock: vi.fn<() => ScanProgress>(),
  getResultMock: vi.fn<() => ScanResult | null>(),
  subscribeMock: vi.fn(() => () => {}),
}));

vi.mock("./_ownerless/ownerScanController", () => ({
  startScan: startScanMock,
  cancelScan: cancelScanMock,
  clearLastSnapshot: clearLastSnapshotMock,
  getProgress: getProgressMock,
  getResult: getResultMock,
  subscribe: subscribeMock,
}));

// UserChip independently subscribes to the resolver cache, which would
// require its own mock layer. Stub it with a deterministic span so the
// smoke test stays focused on the page itself.
vi.mock("../../components/UserChip", () => ({
  UserChip: ({ id }: { id: string | undefined | null }) => (
    <span data-testid={`chip-${id ?? "none"}`}>chip:{id ?? "none"}</span>
  ),
}));

// SpOwnersSection lazily fetches Entra owners on expand. Stub the
// transport here so SP-bucket drill-in tests don't hit the real
// connector and so non-SP tests stay quiet.
const { fetchSpOwnersMock } = vi.hoisted(() => ({
  fetchSpOwnersMock: vi.fn(),
}));
vi.mock("../../data/spnEnrichment", () => ({
  fetchServicePrincipalOwners: fetchSpOwnersMock,
}));

import { Ownerless } from "./Ownerless";

// ─── Fixtures ────────────────────────────────────────────────────────────

const OWNER_UNRESOLVED = "44444444-4444-4444-4444-444444444444";
const OWNER_DISABLED = "22222222-2222-2222-2222-222222222222";
const OWNER_ACTIVE = "11111111-1111-1111-1111-111111111111";

function idleProgress(): ScanProgress {
  return {
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    inventoryWalked: 0,
    inventoryTotal: null,
    distinctOwners: 0,
    ownersResolved: 0,
    spnsResolved: 0,
    noOwnerCount: 0,
    error: null,
  };
}

function buildResult(opts: { fromSnapshot?: boolean } = {}): ScanResult {
  const fromSnapshot = opts.fromSnapshot ?? false;
  const ownerIndex = new Map<string, OwnerEntry>();
  ownerIndex.set(OWNER_UNRESOLVED, {
    ownerId: OWNER_UNRESOLVED,
    user: null,
    servicePrincipal: null,
    bucket: "unresolved",
    affectedResources: fromSnapshot
      ? []
      : [
          {
            id: "app-1",
            displayName: "Orphan Sales App",
            environmentId: "env-a",
            type: "microsoft.powerapps/canvasapps",
          },
          {
            id: "flow-1",
            displayName: "Orphan Sync Flow",
            environmentId: "env-a",
            type: "microsoft.powerautomate/cloudflows",
          },
        ],
  });
  ownerIndex.set(OWNER_DISABLED, {
    ownerId: OWNER_DISABLED,
    user: {
      id: OWNER_DISABLED,
      displayName: "Disabled Maker",
      enabled: false,
      userType: "Member",
    },
    servicePrincipal: null,
    bucket: "disabled",
    affectedResources: fromSnapshot
      ? []
      : [
          {
            id: "agent-1",
            displayName: "Sunset Bot",
            environmentId: "env-b",
            type: "microsoft.copilotstudio/agents",
          },
        ],
  });
  ownerIndex.set(OWNER_ACTIVE, {
    ownerId: OWNER_ACTIVE,
    user: {
      id: OWNER_ACTIVE,
      displayName: "Active Maker",
      enabled: true,
      userType: "Member",
    },
    servicePrincipal: null,
    bucket: "active",
    affectedResources: fromSnapshot
      ? []
      : [
          {
            id: "app-2",
            displayName: "Healthy App",
            environmentId: "env-a",
            type: "microsoft.powerapps/canvasapps",
          },
        ],
  });
  return {
    scannedAt: Date.now() - 5 * 60_000,
    totalResources: 4,
    noOwnerCount: 0,
    ownerIndex,
    buckets: {
      unresolved: [OWNER_UNRESOLVED],
      "service-principal": [],
      disabled: [OWNER_DISABLED],
      guest: [],
      active: [OWNER_ACTIVE],
      sentinel: [],
    },
    fromSnapshot,
  };
}

function renderPage() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <Ownerless />
      </MemoryRouter>
    </FluentProvider>,
  );
}

// ─── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  startScanMock.mockReset();
  cancelScanMock.mockReset();
  clearLastSnapshotMock.mockReset();
  getProgressMock.mockReset();
  getResultMock.mockReset();
  subscribeMock.mockReset();
  subscribeMock.mockImplementation(() => () => {});
  fetchSpOwnersMock.mockReset();
  fetchSpOwnersMock.mockResolvedValue({ ok: true, data: [] });
});

// ─── Tests ───────────────────────────────────────────────────────────────

describe("Ownerless — idle state", () => {
  it("renders title, no-scan prompt, and a Scan button", () => {
    getProgressMock.mockReturnValue(idleProgress());
    getResultMock.mockReturnValue(null);

    renderPage();

    expect(screen.getByText("Ownerless Resources")).toBeInTheDocument();
    expect(screen.getByText(/no scan yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /scan tenant/i }),
    ).toBeInTheDocument();
  });

  it("calls startScan when Scan tenant is clicked", () => {
    getProgressMock.mockReturnValue(idleProgress());
    getResultMock.mockReturnValue(null);

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /scan tenant/i }));
    expect(startScanMock).toHaveBeenCalledTimes(1);
  });
});

describe("Ownerless — running state", () => {
  it("shows the cancel button and progress card", () => {
    getProgressMock.mockReturnValue({
      ...idleProgress(),
      phase: "loading-inventory",
      startedAt: Date.now() - 5_000,
      inventoryWalked: 42,
      inventoryTotal: 100,
      distinctOwners: 7,
    });
    getResultMock.mockReturnValue(null);

    renderPage();

    expect(
      screen.getByRole("button", { name: /cancel scan/i }),
    ).toBeInTheDocument();
    // The progress card surfaces walked / total + distinct owners.
    expect(screen.getByText("Resources walked")).toBeInTheDocument();
    expect(screen.getByText(/42.*100/)).toBeInTheDocument();
    expect(screen.getByText("Distinct owners")).toBeInTheDocument();
  });

  it("calls cancelScan when Cancel is clicked", () => {
    getProgressMock.mockReturnValue({
      ...idleProgress(),
      phase: "resolving-owners",
      startedAt: Date.now() - 5_000,
    });
    getResultMock.mockReturnValue(null);

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /cancel scan/i }));
    expect(cancelScanMock).toHaveBeenCalledTimes(1);
  });
});

describe("Ownerless — completed state", () => {
  it("renders tabs with per-bucket counts and auto-selects the highest-count bucket", () => {
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "completed" });
    getResultMock.mockReturnValue(buildResult());

    renderPage();

    // Every bucket tab is present with its count baked into the label.
    expect(screen.getByRole("tab", { name: /unresolved \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /service principal \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /disabled \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /guest \(0\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /active \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /sentinel \(0\)/i })).toBeInTheDocument();

    // Default selection: the first highest-count bucket — `unresolved`
    // (1) wins ties because of OWNER_BUCKETS' order. The unresolved
    // owner's chip should be on screen.
    expect(screen.getByTestId(`chip-${OWNER_UNRESOLVED}`)).toBeInTheDocument();
  });

  it("expands a row to show affected resources", () => {
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "completed" });
    getResultMock.mockReturnValue(buildResult());

    renderPage();

    const expandButton = screen.getByRole("button", { name: /expand/i });
    fireEvent.click(expandButton);

    expect(screen.getByText("Orphan Sales App")).toBeInTheDocument();
    expect(screen.getByText("Orphan Sync Flow")).toBeInTheDocument();
  });

  it("offers a Re-scan button (not Scan tenant) once a result exists", () => {
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "completed" });
    getResultMock.mockReturnValue(buildResult());

    renderPage();
    expect(
      screen.getByRole("button", { name: /re-scan/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^scan tenant$/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Ownerless — from-snapshot state", () => {
  it("shows the snapshot info banner and a drill-in re-scan prompt", () => {
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "idle" });
    getResultMock.mockReturnValue(buildResult({ fromSnapshot: true }));

    renderPage();
    expect(screen.getByText(/Last scan/)).toBeInTheDocument();
    expect(
      screen.getByText(/summary loaded from your previous session/i),
    ).toBeInTheDocument();

    // Expand the first row → drill-in should explain that affected
    // resources weren't persisted.
    const expandButton = screen.getByRole("button", { name: /expand/i });
    fireEvent.click(expandButton);
    expect(
      screen.getByText(/aren'?t available from the saved snapshot/i),
    ).toBeInTheDocument();
  });

  it("Clear last scan calls clearLastSnapshot", () => {
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "idle" });
    getResultMock.mockReturnValue(buildResult({ fromSnapshot: true }));

    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /clear last scan/i }),
    );
    expect(clearLastSnapshotMock).toHaveBeenCalledTimes(1);
  });
});

describe("Ownerless — service-principal bucket (Stage 3)", () => {
  const OWNER_SP = "66666666-6666-6666-6666-666666666666";
  const OWNER_USER = "f89e1b16-63fb-4b09-b8e8-0a859966a74c";

  function buildSpResult(): ScanResult {
    const ownerIndex = new Map<string, OwnerEntry>();
    ownerIndex.set(OWNER_SP, {
      ownerId: OWNER_SP,
      user: null,
      servicePrincipal: {
        id: OWNER_SP,
        displayName: "Acme Pipelines SP",
        appId: "9251fced-28ed-43b2-bd22-cb9e3924de8f",
        servicePrincipalType: "Application",
        appOwnerOrganizationId: "1557f771-4c8e-4dbd-8b80-dd00a88e833e",
        accountEnabled: true,
        kind: "tenant",
      },
      bucket: "service-principal",
      affectedResources: [
        {
          id: "app-9",
          displayName: "Pipeline-deployed App",
          environmentId: "env-prod",
          type: "microsoft.powerapps/canvasapps",
        },
      ],
    });
    return {
      scannedAt: Date.now(),
      totalResources: 1,
      noOwnerCount: 0,
      ownerIndex,
      buckets: {
        unresolved: [],
        "service-principal": [OWNER_SP],
        disabled: [],
        guest: [],
        active: [],
        sentinel: [],
      },
      fromSnapshot: false,
    };
  }

  it("renders the SP name + classification badge in the Owner cell, not a UserChip", () => {
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "completed" });
    getResultMock.mockReturnValue(buildSpResult());

    renderPage();

    // SP display name shows; no UserChip for the SP's ownerId.
    expect(screen.getByText("Acme Pipelines SP")).toBeInTheDocument();
    expect(screen.queryByTestId(`chip-${OWNER_SP}`)).not.toBeInTheDocument();
    // Classification badge — "Tenant SP" exact text (the description
    // paragraph above also mentions "in-tenant SP" which would match
    // a looser regex).
    expect(screen.getByText(/^Tenant SP$/)).toBeInTheDocument();
  });

  it("on expand, lazily fetches SP owners and renders them as UserChips", async () => {
    fetchSpOwnersMock.mockResolvedValue({
      ok: true,
      data: [
        { type: "user", id: OWNER_USER, displayName: "Rafael", mail: "r@x" },
      ],
    });
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "completed" });
    getResultMock.mockReturnValue(buildSpResult());

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /expand/i }));

    // The expand triggers an effect → owners fetch → chip render.
    await screen.findByText(/service principal owners/i);
    expect(fetchSpOwnersMock).toHaveBeenCalledWith(OWNER_SP);
    expect(await screen.findByTestId(`chip-${OWNER_USER}`)).toBeInTheDocument();
  });

  it("surfaces a 'no Entra owners' message for SPs with empty owners (e.g. Microsoft first-party)", async () => {
    fetchSpOwnersMock.mockResolvedValue({ ok: true, data: [] });
    getProgressMock.mockReturnValue({ ...idleProgress(), phase: "completed" });
    getResultMock.mockReturnValue(buildSpResult());

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(
      await screen.findByText(/no entra owners assigned/i),
    ).toBeInTheDocument();
  });
});

describe("Ownerless — error state", () => {
  it("surfaces the error message in a message bar", () => {
    getProgressMock.mockReturnValue({
      ...idleProgress(),
      phase: "error",
      error: "HTTP 503 — Service unavailable",
      finishedAt: Date.now(),
    });
    getResultMock.mockReturnValue(null);

    renderPage();
    expect(screen.getByText("Scan failed")).toBeInTheDocument();
    expect(
      screen.getByText(/HTTP 503 — Service unavailable/),
    ).toBeInTheDocument();
  });
});
