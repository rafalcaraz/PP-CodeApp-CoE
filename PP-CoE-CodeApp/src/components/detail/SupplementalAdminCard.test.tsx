/**
 * Tests for `<SupplementalAdminCard>` — the shared on-demand
 * enrichment card used by detail pages for both "Load admin details"
 * AND "Load DLP policy coverage" buttons.
 *
 * Validating this once covers the entire idle → loading → ready / error
 * → retry → refresh state machine for every detail page that uses it
 * (AppDetail, EnvironmentDetail, EnvironmentGroupDetail). Individual
 * detail page tests then only need to verify the `loadFn` they pass.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { SupplementalAdminCard } from "./SupplementalAdminCard";
import type { DataResult } from "../../data/inventory";

interface Fixture {
  label: string;
}

function renderCard(props: {
  loadFn: () => Promise<DataResult<Fixture>>;
  buttonLabel?: string;
  loadingLabel?: string;
  helpText?: React.ReactNode;
  description?: React.ReactNode;
}) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <SupplementalAdminCard<Fixture>
        title="Admin details (supplemental)"
        description={props.description ?? "Test description"}
        helpText={props.helpText ?? <>Click to call <code>Get_Foo</code>.</>}
        buttonLabel={props.buttonLabel}
        loadingLabel={props.loadingLabel}
        loadFn={props.loadFn}
        renderReady={(data) => <div data-testid="ready-body">Ready: {data.label}</div>}
      />
    </FluentProvider>,
  );
}

describe("SupplementalAdminCard — idle → load → ready", () => {
  it("renders the default button + helpText in the idle state", () => {
    const loadFn = vi.fn().mockResolvedValue({
      ok: true,
      data: { label: "fixture" },
    } satisfies DataResult<Fixture>);
    renderCard({ loadFn });
    expect(
      screen.getByRole("button", { name: "Load admin details" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Get_Foo/)).toBeInTheDocument();
    expect(loadFn).not.toHaveBeenCalled();
  });

  it("renders a custom buttonLabel when provided (e.g. 'Load DLP policy coverage')", () => {
    const loadFn = vi.fn().mockResolvedValue({ ok: true, data: { label: "x" } });
    renderCard({ loadFn, buttonLabel: "Load DLP policy coverage" });
    expect(
      screen.getByRole("button", { name: "Load DLP policy coverage" }),
    ).toBeInTheDocument();
  });

  it("clicking the button calls loadFn exactly once and renders the ready body", async () => {
    const loadFn = vi.fn().mockResolvedValue({
      ok: true,
      data: { label: "alpha" },
    } satisfies DataResult<Fixture>);
    renderCard({ loadFn });
    await userEvent.click(
      screen.getByRole("button", { name: "Load admin details" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("ready-body")).toHaveTextContent("Ready: alpha");
    });
    expect(loadFn).toHaveBeenCalledTimes(1);
    // The idle-state button is gone in the ready state.
    expect(
      screen.queryByRole("button", { name: "Load admin details" }),
    ).not.toBeInTheDocument();
  });

  it("shows the spinner with the custom loadingLabel during the load", async () => {
    let resolve: (value: DataResult<Fixture>) => void = () => {};
    const loadFn = vi.fn(
      () =>
        new Promise<DataResult<Fixture>>((r) => {
          resolve = r;
        }),
    );
    renderCard({ loadFn, loadingLabel: "Loading DLP policies…" });
    await userEvent.click(
      screen.getByRole("button", { name: "Load admin details" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Loading DLP policies…")).toBeInTheDocument();
    });
    resolve({ ok: true, data: { label: "ok" } });
    await waitFor(() => {
      expect(screen.getByTestId("ready-body")).toBeInTheDocument();
    });
  });

  it("ready state surfaces a Refresh link that re-invokes loadFn", async () => {
    const loadFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { label: "first" } })
      .mockResolvedValueOnce({ ok: true, data: { label: "second" } });
    renderCard({ loadFn });
    await userEvent.click(
      screen.getByRole("button", { name: "Load admin details" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("ready-body")).toHaveTextContent("first");
    });
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => {
      expect(screen.getByTestId("ready-body")).toHaveTextContent("second");
    });
    expect(loadFn).toHaveBeenCalledTimes(2);
  });
});

describe("SupplementalAdminCard — error & retry", () => {
  it("shows the ErrorPane with the loadFn message when the call fails", async () => {
    const loadFn = vi.fn().mockResolvedValue({
      ok: false,
      error: "the connector is grumpy",
    } satisfies DataResult<Fixture>);
    renderCard({ loadFn });
    await userEvent.click(
      screen.getByRole("button", { name: "Load admin details" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Couldn't load admin details")).toBeInTheDocument();
    });
    expect(screen.getByText("the connector is grumpy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("Retry re-invokes loadFn and transitions to ready on success", async () => {
    const loadFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "oops" })
      .mockResolvedValueOnce({ ok: true, data: { label: "recovered" } });
    renderCard({ loadFn });
    await userEvent.click(
      screen.getByRole("button", { name: "Load admin details" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByTestId("ready-body")).toHaveTextContent("recovered");
    });
    expect(loadFn).toHaveBeenCalledTimes(2);
  });
});
