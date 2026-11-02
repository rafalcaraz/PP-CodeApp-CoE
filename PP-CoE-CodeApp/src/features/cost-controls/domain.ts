import type { Quantity } from "../../generated/models/CostControsl_CustomConnModel";

export const numberText = (value: number | undefined) => value === undefined || !Number.isFinite(value)
  ? "Not reported" : value.toLocaleString(undefined, { maximumFractionDigits: 20 });

export function quantityText(quantity?: Quantity): string {
  if (!quantity) return "Not reported";
  if (quantity["@odata.type"] === "#microsoft.graph.unlimitedCostManagementQuantity") return `Unlimited (${quantity.unit})`;
  return `${numberText(quantity.value)} ${quantity.unit}`;
}

export function makeQuantity(value: string, unlimited: boolean): Quantity {
  if (unlimited) return { "@odata.type": "#microsoft.graph.unlimitedCostManagementQuantity", unit: "copilotCredit" };
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number)) throw new Error("Enter a finite credit limit, or choose unlimited.");
  return { "@odata.type": "#microsoft.graph.limitedCostManagementQuantity", unit: "copilotCredit", value: number };
}

export function freshness(value?: string): string {
  if (!value) return "Source time not reported";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? `Source time: ${value}` : `Source updated ${parsed.toLocaleString()}`;
}
