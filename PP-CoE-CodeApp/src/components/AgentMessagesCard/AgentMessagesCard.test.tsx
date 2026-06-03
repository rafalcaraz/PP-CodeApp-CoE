/**
 * Smoke + state-machine tests for <AgentMessagesCard>.
 *
 * Mirrors the UsageCard test pattern: mock the data fetcher from the
 * shared/licensing barrel (we don't exercise the wrapper flow here —
 * the licensing module's own tests cover it).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import React from "react";

const getAgentMessagesConsumedMock = vi.hoisted(() => vi.fn());
vi.mock("../../shared/licensing", () => ({
  getAgentMessagesConsumed: getAgentMessagesConsumedMock,
}));

import { AgentMessagesCard } from "./AgentMessagesCard";
import type { AgentMessagesConsumption } from "../../shared/licensing";

function wrap(node: React.ReactNode) {
  return <FluentProvider theme={webLightTheme}>{node}</FluentProvider>;
}

const baseProps = {
  tenantId: "tenant-guid",
  resourceId: "resource-guid",
};

const SAMPLE: AgentMessagesConsumption = {
  consumed: 123,
  unit: "Messages",
  resourceName: "ITSNowAgent",
  environmentId: "env-guid",
  asOfDate: "2026-06-03T03:53:08.777Z",
  fromDate: "2026-05-04",
  toDate: "2026-06-03",
  empty: false,
};

describe("AgentMessagesCard", () => {
  it("starts in idle with an enabled Load consumption button", () => {
    getAgentMessagesConsumedMock.mockReset();
    render(wrap(<AgentMessagesCard {...baseProps} />));
    expect(
      screen.getByRole("button", { name: /load consumption/i }),
    ).toBeEnabled();
    expect(getAgentMessagesConsumedMock).not.toHaveBeenCalled();
  });

  it("disables Load and shows a hint when tenantId is missing", () => {
    getAgentMessagesConsumedMock.mockReset();
    render(wrap(<AgentMessagesCard {...baseProps} tenantId="" />));
    expect(
      screen.getByRole("button", { name: /load consumption/i }),
    ).toBeDisabled();
    expect(screen.getByText(/tenant id is missing/i)).toBeInTheDocument();
    expect(getAgentMessagesConsumedMock).not.toHaveBeenCalled();
  });

  it("disables Load and shows a hint when resourceId is missing", () => {
    getAgentMessagesConsumedMock.mockReset();
    render(wrap(<AgentMessagesCard {...baseProps} resourceId="" />));
    expect(
      screen.getByRole("button", { name: /load consumption/i }),
    ).toBeDisabled();
    expect(screen.getByText(/agent id is missing/i)).toBeInTheDocument();
  });

  it("transitions idle → loading → ready and renders the KPI value", async () => {
    getAgentMessagesConsumedMock.mockReset();
    getAgentMessagesConsumedMock.mockResolvedValueOnce({ ok: true, data: SAMPLE });

    const user = userEvent.setup();
    render(wrap(<AgentMessagesCard {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /load consumption/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("123")).toBeInTheDocument();
    });
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /refresh/i }),
    ).toBeInTheDocument();
  });

  it("renders the empty-state message when data.empty is true", async () => {
    getAgentMessagesConsumedMock.mockReset();
    getAgentMessagesConsumedMock.mockResolvedValueOnce({
      ok: true,
      data: { ...SAMPLE, consumed: 0, empty: true, asOfDate: undefined },
    });

    const user = userEvent.setup();
    render(wrap(<AgentMessagesCard {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /load consumption/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("0")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/no usage reported for this agent/i),
    ).toBeInTheDocument();
  });

  it("shows ErrorPane + Retry on failure, and recovers on retry success", async () => {
    getAgentMessagesConsumedMock.mockReset();
    getAgentMessagesConsumedMock
      .mockResolvedValueOnce({ ok: false, error: "HTTP 403: Forbidden" })
      .mockResolvedValueOnce({ ok: true, data: SAMPLE });

    const user = userEvent.setup();
    render(wrap(<AgentMessagesCard {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /load consumption/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/couldn't load consumption/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText("123")).toBeInTheDocument();
    });
  });

  it("does not call setState after unmount when a pending request resolves", async () => {
    getAgentMessagesConsumedMock.mockReset();
    let resolveFirst!: (v: {
      ok: true;
      data: AgentMessagesConsumption;
    }) => void;
    getAgentMessagesConsumedMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const user = userEvent.setup();
    const { unmount } = render(wrap(<AgentMessagesCard {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /load consumption/i }),
    );
    unmount();
    resolveFirst({ ok: true, data: SAMPLE });

    await new Promise((r) => setTimeout(r, 0));

    const reactStateWarning = errorSpy.mock.calls.find((args) =>
      String(args[0] ?? "").includes("unmounted"),
    );
    expect(reactStateWarning).toBeUndefined();
    errorSpy.mockRestore();
  });
});
