import { isJsonObject } from "../api-explorer/schema";

export function validateCostBody(body: unknown, path = "body"): void {
  if (Array.isArray(body)) {
    body.forEach((value, index) => validateCostBody(value, `${path}[${index}]`));
    return;
  }
  if (!isJsonObject(body)) return;
  const type = body["@odata.type"];
  if (type === "#microsoft.graph.limitedCostManagementQuantity" && (typeof body.value !== "number" || !Number.isFinite(body.value))) {
    throw new Error(`${path}.value is required for a limited quantity; zero is a finite limit.`);
  }
  if (type === "#microsoft.graph.unlimitedCostManagementQuantity" && Object.hasOwn(body, "value")) {
    throw new Error(`${path}.value must be omitted for an unlimited quantity.`);
  }
  if (type === "#microsoft.graph.percentageCostManagementAlertThreshold") {
    if (typeof body.value !== "number" || !Number.isInteger(body.value) || body.value < 1 || body.value > 100) {
      throw new Error(`${path}.value must be an integer from 1 to 100 for a percentage threshold.`);
    }
    if (Object.hasOwn(body, "unit")) throw new Error(`${path}.unit must be omitted for a percentage threshold.`);
  }
  if (type === "#microsoft.graph.absoluteCostManagementAlertThreshold" && (
    typeof body.value !== "number" || !Number.isFinite(body.value) || body.value <= 0 || typeof body.unit !== "string" || !body.unit.trim()
  )) throw new Error(`${path}: an absolute threshold needs a positive value and a unit matching the policy limit.`);
  for (const [name, value] of Object.entries(body)) validateCostBody(value, `${path}.${name}`);
}
