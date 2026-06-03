/**
 * Smoke + state-machine tests for <EnvironmentEntitlementCard>.
 *
 * Mirrors the UsageCard test pattern: mock the data fetcher from the
 * shared/licensing barrel.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import React from "react";

const getEnvironmentMcsEntitlementMock = vi.hoisted(() => vi.fn());
vi.mock("../../shared/licensing", () => ({
  getEnvironmentMcsEntitlement: getEnvironmentMcsEntitlementMock,
}));

import { EnvironmentEntitlementCard } from "./EnvironmentEntitlementCard";
import type { EnvironmentEntitlement } from "../../shared/licensing";

function wrap(node: React.ReactNode) {
  return <FluentProvider theme={webLightTheme}>{node}</FluentProvider>;
}

const baseProps = {
  tenantId: "tenant-guid",
  environmentId: "env-guid",
};

const SAMPLE: EnvironmentEntitlement = {
  environmentId: "env-guid",
  environmentName: "ralop-demos-ready",
  environmentType: "Sandbox",
  isManagedEnvironment: true,
  location: "NAM",
  entitlementId: "MCSMessages",
  unit: "Count",
  capacity: {
    allocated: 1000,
    autoAllocated: 0,
    consumed: 250,
    consumptionType: "Snapshot",
    lastUpdatedOn: "2026-04-08T00:00:00Z",
    writeOff: 0,
    available: 750,
    status: "WithinCapacity",
  },
  payGo: {
    entitled: 0,
    consumed: 0,
    consumptionType: "NotSpecified",
    writeOff: 0,
  },
  enforcementRules: [{ ruleType: "TenantPool", enabled: true }],
  productCategories: ["CopilotStudio"],
};

describe("EnvironmentEntitlementCard", () => {
  it("starts in idle with an enabled Load entitlement button + Experimental badge", () => {
    getEnvironmentMcsEntitlementMock.mockReset();
    render(wrap(<EnvironmentEntitlementCard {...baseProps} />));
    expect(
      screen.getByRole("button", { name: /load entitlement/i }),
    ).toBeEnabled();
    expect(screen.getByText(/experimental/i)).toBeInTheDocument();
    expect(getEnvironmentMcsEntitlementMock).not.toHaveBeenCalled();
  });

  it("disables Load and shows a hint when tenantId is missing", () => {
    getEnvironmentMcsEntitlementMock.mockReset();
    render(wrap(<EnvironmentEntitlementCard {...baseProps} tenantId="" />));
    expect(
      screen.getByRole("button", { name: /load entitlement/i }),
    ).toBeDisabled();
    expect(screen.getByText(/tenant id is missing/i)).toBeInTheDocument();
  });

  it("disables Load and shows a hint when environmentId is missing", () => {
    getEnvironmentMcsEntitlementMock.mockReset();
    render(
      wrap(<EnvironmentEntitlementCard {...baseProps} environmentId="" />),
    );
    expect(
      screen.getByRole("button", { name: /load entitlement/i }),
    ).toBeDisabled();
    expect(screen.getByText(/environment id is missing/i)).toBeInTheDocument();
  });

  it("transitions idle → loading → ready and renders capacity metrics + status", async () => {
    getEnvironmentMcsEntitlementMock.mockReset();
    getEnvironmentMcsEntitlementMock.mockResolvedValueOnce({
      ok: true,
      data: SAMPLE,
    });

    const user = userEvent.setup();
    render(wrap(<EnvironmentEntitlementCard {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /load entitlement/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("WithinCapacity")).toBeInTheDocument();
    });
    expect(screen.getByText("Capacity")).toBeInTheDocument();
    expect(screen.getByText("Pay-as-you-go")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument(); // allocated
    expect(screen.getByText("250")).toBeInTheDocument(); // consumed
    expect(screen.getByText("750")).toBeInTheDocument(); // available
    expect(
      screen.getByRole("button", { name: /refresh/i }),
    ).toBeInTheDocument();
  });

  it("shows ErrorPane + Retry on failure, and recovers on retry success", async () => {
    getEnvironmentMcsEntitlementMock.mockReset();
    getEnvironmentMcsEntitlementMock
      .mockResolvedValueOnce({ ok: false, error: "HTTP 404: Not Found" })
      .mockResolvedValueOnce({ ok: true, data: SAMPLE });

    const user = userEvent.setup();
    render(wrap(<EnvironmentEntitlementCard {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /load entitlement/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/couldn't load entitlement/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText("WithinCapacity")).toBeInTheDocument();
    });
  });

  it("does not call setState after unmount when a pending request resolves", async () => {
    getEnvironmentMcsEntitlementMock.mockReset();
    let resolveFirst!: (v: {
      ok: true;
      data: EnvironmentEntitlement;
    }) => void;
    getEnvironmentMcsEntitlementMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const user = userEvent.setup();
    const { unmount } = render(
      wrap(<EnvironmentEntitlementCard {...baseProps} />),
    );
    await user.click(
      screen.getByRole("button", { name: /load entitlement/i }),
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
