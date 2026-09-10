import { describe, expect, it } from "vitest";

import { toAgentRow } from "./inventory";

describe("toAgentRow boolean normalization", () => {
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
