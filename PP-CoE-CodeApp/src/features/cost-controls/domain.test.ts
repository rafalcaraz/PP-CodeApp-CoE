import { describe, expect, it } from "vitest";
import { freshness, makeQuantity, numberText, quantityText } from "./domain";

describe("honest credit presentation", () => {
  it("keeps zero, missing, and unlimited distinct", () => {
    expect(numberText(0)).toBe("0");
    expect(numberText(undefined)).toBe("Not reported");
    expect(numberText(NaN)).toBe("Not reported");
    expect(numberText(Infinity)).toBe("Not reported");
    expect(quantityText()).toBe("Not reported");
    expect(quantityText(makeQuantity("0", false))).toBe("0 copilotCredit");
    expect(quantityText(makeQuantity("", true))).toBe("Unlimited (copilotCredit)");
    expect(makeQuantity("arbitrary ignored input", true)).not.toHaveProperty("value");
  });
  it.each(["", " ", "abc", "Infinity", "NaN"])("rejects a nonnumeric limited quantity: %s", (value) => {
    expect(() => makeQuantity(value, false)).toThrow(/finite/);
  });
  it("preserves finite quantities without inventing undocumented API bounds", () => {
    expect(makeQuantity("-1", false).value).toBe(-1);
    expect(makeQuantity("0.125", false).value).toBe(0.125);
  });
  it("uses source time, never fabricates a request timestamp", () => {
    expect(freshness()).toBe("Source time not reported");
    expect(freshness("unknown-time")).toBe("Source time: unknown-time");
    expect(freshness("2026-01-01T00:00:00Z")).toContain("Source updated");
  });
});
