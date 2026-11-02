import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClausesFromSpec, buildQueryExecutionPlan, formatQueryConditionSummary,
  invalidateInventoryCache, queryConditionRoot, queryFilters, ResourceType,
  runAggregateCount, runCumulativeSeries, runTimeSeriesAggregate, validateQuerySpec,
  type QueryCondition, type QueryConditionGroup, type QuerySpec,
} from "./inventory";
import { isQuerySpec } from "./savedQueries";
import type {
  Clause, ExtendClause, ResourceItem, WhereClause,
} from "../generated/models/PowerPlatformforAdminsV2Model";

const { queryResourcesMock } = vi.hoisted(() => ({ queryResourcesMock: vi.fn() }));
vi.mock("../generated", () => ({
  PowerPlatformforAdminsV2Service: { QueryResources: queryResourcesMock },
}));

const condition = (field: string, value = "true", op = "=="): QueryCondition =>
  ({ kind: "condition", filter: { field, op, value } });
const group = (operator: "all" | "any", ...children: QueryCondition[]): QueryConditionGroup =>
  ({ kind: "group", operator, children });
const spec = (conditions?: QueryConditionGroup): QuerySpec => ({
  resourceTypes: [ResourceType.CanvasApp, ResourceType.CloudFlow], filters: [],
  conditions, orderField: "", orderDirection: "asc", limit: 100,
});
const row = (properties: Record<string, unknown>, type: string = ResourceType.CanvasApp) =>
  ({ type, properties }) as ResourceItem;

/** Deliberately small test-only KQL interpreter. It consumes emitted clause
 * expressions, not the AST, so flattening, precedence and quoting regressions
 * cannot pass by sharing the implementation's condition traversal. */
function expressionValue(expression: string, item: Record<string, unknown>): unknown {
  const tokens = expression.match(/datetime\([^)]+\)|'(?:''|[^'])*'|>=|<=|==|!=|in~|has_any|[A-Za-z_][\w.]*|-?\d+(?:\.\d+)?|[(),<>]/g) ?? [];
  let at = 0;
  const take = (token: string) => {
    if (tokens[at] !== token) throw new Error(`Expected ${token}: ${tokens.slice(at).join(" ")}`);
    at++;
  };
  const primary = (): unknown => {
    const token = tokens[at++];
    if (token === "(") {
      const value = or();
      take(")");
      return value;
    }
    if (token?.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    if (token?.startsWith("datetime(")) return Date.parse(token.slice(9, -1));
    if (token === "true" || token === "false") return token === "true";
    if (token && /^-?\d/.test(token)) return Number(token);
    if (["iif", "isnull", "array_length"].includes(token)) {
      take("(");
      const args = [or()];
      while (tokens[at] === ",") { at++; args.push(or()); }
      take(")");
      if (token === "isnull") return args[0] == null;
      if (token === "array_length") return Array.isArray(args[0]) ? args[0].length : null;
      return args[0] === true ? args[1] : args[2];
    }
    if (token === "todatetime") {
      take("(");
      const value = or();
      take(")");
      return value == null ? null : Date.parse(String(value));
    }
    if (!token) throw new Error("Missing expression");
    return token.split(".").reduce<unknown>((value, key) =>
      value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, item);
  };
  const comparison = (): unknown => {
    const left = primary();
    const operator = tokens[at];
    if (!["==", "!=", ">", "<", ">=", "<=", "in~", "has_any"].includes(operator)) return left;
    at++;
    if (operator === "in~" || operator === "has_any") {
      take("(");
      const values = [primary()];
      while (tokens[at] === ",") { at++; values.push(primary()); }
      take(")");
      if (left == null) return false;
      return values.some((value) => operator === "in~"
        ? String(left).toLowerCase() === String(value).toLowerCase()
        : String(left).toLowerCase().split(/\W+/).includes(String(value).toLowerCase()));
    }
    const right = primary();
    if (left == null || right == null) return false;
    switch (operator) {
      case "==": return left === right;
      case "!=": return left !== right;
      case ">": return (left as number) > (right as number);
      case "<": return (left as number) < (right as number);
      case ">=": return (left as number) >= (right as number);
      case "<=": return (left as number) <= (right as number);
    }
  };
  const and = (): unknown => {
    let value = comparison();
    while (tokens[at] === "and") {
      at++;
      const right = comparison();
      value = value === true && right === true;
    }
    return value;
  };
  const or = (): unknown => {
    let value = and();
    while (tokens[at] === "or") {
      at++;
      const right = and();
      value = value === true || right === true;
    }
    return value;
  };
  const result = or();
  if (at !== tokens.length) throw new Error(`Unconsumed expression: ${tokens.slice(at)}`);
  return result;
}

function execute(clauses: Clause[], input: ResourceItem): ResourceItem | undefined {
  const item = { ...input } as unknown as Record<string, unknown>;
  for (const clause of clauses) {
    if (clause.$type === "extend") {
      const { FieldName, Expression } = clause as unknown as ExtendClause;
      item[FieldName] = expressionValue(Expression, item);
    } else if (clause.$type === "where") {
      const { FieldName, Operator, Values = [] } = clause as unknown as WhereClause;
      const values = ["in~", "has_any"].includes(Operator) ? `(${Values.join(",")})` : Values[0];
      if (expressionValue(`(${FieldName}) ${Operator} ${values}`, item) !== true) return undefined;
    }
  }
  return item as unknown as ResourceItem;
}

beforeEach(() => {
  queryResourcesMock.mockReset();
  invalidateInventoryCache();
});

describe("grouped clauses — independent truth tables", () => {
  it.each(["all", "any"] as const)("preserves %s at the root and never ORs away type scope", (operator) => {
    const query = spec(group(operator, condition("properties.A"), condition("properties.B")));
    for (const A of [false, true]) for (const B of [false, true]) {
      const clauses = buildClausesFromSpec(query);
      for (const type of [ResourceType.CanvasApp, ResourceType.CloudFlow]) {
        expect(!!execute(clauses, row({ A, B }, type))).toBe(operator === "all" ? A && B : A || B);
      }
      expect(execute(clauses, row({ A, B }, ResourceType.Connector))).toBeUndefined();
    }
  });

  it("preserves A AND (B OR C) and (A AND B) OR (C AND D) for every truth assignment", () => {
    const first = spec(group("all", condition("properties.A"),
      group("any", condition("properties.B"), condition("properties.C"))));
    const second = spec(group("any",
      group("all", condition("properties.A"), condition("properties.B")),
      group("all", condition("properties.C"), condition("properties.D"))));
    for (let bits = 0; bits < 16; bits++) {
      const [A, B, C, D] = [0, 1, 2, 3].map((bit) => !!(bits & (1 << bit)));
      const item = row({ A, B, C, D });
      expect(!!execute(buildClausesFromSpec(first), item)).toBe(A && (B || C));
      expect(!!execute(buildClausesFromSpec(second), item)).toBe((A && B) || (C && D));
    }
  });

  it("does not conflate false with missing/null and keeps lists atomic on the same field", () => {
    const boolean = spec(group("any", condition("properties.flag", "false")));
    for (const properties of [{}, { flag: null }, { flag: "false" }, { flag: true }]) {
      expect(execute(buildClausesFromSpec(boolean), row(properties))).toBeUndefined();
    }
    expect(execute(buildClausesFromSpec(boolean), row({ flag: false }))).toBeDefined();
    const lists = spec(group("all",
      condition("properties.name", "A,B", "in~"),
      group("any", condition("properties.name", "B,C", "has_any"), condition("properties.other", "true"))));
    expect(execute(buildClausesFromSpec(lists), row({ name: "b" }))).toBeDefined();
    expect(execute(buildClausesFromSpec(lists), row({ name: "a" }))).toBeUndefined();
    expect(execute(buildClausesFromSpec(lists), row({ name: "c", other: true }))).toBeUndefined();
  });

  it("keeps both UTC bounds inside a single OR atom and freezes all calendar leaves", () => {
    const query = spec(group("any", condition("properties.createdAt", "", "today"),
      group("all", condition("properties.updatedAt", "", "yesterday"), condition("properties.A"))));
    const clauses = buildQueryExecutionPlan(query, new Date("2026-11-02T23:59:59Z")).clauses;
    expect(execute(clauses, row({ createdAt: "2026-11-02T00:00:00Z" }))).toBeDefined();
    expect(execute(clauses, row({ createdAt: "2026-11-03T00:00:00Z" }))).toBeUndefined();
    expect(execute(clauses, row({ updatedAt: "2026-11-01T23:59:59Z", A: true }))).toBeDefined();
    expect(execute(clauses, row({ updatedAt: "2026-11-01T23:59:59Z", A: false }))).toBeUndefined();
    const range = buildClausesFromSpec(spec(group("any",
      condition("properties.createdAt", "2026-11-01,2026-11-02", "dateRange"), condition("properties.A"))));
    expect(execute(range, row({ createdAt: "2026-10-31T23:59:59Z" }))).toBeUndefined();
    expect(execute(range, row({ createdAt: "2026-11-02T23:59:59Z" }))).toBeDefined();
    expect(execute(range, row({ createdAt: "2026-11-03T00:00:00Z" }))).toBeUndefined();
    expect(execute(range, row({ createdAt: "2026-11-03T00:00:00Z", A: true }))).toBeDefined();
  });

  it("retains byte-for-byte legacy clauses and wraps flat leaves only for the public AST helper", () => {
    const query = spec();
    delete query.conditions;
    query.filters = [{ field: "properties.name", op: "==", value: "O'Brien" }];
    expect(buildClausesFromSpec(query)).toEqual([
      { $type: "where", FieldName: "type", Operator: "in~",
        Values: ["'microsoft.powerapps/canvasapps'", "'microsoft.powerautomate/cloudflows'"] },
      { $type: "where", FieldName: "properties.name", Operator: "==", Values: ["'O''Brien'"] },
    ]);
    expect(queryConditionRoot(query)).toEqual(group("all", condition("properties.name", "O'Brien")));
    expect(queryFilters(query)).toEqual(query.filters);
  });

  it("keeps emptiness predicates distinct when sanitized auxiliary field names would collide", () => {
    const query = spec(group("any",
      condition("properties.a_b", "", "isempty"),
      condition("properties.a.b", "", "!isempty")));
    const clauses = buildClausesFromSpec(query);
    expect(clauses.some((clause) => clause.$type === "extend")).toBe(false);
    expect(execute(clauses, row({ a_b: [], a: { b: [] } }))).toBeDefined();
    expect(execute(clauses, row({ a_b: [1], a: { b: [] } }))).toBeUndefined();
    expect(execute(clauses, row({ a_b: [1], a: { b: [1] } }))).toBeDefined();
    expect(execute(clauses, row({ a_b: null }))).toBeDefined();
  });
});

describe("grouped paired execution evidence", () => {
  const paired: QueryCondition = { kind: "condition", filter: {
    field: "__operation", op: "==", value: "DeleteItem", connectorId: "sharepointonline",
  } };
  const exact = { connectors: [{ connectorId: "shared_sharepointonline", operations: ["DeleteItem"] }] };
  const cross = { connectors: [
    { connectorId: "shared_sharepointonline" }, { connectorId: "shared_sql", operations: ["DeleteItem"] },
  ] };

  it("retains ordinary B in pair A OR B, excludes cross-connector decoys, and strips only evidence", () => {
    const query = spec(group("any", paired, condition("properties.B")));
    const plan = buildQueryExecutionPlan(query);
    expect(plan.requiresClientFiltering).toBe(true);
    for (const properties of [exact, cross, { ...cross, B: true }, { ...cross, B: false }] as Record<string, unknown>[]) {
      const candidate = execute(plan.clauses, row(properties))!;
      expect(candidate).toBeDefined();
      expect(plan.matches(candidate)).toBe(properties === exact || properties.B === true);
      expect(plan.projectResult?.(candidate)).toEqual(row(properties));
      expect(Object.keys(candidate).some((key) => key.startsWith("__queryEvidence_"))).toBe(true);
    }
    expect(buildClausesFromSpec(query)).toEqual([{ $type: "where", FieldName: "1", Operator: "==", Values: ["0"] }]);
  });

  it("accepts only actual true server evidence, never string false/missing/null/raw properties", () => {
    const plan = buildQueryExecutionPlan(spec(group("any", paired, condition("properties.B"))));
    const alias = (plan.clauses.find((clause) => clause.$type === "extend") as unknown as ExtendClause).FieldName;
    for (const evidence of [false, null]) {
      expect(plan.matches({ ...row({ B: true, ...cross }), [alias]: evidence } as ResourceItem)).toBe(false);
    }
    for (const evidence of ["false", "true", 1, undefined]) {
      expect(() => plan.matches({ ...row({ B: true, ...cross }), [alias]: evidence } as ResourceItem)).toThrow(/evidence/);
    }
    expect(() => plan.matches(row({ B: true, ...cross }))).toThrow(/evidence/);
    expect(plan.matches({ ...row(cross), [alias]: true } as ResourceItem)).toBe(true);
  });

  it("preserves subgroup pairing and snapshots the AST throughout a complete drain", () => {
    const query = spec(group("any",
      group("all", structuredClone(paired), condition("properties.A")), condition("properties.B")));
    const plan = buildQueryExecutionPlan(query);
    query.conditions!.operator = "all";
    query.conditions!.children = [];
    for (const A of [false, true]) for (const B of [false, true]) for (const evidence of [exact, cross]) {
      const candidate = execute(plan.clauses, row({ ...evidence, A, B }));
      expect(candidate ? plan.matches(candidate) : false).toBe((evidence === exact && A) || B);
    }
  });

  it("protects user-referenced aliases even with a deterministic UUID and preserves properties on projection", () => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000000");
    try {
      const field = "__queryEvidence_00000000000000000000000000000000_0";
      const plan = buildQueryExecutionPlan(spec(group("any", paired, condition(field))));
      const alias = (plan.clauses.find((clause) => clause.$type === "extend") as unknown as ExtendClause).FieldName;
      expect(alias).not.toBe(field);
      const original = { ...row({ [alias]: "preserve", ...cross }), [field]: true };
      const candidate = execute(plan.clauses, original)!;
      expect(plan.matches(candidate)).toBe(true);
      expect(plan.projectResult?.(candidate)).toEqual(original);
      expect((candidate as unknown as Record<string, unknown>)[alias]).toBe(true);
    } finally {
      uuid.mockRestore();
    }
  });
});

describe("grouped import guard and summary", () => {
  it("accepts one-condition groups and empty ALL root only; rejects invalid/deeper/competing structures", () => {
    for (const root of [group("all"), group("all", condition("type", "x")), group("any", group("all", condition("type", "x")))]) {
      expect(isQuerySpec(spec(root))).toBe(true);
      expect(validateQuerySpec(spec(root))).toEqual([]);
    }
    for (const root of [group("any"), group("all", group("all")), group("any", group("any")),
      group("all", group("all", group("all", condition("type", "x")))),
      { kind: "group", operator: "xor", children: [] }, null,
      { kind: "group", operator: "all", children: [{ kind: "condition", filter: {} }] }]) {
      const query = { ...spec(), conditions: root } as QuerySpec;
      expect(isQuerySpec(query)).toBe(false);
      expect(validateQuerySpec(query).length).toBeGreaterThan(0);
      expect(() => buildQueryExecutionPlan(query)).toThrow();
    }
    const competing = spec(group("all", condition("type", "x")));
    competing.filters = [{ field: "type", op: "==", value: "y" }];
    expect(isQuerySpec(competing)).toBe(false);
    expect(validateQuerySpec(competing)).toContain("Grouped conditions cannot compete with nonempty legacy filters.");
  });

  it("rejects unsafe grouped operators without changing legacy freeform operator support", () => {
    expect(validateQuerySpec(spec(group("all", condition("properties.name", "x", "matches regex"))))[0]).toMatch(/not supported/);
    expect(validateQuerySpec({ ...spec(), filters: [{ field: "properties.name", value: "x", op: "matches regex" }] })).toEqual([]);
  });

  it("shows explicit grouping, caller field labels and exact connector pairing without scope", () => {
    const query = spec(group("all", condition("properties.A"),
      group("any", condition("properties.B"), { kind: "condition", filter: {
        field: "__operation", op: "==", value: "DeleteItem", connectorId: "sql",
      } })));
    expect(formatQueryConditionSummary(query, (field) => field.replace("properties.", "")))
      .toBe('(A == "true" AND (B == "true" OR __operation == "DeleteItem" within connector "sql"))');
  });
});

describe("all server aggregate paths keep group expressions", () => {
  it("uses equivalent grouped clauses in count, trend, cumulative delta and baseline", async () => {
    queryResourcesMock.mockResolvedValue({
      success: true, data: { data: [], totalRecords: 0 },
    });
    const query = spec(group("any", condition("properties.A"),
      group("all", condition("properties.B"), condition("properties.C"))));
    const expected = buildClausesFromSpec(query);
    await runAggregateCount(query, "type");
    await runTimeSeriesAggregate(query, "properties.createdAt", "day", 30);
    invalidateInventoryCache();
    await runCumulativeSeries(query, "properties.createdAt", "day", 30);
    expect(queryResourcesMock).toHaveBeenCalledTimes(4);
    for (const [, request] of queryResourcesMock.mock.calls) {
      expect(request.Clauses.slice(0, 2)).toEqual(expected);
    }
  });
});
