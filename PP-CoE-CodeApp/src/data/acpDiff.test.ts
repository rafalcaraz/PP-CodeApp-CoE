/**
 * Unit tests for `extractAcpSnapshot` + `diffAcpStatuses`.
 *
 * These pin the two non-obvious merge rules the snapshot extractor
 * applies when the same connector appears across multiple policies on
 * one env group:
 *
 *   - `AllAllowed` beats `SomeAllowed`
 *   - `SomeAllowed` action lists are unioned (deduped + sorted)
 *
 * Plus the diff's row classification (a-only / b-only / mode-changed)
 * and the alphabetized "diff rows first" sort.
 */
import { describe, it, expect } from "vitest";
import {
  extractAcpSnapshot,
  diffAcpStatuses,
  diffActions,
  type AcpSnapshot,
} from "./acpDiff";
import type { Policy } from "../generated/models/PowerPlatformforAdminsV2Model";

function rule(
  id: string,
  inputs: Record<string, unknown> = {},
): NonNullable<Policy["ruleSets"]>[number] {
  return { id, inputs } as NonNullable<Policy["ruleSets"]>[number];
}

function allowedConnector(args: {
  rawId: string;
  actionsMode?: "AllAllowed" | "SomeAllowed";
  actions?: string[];
  connTypesMode?: "AllAllowed" | "SomeAllowed";
}) {
  return {
    AllowedConnector: args.rawId,
    AllowedActionsMode: args.actionsMode ?? "AllAllowed",
    AllowedActions: args.actions ?? [],
    AllowedConnectionTypesMode: args.connTypesMode ?? "AllAllowed",
  };
}

function policy(ruleSets: NonNullable<Policy["ruleSets"]>): Policy {
  return { ruleSets } as Policy;
}

describe("extractAcpSnapshot — single policy", () => {
  it("returns the empty snapshot when no rules are present", () => {
    expect(extractAcpSnapshot([])).toEqual({
      configured: false,
      acpOnly: false,
      allowed: [],
    });
  });

  it("flags `configured` when at least one ConnectorManagement rule exists", () => {
    const snap = extractAcpSnapshot([
      policy([rule("ConnectorManagement", { AllowedConnectorList: [] })]),
    ]);
    expect(snap.configured).toBe(true);
    expect(snap.allowed).toEqual([]);
  });

  it("flags `acpOnly` only when the EnableAdvancedConnectorPoliciesOnly flag is exactly `true`", () => {
    const trueSnap = extractAcpSnapshot([
      policy([
        rule("AdvancedConnectorPoliciesOnly", {
          EnableAdvancedConnectorPoliciesOnly: true,
        }),
      ]),
    ]);
    expect(trueSnap.acpOnly).toBe(true);

    const falsySnap = extractAcpSnapshot([
      policy([
        rule("AdvancedConnectorPoliciesOnly", {
          EnableAdvancedConnectorPoliciesOnly: "true", // string, not bool
        }),
      ]),
    ]);
    expect(falsySnap.acpOnly).toBe(false);
  });

  it("normalizes ARM-path connector ids into lowercased slugs", () => {
    const snap = extractAcpSnapshot([
      policy([
        rule("ConnectorManagement", {
          AllowedConnectorList: [
            allowedConnector({
              rawId: "/providers/Microsoft.PowerApps/apis/shared_SQL",
            }),
          ],
        }),
      ]),
    ]);
    expect(snap.allowed).toHaveLength(1);
    expect(snap.allowed[0].id).toBe("shared_sql");
    expect(snap.allowed[0].rawId).toBe(
      "/providers/Microsoft.PowerApps/apis/shared_SQL",
    );
  });

  it("coerces unknown mode strings to `Unknown`", () => {
    const snap = extractAcpSnapshot([
      policy([
        rule("ConnectorManagement", {
          AllowedConnectorList: [
            {
              AllowedConnector: "/x/shared_sql",
              AllowedActionsMode: "MysteryMode",
              AllowedConnectionTypesMode: undefined,
            },
          ],
        }),
      ]),
    ]);
    expect(snap.allowed[0].allowedActionsMode).toBe("Unknown");
    expect(snap.allowed[0].allowedConnectionTypesMode).toBe("Unknown");
  });
});

describe("extractAcpSnapshot — merge rules across policies", () => {
  it("`AllAllowed` beats `SomeAllowed` and clears the action list", () => {
    const snap = extractAcpSnapshot([
      policy([
        rule("ConnectorManagement", {
          AllowedConnectorList: [
            allowedConnector({
              rawId: "/x/shared_sql",
              actionsMode: "SomeAllowed",
              actions: ["GetRows"],
            }),
          ],
        }),
      ]),
      policy([
        rule("ConnectorManagement", {
          AllowedConnectorList: [
            allowedConnector({
              rawId: "/x/shared_sql",
              actionsMode: "AllAllowed",
            }),
          ],
        }),
      ]),
    ]);
    expect(snap.allowed[0].allowedActionsMode).toBe("AllAllowed");
    expect(snap.allowed[0].allowedActions).toEqual([]);
  });

  it("unions action lists across `SomeAllowed` rules (sorted, deduped)", () => {
    const snap = extractAcpSnapshot([
      policy([
        rule("ConnectorManagement", {
          AllowedConnectorList: [
            allowedConnector({
              rawId: "/x/shared_sql",
              actionsMode: "SomeAllowed",
              actions: ["GetRows", "InsertRow"],
            }),
          ],
        }),
      ]),
      policy([
        rule("ConnectorManagement", {
          AllowedConnectorList: [
            allowedConnector({
              rawId: "/x/shared_sql",
              actionsMode: "SomeAllowed",
              actions: ["InsertRow", "DeleteRow"],
            }),
          ],
        }),
      ]),
    ]);
    expect(snap.allowed[0].allowedActionsMode).toBe("SomeAllowed");
    expect(snap.allowed[0].allowedActions).toEqual([
      "DeleteRow",
      "GetRows",
      "InsertRow",
    ]);
  });

  it("alphabetizes the allowed list by friendly name", () => {
    const snap = extractAcpSnapshot([
      policy([
        rule("ConnectorManagement", {
          AllowedConnectorList: [
            allowedConnector({ rawId: "/x/shared_zeta" }),
            allowedConnector({ rawId: "/x/shared_alpha" }),
            allowedConnector({ rawId: "/x/shared_bravo" }),
          ],
        }),
      ]),
    ]);
    const ids = snap.allowed.map((c) => c.id);
    // Friendly names start with the slug if unknown, so alphabetical
    // order matches the raw slug order here.
    expect(ids).toEqual(["shared_alpha", "shared_bravo", "shared_zeta"]);
  });
});

describe("diffAcpStatuses", () => {
  function snap(
    configured: boolean,
    acpOnly: boolean,
    connectors: Array<{
      id: string;
      mode?: "AllAllowed" | "SomeAllowed" | "Unknown";
      connTypes?: "AllAllowed" | "SomeAllowed" | "Unknown";
      actions?: string[];
    }>,
  ): AcpSnapshot {
    return {
      configured,
      acpOnly,
      allowed: connectors.map((c) => ({
        id: c.id,
        rawId: `/x/${c.id}`,
        name: c.id,
        allowedActionsMode: c.mode ?? "AllAllowed",
        allowedActions: c.actions ?? [],
        allowedConnectionTypesMode: c.connTypes ?? "AllAllowed",
      })),
    };
  }

  it("counts a-only, b-only, in-both and mode-changed", () => {
    const result = diffAcpStatuses(
      snap(true, false, [
        { id: "shared_a" },
        { id: "shared_b" },
        { id: "shared_c", mode: "AllAllowed" },
      ]),
      snap(true, true, [
        { id: "shared_b" },
        { id: "shared_c", mode: "SomeAllowed" },
        { id: "shared_d" },
      ]),
    );
    expect(result.summary.aOnly).toBe(1);
    expect(result.summary.bOnly).toBe(1);
    expect(result.summary.inBoth).toBe(2);
    expect(result.summary.modeChanged).toBe(1);
    expect(result.summary.totalConnectors).toBe(4);
    expect(result.summary.acpOnlySame).toBe(false);
    expect(result.summary.configuredSame).toBe(true);
  });

  it("puts differing rows ahead of matching rows", () => {
    const result = diffAcpStatuses(
      snap(true, false, [{ id: "shared_match" }, { id: "shared_aonly" }]),
      snap(true, false, [{ id: "shared_match" }, { id: "shared_bonly" }]),
    );
    const order = result.connectors.map((r) => r.id);
    // Both diff rows come first (alphabetized: aonly < bonly), then match.
    expect(order).toEqual(["shared_aonly", "shared_bonly", "shared_match"]);
  });

  it("emits null modes when a connector is absent from one side", () => {
    const result = diffAcpStatuses(
      snap(true, false, [{ id: "shared_a", mode: "AllAllowed" }]),
      snap(true, false, []),
    );
    expect(result.connectors[0].modeA).toBe("AllAllowed");
    expect(result.connectors[0].modeB).toBeNull();
    expect(result.connectors[0].membershipDiffers).toBe(true);
    expect(result.connectors[0].modeDiffers).toBe(false);
  });

  it("surfaces per-side action lists on each row", () => {
    const result = diffAcpStatuses(
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["X", "Y"] },
      ]),
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["Y", "Z"] },
      ]),
    );
    expect(result.connectors[0].actionsA).toEqual(["X", "Y"]);
    expect(result.connectors[0].actionsB).toEqual(["Y", "Z"]);
  });

  it("flags `actionsDiffer` when SomeAllowed action lists diverge", () => {
    const result = diffAcpStatuses(
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["X", "Y"] },
      ]),
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["Y", "Z"] },
      ]),
    );
    expect(result.connectors[0].actionsDiffer).toBe(true);
    expect(result.connectors[0].actionsDiff).toEqual({
      removedInB: ["X"],
      addedInB: ["Z"],
      common: ["Y"],
    });
  });

  it("flags `actionsDiffer` when mode changes from AllAllowed to SomeAllowed", () => {
    const result = diffAcpStatuses(
      snap(true, false, [{ id: "shared_a", mode: "AllAllowed" }]),
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["GetItems"] },
      ]),
    );
    expect(result.connectors[0].actionsDiffer).toBe(true);
    expect(result.connectors[0].modeDiffers).toBe(true);
  });

  it("does NOT flag `actionsDiffer` when both sides are AllAllowed", () => {
    const result = diffAcpStatuses(
      snap(true, false, [{ id: "shared_a", mode: "AllAllowed" }]),
      snap(true, false, [{ id: "shared_a", mode: "AllAllowed" }]),
    );
    expect(result.connectors[0].actionsDiffer).toBe(false);
    expect(result.connectors[0].actionsDiff).toBeNull();
  });

  it("does NOT flag `actionsDiffer` when SomeAllowed lists are identical", () => {
    const result = diffAcpStatuses(
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["A", "B"] },
      ]),
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["A", "B"] },
      ]),
    );
    expect(result.connectors[0].actionsDiffer).toBe(false);
    expect(result.connectors[0].modeDiffers).toBe(false);
  });

  it("counts `actionsChanged` in the summary", () => {
    const result = diffAcpStatuses(
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["X"] },
        { id: "shared_b", mode: "SomeAllowed", actions: ["Y"] },
      ]),
      snap(true, false, [
        { id: "shared_a", mode: "SomeAllowed", actions: ["X", "Z"] },
        { id: "shared_b", mode: "SomeAllowed", actions: ["Y"] },
      ]),
    );
    expect(result.summary.actionsChanged).toBe(1);
  });
});

describe("diffActions — pure helper", () => {
  it("returns null when either side is absent (null mode)", () => {
    expect(diffActions(null, "AllAllowed", [], [])).toBeNull();
    expect(diffActions("SomeAllowed", null, ["X"], [])).toBeNull();
  });

  it("returns null when both sides are AllAllowed", () => {
    expect(diffActions("AllAllowed", "AllAllowed", [], [])).toBeNull();
  });

  it("computes proper set diff for two SomeAllowed lists", () => {
    const result = diffActions(
      "SomeAllowed",
      "SomeAllowed",
      ["GetItems", "PostItem", "PatchItem"],
      ["GetItems", "DeleteItem", "PatchItem"],
    );
    expect(result).toEqual({
      removedInB: ["PostItem"],
      addedInB: ["DeleteItem"],
      common: ["GetItems", "PatchItem"],
    });
  });

  it("handles AllAllowed → SomeAllowed (new restrictions)", () => {
    const result = diffActions(
      "AllAllowed",
      "SomeAllowed",
      [],
      ["GetItems", "PostItem"],
    );
    expect(result).not.toBeNull();
    expect(result!.common).toEqual(["GetItems", "PostItem"]);
    expect(result!.removedInB).toEqual([]);
    expect(result!.addedInB).toEqual([]);
  });

  it("handles SomeAllowed → AllAllowed (restrictions lifted)", () => {
    const result = diffActions(
      "SomeAllowed",
      "AllAllowed",
      ["GetItems", "PostItem"],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.common).toEqual(["GetItems", "PostItem"]);
  });
});
