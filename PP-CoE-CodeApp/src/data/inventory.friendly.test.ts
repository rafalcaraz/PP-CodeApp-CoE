import { describe, it, expect } from "vitest";
import {
  friendlyResourceType,
  shortResourceType,
  resourceTypeShort,
  friendlyConnectorName,
  friendlyFilterField,
  isSentinelField,
  CONNECTOR_FIELD,
  OPERATION_FIELD,
  ResourceType,
} from "./inventory";

describe("friendlyResourceType", () => {
  it("returns a human label for each known resource type", () => {
    expect(friendlyResourceType(ResourceType.CanvasApp)).toMatch(/canvas/i);
    expect(friendlyResourceType(ResourceType.CloudFlow)).toMatch(/flow/i);
    expect(friendlyResourceType(ResourceType.CopilotStudioAgent)).toMatch(
      /agent|copilot/i,
    );
    expect(friendlyResourceType(ResourceType.Environment)).toMatch(
      /environment/i,
    );
  });

  it("falls back to the input string for unknown types", () => {
    expect(friendlyResourceType("microsoft.unknown/foo")).toContain("unknown");
  });

  it("names all app families without conflating managed and App Builder apps", () => {
    expect(friendlyResourceType(ResourceType.CodeApp)).toBe("Code and vibe apps");
    expect(friendlyResourceType(ResourceType.AppBuilderApp)).toBe("Managed and App Builder apps");
  });
});

describe("shortResourceType / resourceTypeShort", () => {
  it.each([
    [ResourceType.CodeApp, "byocApp", "Code app"],
    [ResourceType.CodeApp, "vibeApp", "Vibe app"],
    [ResourceType.AppBuilderApp, "microsoftApp", "Managed app"],
    [ResourceType.AppBuilderApp, "appBuilderApp", "App Builder app"],
    [ResourceType.AppBuilderApp, undefined, "App"],
  ])("labels %s / %s as %s", (type, subType, label) => {
    expect(shortResourceType(type, subType)).toBe(label);
  });

  it("returns a short token for canvas apps", () => {
    expect(shortResourceType(ResourceType.CanvasApp).toLowerCase()).toContain(
      "canvas",
    );
    expect(resourceTypeShort(ResourceType.CanvasApp)).toBe(
      shortResourceType(ResourceType.CanvasApp),
    );
  });

  it("returns a short token for agents", () => {
    expect(
      shortResourceType(ResourceType.CopilotStudioAgent).toLowerCase(),
    ).toMatch(/agent/);
  });

  it("uses inclusive labels for resource-type selectors", () => {
    expect(resourceTypeShort(ResourceType.CodeApp)).toBe("Code / vibe");
    expect(resourceTypeShort(ResourceType.AppBuilderApp)).toBe("Managed / App Builder");
  });
});

describe("friendlyConnectorName", () => {
  it("returns a human name for known connectors", () => {
    // shared_sharepointonline → SharePoint, etc. Don't pin the exact string
    // (it can be tuned over time); just check we don't return the raw ID.
    expect(friendlyConnectorName("shared_sharepointonline")).not.toBe(
      "shared_sharepointonline",
    );
    expect(friendlyConnectorName("shared_sharepointonline")).toMatch(/share/i);
  });

  it("falls back to a cleaned-up version of the ID for unknown connectors", () => {
    const result = friendlyConnectorName("shared_someverynew");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("sentinel field helpers", () => {
  it("isSentinelField recognizes both sentinels", () => {
    expect(isSentinelField(CONNECTOR_FIELD)).toBe(true);
    expect(isSentinelField(OPERATION_FIELD)).toBe(true);
    expect(isSentinelField("type")).toBe(false);
    expect(isSentinelField("properties.displayName")).toBe(false);
  });

  it("friendlyFilterField labels sentinels and passes other fields through", () => {
    expect(friendlyFilterField(CONNECTOR_FIELD)).toMatch(/connector/i);
    expect(friendlyFilterField(OPERATION_FIELD)).toMatch(/operation/i);
    expect(friendlyFilterField("properties.displayName")).toBe(
      "properties.displayName",
    );
  });
});
