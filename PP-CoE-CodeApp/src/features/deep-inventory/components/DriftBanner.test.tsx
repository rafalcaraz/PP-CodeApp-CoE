import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { describe, expect, it } from "vitest";

import { DriftBanner } from "./DriftBanner";
import type { DriftWarning } from "../data";

const PROPERTY = {
  id: "memoryEnabled",
  label: "Memory enabled",
  path: "capabilities.memoryEnabled",
  group: "Detected capabilities",
  filter: { kind: "boolean" as const },
  source: "copilot-agents-dataverse" as const,
  addedIn: "2026-09-09",
};

describe("DriftBanner", () => {
  it("summarizes warnings in one quiet grouped message", () => {
    const warnings: DriftWarning[] = [
      {
        kind: "missing",
        property: PROPERTY,
        message: "Missing",
      },
      {
        kind: "type-shift",
        property: { ...PROPERTY, id: "memoryType", label: "Memory type" },
        observedInferredType: "string",
        curatedFilterKind: "boolean",
        message: "Type changed",
      },
    ];

    render(
      <FluentProvider theme={webLightTheme}>
        <DriftBanner warnings={warnings} />
      </FluentProvider>,
    );

    expect(
      screen.getByRole("group", {
        name: /Schema drift — 1 watched property missing · 1 type changed/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 watched property missing · 1 type changed/i))
      .toBeInTheDocument();
    expect(screen.getByText(/Discovered values alone do not create drift alerts/i))
      .toBeInTheDocument();
  });
});
