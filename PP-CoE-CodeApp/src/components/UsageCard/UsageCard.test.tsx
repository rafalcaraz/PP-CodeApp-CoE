/**
 * Smoke + state-machine tests for <UsageCard>.
 *
 * We mock `getUsageTimeseries` from the shared/licensing barrel so we
 * don't touch the generated flow client here — those code paths are
 * already covered by the licensing module's own tests. The chart
 * itself is also mocked to a div so jsdom doesn't have to render
 * Recharts SVG.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

// React is used implicitly by JSX in the mocked recharts components below;
// keep it as a value import so esbuild emits the runtime reference.
import React from "react";

const getUsageTimeseriesMock = vi.hoisted(() => vi.fn());
vi.mock("../../shared/licensing", () => ({
  getUsageTimeseries: getUsageTimeseriesMock,
}));

// Recharts renders SVG that jsdom can size to 0×0 and warn about.
// Stub the BarChart with a deterministic data-driven div so we can
// assert on the data shape without booting the chart engine.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ data, children }: { data: unknown[]; children: React.ReactNode }) => (
    <div data-testid="bar-chart" data-points={data.length}>
      {children}
    </div>
  ),
  Bar: ({ dataKey, name }: { dataKey: string; name: string }) => (
    <div data-testid={`bar-${dataKey}`} data-name={name} />
  ),
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
}));

import { UsageCard } from "./UsageCard";
import type { UsageSeries } from "../../shared/licensing";

function wrap(node: React.ReactNode) {
  return <FluentProvider theme={webLightTheme}>{node}</FluentProvider>;
}

const baseProps = {
  productCategory: "CopilotStudio" as const,
  productLabel: "Copilot Studio",
  tenantId: "tenant-guid",
  resourceId: "resource-guid",
};

const SAMPLE_SERIES: UsageSeries = {
  productCategory: "CopilotStudio",
  interval: "Monthly",
  fromDate: "2026-01-01T00:00:00+00:00",
  toDate: "2026-05-31T00:00:00+00:00",
  points: [
    {
      date: "2026-04-01T00:00:00+00:00",
      metrics: { activeUsers: 1, activeSessions: 10, activeRuns: 0 },
    },
    {
      date: "2026-05-01T00:00:00+00:00",
      metrics: { activeUsers: 1, activeSessions: 527, activeRuns: 0 },
    },
  ],
  totals: { activeUsers: 2, activeSessions: 537, activeRuns: 0 },
};

describe("UsageCard", () => {
  it("starts in idle with a Load usage button", () => {
    getUsageTimeseriesMock.mockReset();
    render(wrap(<UsageCard {...baseProps} />));
    expect(screen.getByRole("button", { name: /load usage/i })).toBeEnabled();
    expect(getUsageTimeseriesMock).not.toHaveBeenCalled();
  });

  it("disables Load and shows a hint when tenantId is missing", () => {
    getUsageTimeseriesMock.mockReset();
    render(wrap(<UsageCard {...baseProps} tenantId="" />));
    expect(screen.getByRole("button", { name: /load usage/i })).toBeDisabled();
    expect(screen.getByText(/tenant id is missing/i)).toBeInTheDocument();
    expect(getUsageTimeseriesMock).not.toHaveBeenCalled();
  });

  it("disables Load and shows a hint when resourceId is missing", () => {
    getUsageTimeseriesMock.mockReset();
    render(wrap(<UsageCard {...baseProps} resourceId="" />));
    expect(screen.getByRole("button", { name: /load usage/i })).toBeDisabled();
    expect(screen.getByText(/resource id is missing/i)).toBeInTheDocument();
  });

  it("renders the experimental note in idle when provided", () => {
    getUsageTimeseriesMock.mockReset();
    render(
      wrap(
        <UsageCard
          {...baseProps}
          experimentalNote="Experimental — endpoint may not exist for Power Apps."
        />,
      ),
    );
    expect(
      screen.getByText(/experimental.*endpoint may not exist/i),
    ).toBeInTheDocument();
  });

  it("transitions idle → loading → ready and renders the chart and totals", async () => {
    getUsageTimeseriesMock.mockReset();
    getUsageTimeseriesMock.mockResolvedValueOnce({ ok: true, data: SAMPLE_SERIES });

    const user = userEvent.setup();
    render(wrap(<UsageCard {...baseProps} />));
    await user.click(screen.getByRole("button", { name: /load usage/i }));

    await waitFor(() => {
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bar-chart").getAttribute("data-points")).toBe("2");
    expect(screen.getByTestId("bar-activeUsers")).toHaveAttribute("data-name", "Active users");
    expect(screen.getByTestId("bar-activeSessions")).toHaveAttribute("data-name", "Active sessions");
    expect(screen.getByTestId("bar-activeRuns")).toHaveAttribute("data-name", "Active runs");
    // Totals
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("537")).toBeInTheDocument();
    // Refresh button now visible
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  it("shows ErrorPane + Retry when fetch fails, and a successful retry recovers", async () => {
    getUsageTimeseriesMock.mockReset();
    getUsageTimeseriesMock
      .mockResolvedValueOnce({ ok: false, error: "HTTP 403: Forbidden" })
      .mockResolvedValueOnce({ ok: true, data: SAMPLE_SERIES });

    const user = userEvent.setup();
    render(wrap(<UsageCard {...baseProps} />));
    await user.click(screen.getByRole("button", { name: /load usage/i }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't load usage/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    });
  });

  it("renders an empty-state message when points.length === 0", async () => {
    getUsageTimeseriesMock.mockReset();
    getUsageTimeseriesMock.mockResolvedValueOnce({
      ok: true,
      data: {
        ...SAMPLE_SERIES,
        points: [],
        totals: { activeUsers: 0, activeSessions: 0, activeRuns: 0 },
      },
    });

    const user = userEvent.setup();
    render(wrap(<UsageCard {...baseProps} />));
    await user.click(screen.getByRole("button", { name: /load usage/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/no usage data returned/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("does not call setState after unmount when a pending request resolves", async () => {
    getUsageTimeseriesMock.mockReset();
    let resolveFirst!: (v: { ok: true; data: UsageSeries }) => void;
    getUsageTimeseriesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    // Capture console.error so we can assert React didn't warn about
    // "state update on an unmounted component" (the canary symptom of
    // a missing mounted-ref guard).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const user = userEvent.setup();
    const { unmount } = render(wrap(<UsageCard {...baseProps} />));
    await user.click(screen.getByRole("button", { name: /load usage/i }));
    // Now the component is "loading" — unmount it before the fetch resolves.
    unmount();
    resolveFirst({ ok: true, data: SAMPLE_SERIES });

    // Let the microtask queue drain so any (unwanted) setState call would fire.
    await new Promise((r) => setTimeout(r, 0));

    const reactStateWarning = errorSpy.mock.calls.find((args) =>
      String(args[0] ?? "").includes("unmounted"),
    );
    expect(reactStateWarning).toBeUndefined();
    errorSpy.mockRestore();
  });
});
