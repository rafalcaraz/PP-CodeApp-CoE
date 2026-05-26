/**
 * Unit tests for the portal action registry.
 *
 * Portal URLs are best-effort maker-portal links — silent regressions
 * here mean users hit 404s in production. These tests pin the URL
 * format for every registered portal across every supported entity
 * kind, plus the applicability rules that drive which buttons show up.
 */
import { describe, it, expect } from "vitest";
import { getPortalActions } from "./registry";
import type { PortalContext, PortalEntityKind } from "./types";

function ctx(overrides: Partial<PortalContext>): PortalContext {
  return {
    entityKind: "environment",
    entityId: "00000000-0000-0000-0000-000000000001",
    environmentId: "00000000-0000-0000-0000-000000000002",
    ...overrides,
  };
}

function kinds(actions: ReturnType<typeof getPortalActions>): string[] {
  return actions.map((a) => a.kind);
}

describe("agent entity", () => {
  it("returns the Copilot Studio link only", () => {
    const actions = getPortalActions(
      ctx({ entityKind: "agent", entityId: "bot-1", environmentId: "env-1" }),
    );
    expect(kinds(actions)).toEqual(["copilotStudio"]);
    expect(actions[0].url).toBe(
      "https://copilotstudio.microsoft.com/environments/env-1/bots/bot-1/overview",
    );
  });

  it("omits the Copilot Studio link if environmentId is missing", () => {
    const actions = getPortalActions(
      ctx({ entityKind: "agent", entityId: "bot-1", environmentId: undefined }),
    );
    expect(actions).toEqual([]);
  });

  it("URL-encodes entity and environment ids", () => {
    const actions = getPortalActions(
      ctx({
        entityKind: "agent",
        entityId: "bot id",
        environmentId: "env id",
      }),
    );
    expect(actions[0].url).toContain("bot%20id");
    expect(actions[0].url).toContain("env%20id");
  });
});

describe("environment entity", () => {
  it("returns PPAC, Power Apps, Power Automate, and MCS credits", () => {
    const actions = getPortalActions(
      ctx({
        entityKind: "environment",
        entityId: "env-1",
        environmentId: "env-1",
      }),
    );
    expect(kinds(actions)).toEqual([
      "ppac",
      "powerAppsMaker",
      "powerAutomateMaker",
      "ppacMcsCredits",
    ]);
    expect(actions[0].url).toBe(
      "https://admin.powerplatform.microsoft.com/manage/environments/environment/env-1/hub",
    );
    expect(actions[1].url).toBe(
      "https://make.powerapps.com/environments/env-1/apps",
    );
    expect(actions[2].url).toBe(
      "https://make.powerautomate.com/environments/env-1/flows",
    );
    expect(actions[3].url).toContain(
      "admin.preview.powerplatform.microsoft.com/billing/licenses/CopilotStudio",
    );
  });

  it("uses the friendlier `Open apps/flows in ...` labels", () => {
    const actions = getPortalActions(
      ctx({
        entityKind: "environment",
        entityId: "env-1",
        environmentId: "env-1",
      }),
    );
    const labels = Object.fromEntries(actions.map((a) => [a.kind, a.label]));
    expect(labels.powerAppsMaker).toBe("Open apps in Power Apps");
    expect(labels.powerAutomateMaker).toBe("Open flows in Power Automate");
  });
});

describe("environment group entity", () => {
  it("returns just the PPAC env-groups page", () => {
    const actions = getPortalActions(
      ctx({
        entityKind: "environmentGroup",
        entityId: "grp-1",
        environmentId: undefined,
      }),
    );
    expect(kinds(actions)).toEqual(["ppac"]);
    expect(actions[0].url).toBe(
      "https://admin.powerplatform.microsoft.com/manage/envgroups/grp-1/details",
    );
    expect(actions[0].label).toBe("Open group in admin center");
  });
});

describe("canvas app entity", () => {
  it("uses the canvas-specific URL path", () => {
    const actions = getPortalActions(
      ctx({
        entityKind: "canvasApp",
        entityId: "app-1",
        environmentId: "env-1",
      }),
    );
    expect(kinds(actions)).toEqual(["powerAppsMaker"]);
    expect(actions[0].url).toBe(
      "https://make.powerapps.com/environments/env-1/canvas/canvasapps/app-1/details",
    );
  });
});

describe("model-driven, code, app-builder apps", () => {
  const kindsToTest: PortalEntityKind[] = [
    "modelDrivenApp",
    "codeApp",
    "appBuilderApp",
  ];

  for (const k of kindsToTest) {
    it(`uses the generic /apps/{id} URL for ${k}`, () => {
      const actions = getPortalActions(
        ctx({ entityKind: k, entityId: "app-1", environmentId: "env-1" }),
      );
      expect(actions[0].url).toBe(
        "https://make.powerapps.com/environments/env-1/apps/app-1",
      );
    });
  }
});

describe("flow kinds", () => {
  for (const k of [
    "cloudFlow",
    "agentFlow",
    "workflowAgentFlow",
  ] as PortalEntityKind[]) {
    it(`builds a Power Automate maker URL for ${k}`, () => {
      const actions = getPortalActions(
        ctx({ entityKind: k, entityId: "flow-1", environmentId: "env-1" }),
      );
      expect(actions[0].url).toBe(
        "https://make.powerautomate.com/environments/env-1/flows/flow-1/details",
      );
    });
  }

  it("omits the Power Automate link if environmentId is missing", () => {
    const actions = getPortalActions(
      ctx({
        entityKind: "cloudFlow",
        entityId: "flow-1",
        environmentId: undefined,
      }),
    );
    expect(actions).toEqual([]);
  });
});

describe("registry order", () => {
  it("returns actions in the order defined by PORTAL_REGISTRY", () => {
    // The environment entity sees all 4 portals; their order must be
    // stable so the toolbar layout doesn't shift between commits.
    const actions = getPortalActions(
      ctx({
        entityKind: "environment",
        entityId: "env-1",
        environmentId: "env-1",
      }),
    );
    expect(kinds(actions)).toEqual([
      "ppac",
      "powerAppsMaker",
      "powerAutomateMaker",
      "ppacMcsCredits",
    ]);
  });
});
