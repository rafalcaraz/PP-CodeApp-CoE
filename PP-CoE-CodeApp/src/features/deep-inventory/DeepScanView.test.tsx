/**
 * Smoke test for DeepScanView.
 *
 * Verifies the end-to-end happy path: rendering the page seeded with
 * the SharepointFormApp filter, clicking "Run scan", and seeing one
 * matching row appear in the results table.
 *
 * Mocks:
 *  - `./data` so the runner is a fake async generator that yields
 *    one match and one done event.
 *  - `../../data/inventory` so scope resolution doesn't hit the real
 *    connector (the runner is mocked anyway but `data.ts` imports it
 *    at module load).
 *  - `../../components/EnvironmentPicker` so the scope dropdown's env
 *    list doesn't try to fetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

const { runDeepScanMock } = vi.hoisted(() => ({
  runDeepScanMock: vi.fn(),
}));

vi.mock("./data", async () => {
  const actual = await vi.importActual<typeof import("./data")>("./data");
  return {
    ...actual,
    runDeepScan: runDeepScanMock,
  };
});

vi.mock("../../data/inventory", () => ({
  listEnvironments: vi.fn().mockResolvedValue({
    ok: true,
    data: [{ id: "env-1", displayName: "Env 1" }],
  }),
  listEnvironmentsInGroup: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  listEnvironmentGroups: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  listEnvironmentsPage: vi.fn().mockResolvedValue({
    ok: true,
    data: { rows: [], skipToken: undefined, totalRecords: 0 },
  }),
}));

vi.mock("../../components/EnvironmentPicker", () => ({
  EnvironmentPicker: () => <div data-testid="env-picker">all envs</div>,
}));

import { DeepScanView } from "./DeepScanView";

beforeEach(() => {
  runDeepScanMock.mockReset();
  localStorage.clear();
});

function renderView() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <DeepScanView />
      </MemoryRouter>
    </FluentProvider>
  );
}

describe("DeepScanView", () => {
  it("renders the seeded SharepointFormApp filter on mount", () => {
    renderView();
    expect(screen.getByText("Tenant scans")).toBeInTheDocument();
    // The label appears both in the filter row's property dropdown
    // and in the column picker's options; just assert at least one.
    expect(screen.getAllByText(/Embedded app type/i).length).toBeGreaterThan(0);
  });

  it("streams matches from the runner and renders them in the table", async () => {
    async function* fakeRun() {
      yield {
        kind: "progress" as const,
        scopeUnitsTotal: 1,
        scopeUnitsDone: 0,
        recordsScanned: 0,
        matches: 0,
      };
      yield {
        kind: "match" as const,
        row: {
          identity: {
            id: "app-1",
            environmentId: "env-1",
            displayName: "Trouble-shooting App",
            resourceType: "microsoft.powerapps/canvasapps",
          },
          cells: {
            "properties.embeddedApp.type": "SharepointFormApp",
          },
          raw: {
            name: "app-1",
            properties: { embeddedApp: { type: "SharepointFormApp" } },
          },
        },
      };
      yield {
        kind: "done" as const,
        summary: {
          scopeUnitsTotal: 1,
          scopeUnitsDone: 1,
          scopeUnitsErrored: 0,
          recordsScanned: 1,
          matches: 1,
          errors: [],
          cancelled: false,
          observedAfter: {
            source: "admin-apps" as const,
            windowRecords: 1,
            windowSize: 500,
            paths: new Map(),
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }
    runDeepScanMock.mockReturnValue(fakeRun());

    renderView();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /run scan/i }));

    await waitFor(() => {
      expect(screen.getByText("Trouble-shooting App")).toBeInTheDocument();
    });

    // The done event should land and the progress line should switch
    // to the "Done — ..." summary copy.
    await waitFor(() => {
      expect(screen.getByText(/Done.*1 matches/i)).toBeInTheDocument();
    });

    expect(runDeepScanMock).toHaveBeenCalledTimes(1);
  });
});
