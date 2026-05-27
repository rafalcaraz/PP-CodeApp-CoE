/**
 * Unit tests for the filter evaluator.
 */
import { describe, it, expect } from "vitest";
import { evaluateFilter } from "./filter";
import { flatten } from "./catalog/flatten";

function eval0(payload: unknown, path: string, op: string, value?: unknown): boolean {
  return evaluateFilter(flatten(payload), {
    path,
    op: op as never,
    value,
  });
}

describe("evaluateFilter", () => {
  const sample = {
    properties: {
      embeddedApp: { type: "SharepointFormApp" },
      usesPremiumApi: false,
      sharedUsersCount: 42,
      appPlanClassification: "Premium",
    },
  };

  it("eq is case-insensitive on strings", () => {
    expect(eval0(sample, "properties.embeddedApp.type", "eq", "sharepointformapp")).toBe(true);
    expect(eval0(sample, "properties.embeddedApp.type", "eq", "TeamsApp")).toBe(false);
  });

  it("ne is the negation of eq", () => {
    expect(eval0(sample, "properties.embeddedApp.type", "ne", "TeamsApp")).toBe(true);
    expect(eval0(sample, "properties.embeddedApp.type", "ne", "SharepointFormApp")).toBe(false);
  });

  it("in matches against array values", () => {
    expect(eval0(sample, "properties.appPlanClassification", "in", ["Standard", "Premium"])).toBe(true);
    expect(eval0(sample, "properties.appPlanClassification", "in", ["Standard"])).toBe(false);
  });

  it("boolean eq accepts true/false primitives", () => {
    expect(eval0(sample, "properties.usesPremiumApi", "eq", false)).toBe(true);
    expect(eval0(sample, "properties.usesPremiumApi", "eq", true)).toBe(false);
  });

  it("contains is substring match (case-insensitive)", () => {
    expect(eval0(sample, "properties.embeddedApp.type", "contains", "FORM")).toBe(true);
    expect(eval0(sample, "properties.embeddedApp.type", "contains", "Teams")).toBe(false);
  });

  it("startsWith and endsWith", () => {
    expect(eval0(sample, "properties.embeddedApp.type", "startsWith", "Share")).toBe(true);
    expect(eval0(sample, "properties.embeddedApp.type", "endsWith", "App")).toBe(true);
    expect(eval0(sample, "properties.embeddedApp.type", "endsWith", "Teams")).toBe(false);
  });

  it("numeric ops compare numerically", () => {
    expect(eval0(sample, "properties.sharedUsersCount", "gt", 10)).toBe(true);
    expect(eval0(sample, "properties.sharedUsersCount", "lt", 10)).toBe(false);
    expect(eval0(sample, "properties.sharedUsersCount", "gte", 42)).toBe(true);
    expect(eval0(sample, "properties.sharedUsersCount", "lte", 41)).toBe(false);
  });

  it("exists and notExists ignore the value", () => {
    expect(eval0(sample, "properties.embeddedApp.type", "exists")).toBe(true);
    expect(eval0(sample, "properties.missing", "exists")).toBe(false);
    expect(eval0(sample, "properties.missing", "notExists")).toBe(true);
    expect(eval0(sample, "properties.embeddedApp.type", "notExists")).toBe(false);
  });

  it("missing values always fail non-existence checks", () => {
    expect(eval0(sample, "properties.missing", "eq", "anything")).toBe(false);
    expect(eval0(sample, "properties.missing", "contains", "x")).toBe(false);
  });
});
