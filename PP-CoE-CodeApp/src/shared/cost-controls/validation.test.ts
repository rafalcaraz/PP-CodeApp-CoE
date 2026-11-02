import { describe, expect, it } from "vitest";
import { validateCostBody } from "./validation";

const limited = "#microsoft.graph.limitedCostManagementQuantity";
const unlimited = "#microsoft.graph.unlimitedCostManagementQuantity";
const percentage = "#microsoft.graph.percentageCostManagementAlertThreshold";
const absolute = "#microsoft.graph.absoluteCostManagementAlertThreshold";

describe("shared Cost Controls body invariants", () => {
  it.each([0, -1, 0.0001, 100])("preserves finite quantity %s without undocumented bounds", (value) => {
    expect(() => validateCostBody({ "@odata.type": limited, value })).not.toThrow();
  });
  it.each([undefined, null, "1", NaN, Infinity])("rejects nonfinite or missing limited value %s", (value) => {
    expect(() => validateCostBody({ periodLimit: { "@odata.type": limited, value } })).toThrow(/body.periodLimit.value/);
  });
  it("requires unlimited values to be omitted, not zero or null", () => {
    expect(() => validateCostBody({ "@odata.type": unlimited })).not.toThrow();
    for (const value of [0, null, undefined]) {
      expect(() => validateCostBody({ "@odata.type": unlimited, value })).toThrow(/must be omitted/);
    }
  });
  it.each([0, 101, 1.5, NaN, Infinity])("rejects invalid percentage %s", (value) => {
    expect(() => validateCostBody({ thresholds: [{ "@odata.type": percentage, value }] })).toThrow(/body.thresholds\[0\].value/);
  });
  it("allows percentage endpoints but disallows percentage units", () => {
    for (const value of [1, 100]) expect(() => validateCostBody({ "@odata.type": percentage, value })).not.toThrow();
    expect(() => validateCostBody({ "@odata.type": percentage, value: 50, unit: "copilotCredit" })).toThrow(/unit must be omitted/);
  });
  it.each([0, -1, NaN, Infinity])("rejects nonpositive/nonfinite absolute value %s", (value) => {
    expect(() => validateCostBody({ "@odata.type": absolute, value, unit: "copilotCredit" })).toThrow(/positive value/);
  });
  it("requires absolute units and preserves omitted thresholds versus clearing", () => {
    expect(() => validateCostBody({ "@odata.type": absolute, value: 0.0001, unit: "copilotCredit" })).not.toThrow();
    expect(() => validateCostBody({ "@odata.type": absolute, value: 1, unit: "" })).toThrow(/unit/);
    expect(() => validateCostBody({ isEnabled: false })).not.toThrow();
    expect(() => validateCostBody({ thresholds: [] })).not.toThrow();
  });
});
