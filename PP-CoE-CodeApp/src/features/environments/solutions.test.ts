import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listSolutions, solutionOverviewUrl } from "./solutions";
import {
  clearDataverseInflight,
  resetDataverseRunner,
  setDataverseRunner,
} from "../../shared/dataverse";
import type { DataverseRecord } from "../../shared/dataverse";

function envelope(records: DataverseRecord[]) {
  return {
    success: true,
    data: { response: JSON.stringify({ value: records }) },
  };
}

beforeEach(() => {
  clearDataverseInflight();
});

afterEach(() => {
  clearDataverseInflight();
  resetDataverseRunner();
});

describe("listSolutions", () => {
  it("maps raw records, filters system/invisible solutions, and sorts by name", async () => {
    setDataverseRunner(async () =>
      envelope([
        // invisible system solutions — must be dropped
        { solutionid: "s0", uniquename: "Default", friendlyname: "Default Solution", isvisible: false },
        { solutionid: "s1", uniquename: "Active", friendlyname: "Active", isvisible: false },
        // an unrelated invisible solution — dropped via isvisible flag
        { solutionid: "s2", uniquename: "Hidden", friendlyname: "Hidden One", isvisible: false },
        // visible solutions — kept (note unsorted order)
        {
          solutionid: "s3",
          uniquename: "ZebraSolution",
          friendlyname: "Zebra",
          version: "1.0.0.0",
          ismanaged: true,
          modifiedon: "2025-01-01T00:00:00Z",
          _publisherid_value: "pub-1",
        },
        {
          solutionid: "s4",
          uniquename: "AlphaSolution",
          friendlyname: "Alpha",
          version: "2.0",
          ismanaged: false,
        },
      ]),
    );

    const res = await listSolutions("env-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Two visible solutions, sorted alphabetically by friendlyName.
    expect(res.data.map((r) => r.friendlyName)).toEqual(["Alpha", "Zebra"]);

    const zebra = res.data[1];
    expect(zebra).toMatchObject({
      id: "s3",
      uniqueName: "ZebraSolution",
      friendlyName: "Zebra",
      version: "1.0.0.0",
      isManaged: true,
      modifiedOn: "2025-01-01T00:00:00Z",
      publisherId: "pub-1",
    });
    expect(zebra.raw).toBeDefined();
  });

  it("falls back to uniquename when friendlyname is missing", async () => {
    setDataverseRunner(async () =>
      envelope([{ solutionid: "s1", uniquename: "OnlyUnique", isvisible: true }]),
    );
    const res = await listSolutions("env-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data[0].friendlyName).toBe("OnlyUnique");
  });

  it("propagates the underlying error", async () => {
    setDataverseRunner(async () => ({
      success: false,
      error: { message: "Table not found" },
    }));
    const res = await listSolutions("env-1");
    expect(res).toEqual({ ok: false, error: "Table not found" });
  });

  it("returns an empty list when the environment has no visible solutions", async () => {
    setDataverseRunner(async () =>
      envelope([{ solutionid: "s1", uniquename: "Default", isvisible: false }]),
    );
    const res = await listSolutions("env-1");
    expect(res).toEqual({ ok: true, data: [] });
  });
});

describe("solutionOverviewUrl", () => {
  it("builds a maker-portal overview deep-link", () => {
    expect(
      solutionOverviewUrl(
        "645162dc-dc62-e3a8-9ad9-dd39a1d7ef06",
        "81ec4bf5-a282-f011-b4cc-000d3a9a3653",
      ),
    ).toBe(
      "https://make.powerapps.com/environments/645162dc-dc62-e3a8-9ad9-dd39a1d7ef06/solutions/81ec4bf5-a282-f011-b4cc-000d3a9a3653/overview",
    );
  });

  it("URL-encodes its inputs", () => {
    expect(solutionOverviewUrl("env id", "sol/id")).toBe(
      "https://make.powerapps.com/environments/env%20id/solutions/sol%2Fid/overview",
    );
  });
});
