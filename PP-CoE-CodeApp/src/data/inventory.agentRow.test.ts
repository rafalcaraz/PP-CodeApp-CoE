import { describe, expect, it } from "vitest";

import { toAgentRow } from "./inventory";

describe("toAgentRow boolean normalization", () => {
  it.each([null, undefined])("preserves unavailable isManaged (%s) as null", (isManaged) => {
    expect(toAgentRow({ properties: { isManaged } }).isManaged).toBeNull();
  });

  it.each([true, false])("preserves explicit managed status %s", (isManaged) => {
    expect(toAgentRow({ properties: { isManaged } }).isManaged).toBe(isManaged);
  });

  it("maps the current identity, harness, and quarantine fields", () => {
    const properties = {
      botId: "bot-1",
      entraAgentId: "identity-1",
      entraAgentBlueprintId: "blueprint-1",
      harness: "Standard",
      quarantinedAt: "2026-10-01T10:00:00Z",
    };
    expect(toAgentRow({ properties })).toMatchObject(properties);
  });

  it("keeps older payloads usable when the new fields are absent", () => {
    expect(toAgentRow({ properties: {} })).toMatchObject({
      botId: "",
      entraAgentId: "",
      entraAgentBlueprintId: "",
      harness: "",
      quarantinedAt: "",
      isManaged: null,
    });
  });

  it("accepts case variants and string booleans from Inventory API payloads", () => {
    const row = toAgentRow({
      name: "agent-1",
      type: "microsoft.copilotstudio/agents",
      properties: {
        displayName: "Agent One",
        isCliAgent: "true",
        isManaged: "false",
        isQuarantined: { Value: true },
      },
    } as never);

    expect(row.isCLIAgent).toBe(true);
    expect(row.isManaged).toBe(false);
    expect(row.isQuarantined).toBe(true);
  });
});
