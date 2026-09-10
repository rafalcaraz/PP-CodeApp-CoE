import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

import { ScanProgress } from "./ScanProgress";

describe("ScanProgress", () => {
  it("explains why Dataverse was skipped when no candidates matched", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <ScanProgress
          scopeUnitsTotal={1}
          scopeUnitsDone={1}
          recordsScanned={0}
          matches={0}
          summary={{
            scopeUnitsTotal: 1,
            scopeUnitsDone: 1,
            scopeUnitsErrored: 0,
            scopeUnitsSkipped: 1,
            candidatesConsidered: 0,
            sourceRecordsProcessed: 0,
            recordsScanned: 0,
            matches: 0,
            errors: [],
            cancelled: false,
            observedAfter: {
              source: "copilot-agents-dataverse",
              windowRecords: 0,
              windowSize: 500,
              paths: new Map(),
              updatedAt: "2026-09-10T00:00:00.000Z",
            },
          }}
        />
      </FluentProvider>,
    );

    expect(
      screen.getByText(/Dataverse was not called.*matched no agents/i),
    ).toBeInTheDocument();
  });
});
