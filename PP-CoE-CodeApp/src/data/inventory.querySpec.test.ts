import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildClausesFromSpec,
  buildQueryExecutionPlan,
  validateQuerySpec,
  queryFilterNeedsValue,
  runAggregateCount,
  runTimeSeriesAggregate,
  runCumulativeSeries,
  CONNECTOR_USAGE_RESOURCE_TYPES,
  CONNECTOR_FIELD,
  DEFAULT_QUERY_RESOURCE_TYPES,
  OPERATION_FIELD,
  ResourceType,
  type QuerySpec,
  type ResourceTypeValue,
} from "./inventory";
import type { ResourceItem } from "../generated/models/PowerPlatformforAdminsV2Model";

// buildClausesFromSpec is the user-facing query-builder translator
// (see views/QueriesView.tsx). Its job: take a QuerySpec → emit a list
// of clauses ready for runQuery. Subtle changes here can silently
// turn correct filters into KQL parse errors or empty results, so
// these tests pin the most important translations.

function spec(overrides: Partial<QuerySpec> = {}): QuerySpec {
  return {
    resourceTypes: [],
    filters: [],
    orderField: "",
    orderDirection: "desc",
    limit: 500,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("UTC calendar filters and validation", () => {
  const dateSpec = (op: string, value = "") => spec({
    filters: [{ field: "properties.createdAt", op, value }],
  });
  const windows = (op: string, value = "") => buildQueryExecutionPlan(dateSpec(op, value), new Date()).clauses.slice(1);
  const window = (start: string, end: string) => [
    { $type: "where", FieldName: "todatetime(properties.createdAt)", Operator: ">=", Values: [`datetime(${start}T00:00:00.000Z)`] },
    { $type: "where", FieldName: "todatetime(properties.createdAt)", Operator: "<", Values: [`datetime(${end}T00:00:00.000Z)`] },
  ];

  it.each([
    ["2026-01-01T00:00:00.000Z", "2026-01-01", "2026-01-02", "2025-12-31"],
    ["2026-03-01T23:59:59.999Z", "2026-03-01", "2026-03-02", "2026-02-28"],
    ["2024-03-01T00:00:00.000Z", "2024-03-01", "2024-03-02", "2024-02-29"],
    ["2026-03-08T01:59:00-08:00", "2026-03-08", "2026-03-09", "2026-03-07"],
    ["2026-11-01T01:59:00-07:00", "2026-11-01", "2026-11-02", "2026-10-31"],
    ["2026-12-31T23:59:59.999Z", "2026-12-31", "2027-01-01", "2026-12-30"],
  ])("uses UTC midnight/month/year/DST boundaries at %s", (now, today, tomorrow, yesterday) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    expect(windows("today")).toEqual(window(today, tomorrow));
    expect(windows("yesterday")).toEqual(window(yesterday, today));
  });

  it("rebuilds relative calendar windows after UTC midnight and keeps rolling ago durations", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T23:59:59.999Z"));
    expect(windows("today")).toEqual(window("2026-06-30", "2026-07-01"));
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    expect(windows("today")).toEqual(window("2026-07-01", "2026-07-02"));
    expect(buildClausesFromSpec(dateSpec("lastNdays", "7")).slice(1)).toEqual([
      { $type: "where", FieldName: "properties.createdAt", Operator: ">", Values: ["ago(7d)"] },
    ]);
  });

  it("keeps relative tile clauses dynamic but freezes all Run boundaries to the supplied instant", () => {
    const query = spec({ filters: [
      { field: "properties.createdAt", op: "lastNdays", value: "7" },
      { field: "properties.lastModifiedAt", op: "today", value: "" },
    ] });
    const reference = new Date("2026-03-08T23:59:59.999Z");
    const plan = buildQueryExecutionPlan(query, reference);
    // Rolling filters retain their legacy lower-bound-only semantics.
    expect(plan.clauses).toHaveLength(4);
    expect(plan.clauses[1]).toMatchObject({ Values: ["datetime(2026-03-01T23:59:59.999Z)"] });
    expect(plan.clauses[2]).toMatchObject({ Values: ["datetime(2026-03-08T00:00:00.000Z)"] });
    expect(plan.clauses[3]).toMatchObject({ Values: ["datetime(2026-03-09T00:00:00.000Z)"] });
    reference.setUTCDate(9);
    expect(plan.clauses[2]).toMatchObject({ Values: ["datetime(2026-03-08T00:00:00.000Z)"] });
    expect(buildQueryExecutionPlan(query, reference).clauses[2]).toMatchObject({ Values: ["datetime(2026-03-09T00:00:00.000Z)"] });
    expect(buildClausesFromSpec(query)[1]).toMatchObject({ Values: ["ago(7d)"] });
    expect(buildClausesFromSpec(query)[2]).toMatchObject({ Values: ["startofday(now())"] });
    expect(buildClausesFromSpec(query)[3]).toMatchObject({ Values: ["startofday(now(), 1)"] });
    expect(buildClausesFromSpec(dateSpec("yesterday"))[1]).toMatchObject({ Values: ["startofday(now(), -1)"] });
    expect(() => buildQueryExecutionPlan(query, new Date("invalid"))).toThrow("valid Date");
  });

  it("never consults local-calendar getters, independent of host timezone or DST rules", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T00:30:00+14:00"));
    for (const getter of ["getFullYear", "getMonth", "getDate"] as const) {
      vi.spyOn(Date.prototype, getter).mockImplementation(() => { throw new Error("Local calendar access"); });
    }
    expect(windows("today")).toEqual(window("2026-03-08", "2026-03-09"));
    expect(windows("yesterday")).toEqual(window("2026-03-07", "2026-03-08"));
  });

  it("supports absolute days and inclusive visible date ranges as half-open windows", () => {
    expect(windows("onDate", "2024-02-29")).toEqual(window("2024-02-29", "2024-03-01"));
    expect(windows("dateRange", "2025-12-31, 2026-01-02")).toEqual(window("2025-12-31", "2026-01-03"));
    expect(windows("dateRange", "2026-03-08,2026-03-08")).toEqual(window("2026-03-08", "2026-03-09"));
  });

  it.each([
    ["lastNdays", ""], ["lastNdays", "0"], ["lastNdays", "-2"], ["lastNdays", "1.5"],
    ["lastNdays", "NaN"], ["lastNdays", "Infinity"], ["lastNdays", "9007199254740992"],
    ["onDate", "2026-02-29"], ["onDate", "2026-04-31"], ["onDate", "2026-2-01"],
    ["onDate", "2026-01-01T12:00:00Z"], ["dateRange", "2026-01-02,2026-01-01"],
    ["dateRange", "2026-01-01,"], ["dateRange", "2026-01-01,2026-01-02,2026-01-03"],
    ["==", ""], ["in~", ", ,"], ["has_any", ",,"],
  ])("reports invalid %s value %j and fails closed", (op, value) => {
    expect(validateQuerySpec(dateSpec(op, value)).length).toBeGreaterThan(0);
    expect(buildClausesFromSpec(dateSpec(op, value))).toEqual([
      { $type: "where", FieldName: "1", Operator: "==", Values: ["0"] },
    ]);
  });

  it("allows value-free operators and preserves freeform fields/operators", () => {
    for (const op of ["today", "yesterday", "isempty", "!isempty"]) {
      expect(queryFilterNeedsValue(op)).toBe(false);
      expect(validateQuerySpec(dateSpec(op))).toEqual([]);
    }
    const freeform = spec({ filters: [{ field: "properties.futureField", op: "matches regex", value: "^legacy" }] });
    expect(validateQuerySpec(freeform)).toEqual([]);
    expect(buildClausesFromSpec(freeform)[1]).toMatchObject({ Operator: "matches regex", Values: ["'^legacy'"] });
  });
});

describe("connector-paired query execution", () => {
  const paired = (overrides = {}) => spec({ filters: [{
    field: OPERATION_FIELD, op: "==", value: "DeleteItem", connectorId: "sharepointonline", ...overrides,
  }] });
  const item = (properties: Record<string, unknown>, type: ResourceTypeValue = ResourceType.CloudFlow) =>
    ({ properties, type }) as ResourceItem;

  it("never exposes paired filters as independent raw clauses and requires a complete drain", () => {
    const plan = buildQueryExecutionPlan(paired());
    expect(plan.requiresClientFiltering).toBe(true);
    expect(plan.clauses).toEqual(buildClausesFromSpec(spec()));
    expect(buildClausesFromSpec(paired())).toEqual([{ $type: "where", FieldName: "1", Operator: "==", Values: ["0"] }]);
  });

  it("rejects cross-connector IDs, references, partial operation names, and serialized text decoys", () => {
    const { matches } = buildQueryExecutionPlan(paired());
    for (const properties of [
      { powerPlatformConnectors: [{ connectorId: "shared_sharepointonline" }, { connectorId: "shared_sql", operations: [{ operationId: "DeleteItem" }] }] },
      { connectors: [{ connectorId: "shared_sharepointonline", description: '{"operationId":"DeleteItem"}' }] },
      { connectors: [{ connectorId: "shared_sharepointonline", operations: ["DeleteItems"] }] },
    ]) expect(matches(item(properties))).toBe(false);
  });

  it("normalizes ARM/shared-prefix/case and accepts both arrays and operation schema forms", () => {
    const plan = buildQueryExecutionPlan(paired());
    expect(plan.matches(item({ connectors: [{ connectorId: "/providers/Microsoft.PowerApps/apis/SHARED_SHAREPOINTONLINE", operations: [{ operationId: "deleteITEM", isEnabled: false }] }] }))).toBe(true);
    expect(plan.matches(item({ powerPlatformConnectors: [], connectors: [{ id: "sharepointonline", operations: ["DELETEITEM"] }] }))).toBe(true);
  });

  it.each([
    { trigger: "SHARED_SHAREPOINTONLINE", triggerOperation: "deleteitem" },
    { trigger: { connectorId: "/providers/Microsoft.PowerApps/apis/sharepointonline", operationId: "DeleteItem" } },
  ])("pairs modern/legacy flow triggers only with their connector", (properties) => {
    expect(buildQueryExecutionPlan(paired()).matches(item(properties))).toBe(true);
    expect(buildQueryExecutionPlan(paired({ connectorId: "sql" })).matches(item(properties))).toBe(false);
    expect(buildQueryExecutionPlan(paired()).matches(item(properties, ResourceType.CopilotStudioAgent))).toBe(false);
  });

  it("supports exact any-list, negative pairing, multiple pairs AND, and legacy independent filters", () => {
    const resource = item({ connectors: [{ connectorId: "sharepointonline", operations: ["GetItems"] }] });
    expect(buildQueryExecutionPlan(paired({ op: "in~", value: "DeleteItem,GETITEMS" })).matches(resource)).toBe(true);
    expect(buildQueryExecutionPlan(paired({ op: "!=", value: "DeleteItem" })).matches(resource)).toBe(true);
    const both = paired({ value: "GetItems" });
    both.filters.push({ field: OPERATION_FIELD, op: "==", value: "SendEmail", connectorId: "office365" });
    expect(buildQueryExecutionPlan(both).matches(resource)).toBe(false);
    const legacy = paired();
    delete legacy.filters[0].connectorId;
    expect(buildQueryExecutionPlan(legacy).requiresClientFiltering).toBe(false);
    expect(buildClausesFromSpec(legacy)).toHaveLength(3);
  });

  it("snapshots paired filters so subsequent builder edits cannot alter an in-flight drain", () => {
    const query = paired();
    const plan = buildQueryExecutionPlan(query);
    query.filters[0].connectorId = "sql";
    query.filters[0].value = "GetRows";
    expect(plan.matches(item({ connectors: [{ connectorId: "sharepointonline", operations: ["DeleteItem"] }] }))).toBe(true);
  });

  it("validates malformed pairs and rejects paired server aggregates without calling the connector", async () => {
    expect(validateQuerySpec(paired({ connectorId: "" })).length).toBeGreaterThan(0);
    expect(validateQuerySpec(paired({ field: "properties.foo" })).length).toBeGreaterThan(0);
    expect(validateQuerySpec(paired({ op: "contains" })).length).toBeGreaterThan(0);
    for (const result of await Promise.all([
      runAggregateCount(paired(), "type"),
      runTimeSeriesAggregate(paired(), "properties.createdAt", "day", 90),
      runCumulativeSeries(paired(), "properties.createdAt", "day", 90),
    ])) expect(result).toMatchObject({ ok: false, error: expect.stringContaining("complete client-filtered drain") });
  });
});

describe("buildClausesFromSpec — resource-type clause", () => {
  it("emits the stable reportable scope when no resourceTypes are selected", () => {
    const clauses = buildClausesFromSpec(spec()) as unknown as Array<Record<string, unknown>>;
    expect(clauses[0]).toEqual({
      $type: "where",
      FieldName: "type",
      Operator: "in~",
      Values: DEFAULT_QUERY_RESOURCE_TYPES.map((t) => `'${t}'`),
    });

    expect(
      (clauses[0] as { Values: string[] }).Values,
    ).not.toContain(`'${ResourceType.Connector}'`);
  });

  it("emits a single-value == clause when exactly one type is selected", () => {
    const clauses = buildClausesFromSpec(
      spec({ resourceTypes: [ResourceType.CanvasApp] }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find((c) => c.$type === "where") as
      | { FieldName: string; Operator: string; Values: string[] }
      | undefined;
    expect(whereClause).toEqual({
      $type: "where",
      FieldName: "type",
      Operator: "==",
      Values: [`'${ResourceType.CanvasApp}'`],
    });
  });

  it("emits an in~ clause for multiple resource types", () => {
    const clauses = buildClausesFromSpec(
      spec({
        resourceTypes: [ResourceType.CanvasApp, ResourceType.CloudFlow],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find((c) => c.$type === "where") as
      | { Operator: string; Values: string[] }
      | undefined;
    expect(whereClause?.Operator).toBe("in~");
    expect(whereClause?.Values).toEqual([
      `'${ResourceType.CanvasApp}'`,
      `'${ResourceType.CloudFlow}'`,
    ]);
  });
});

describe("inventory resource universes", () => {
  it("keeps connector usage analysis on the documented usage-bearing types", () => {
    expect(CONNECTOR_USAGE_RESOURCE_TYPES).toEqual([
      ResourceType.CanvasApp,
      ResourceType.ModelDrivenApp,
      ResourceType.CodeApp,
      ResourceType.AppBuilderApp,
      ResourceType.CloudFlow,
      ResourceType.AgentFlow,
      ResourceType.WorkflowAgentFlow,
      ResourceType.CopilotStudioAgent,
    ]);
    expect(CONNECTOR_USAGE_RESOURCE_TYPES).not.toContain(ResourceType.Connector);
  });
});

describe("buildClausesFromSpec — filter value formatting", () => {
  it("single-quotes plain string values", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [{ field: "properties.displayName", op: "==", value: "MyApp" }],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "properties.displayName",
    ) as { Values: string[] };
    expect(whereClause.Values).toEqual(["'MyApp'"]);
  });

  it("emits unquoted bool literals for true/false", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.isManaged", op: "==", value: "true" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "properties.isManaged",
    ) as { Values: string[] };
    expect(whereClause.Values).toEqual(["true"]);
  });

  it("emits unquoted numeric literals", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.userCount", op: ">", value: "100" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "properties.userCount",
    ) as { Values: string[] };
    expect(whereClause.Values).toEqual(["100"]);
  });

  it("doubles embedded single quotes in string values", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          {
            field: "properties.displayName",
            op: "==",
            value: "Alice's app",
          },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "properties.displayName",
    ) as { Values: string[] };
    expect(whereClause.Values).toEqual(["'Alice''s app'"]);
  });

  it("splits in~ values on comma and quotes each token", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "environmentId", op: "in~", value: "env-a, env-b,env-c" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "environmentId",
    ) as { Values: string[] };
    expect(whereClause.Values).toEqual(["'env-a'", "'env-b'", "'env-c'"]);
  });

  it("fails closed for filters whose field is empty without throwing during render", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [{ field: "   ", op: "==", value: "anything" }],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({ $type: "where", FieldName: "1", Operator: "==", Values: ["0"] });
  });
});

describe("buildClausesFromSpec — lastNdays", () => {
  it("translates lastNdays into a raw ago() comparison", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          {
            field: "properties.lastModifiedAt",
            op: "lastNdays",
            value: "30",
          },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "properties.lastModifiedAt",
    ) as { Operator: string; Values: string[] };
    expect(whereClause.Operator).toBe(">");
    expect(whereClause.Values).toEqual(["ago(30d)"]);
  });

  it("rejects zero days rather than silently clamping", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.lastModifiedAt", op: "lastNdays", value: "0" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    expect(clauses).toEqual([{ $type: "where", FieldName: "1", Operator: "==", Values: ["0"] }]);
  });
});

describe("buildClausesFromSpec — sentinel fields", () => {
  it("emits an extend shim plus a has filter on the synthesized bag column", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          {
            field: CONNECTOR_FIELD,
            op: "==",
            value: "shared_sharepointonline",
          },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;

    const extendClause = clauses.find((c) => c.$type === "extend") as
      | { FieldName: string; Expression: string }
      | undefined;
    expect(extendClause).toBeDefined();
    // The synthesized bag column must concatenate every place connectors
    // can live, otherwise the filter misses some resource types.
    expect(extendClause?.Expression).toContain("powerPlatformConnectors");
    expect(extendClause?.Expression).toContain("trigger");
    expect(extendClause?.Expression).toContain("triggerOperation");

    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === extendClause?.FieldName,
    ) as { Operator: string; Values: string[] };
    // == against a sentinel field becomes `has` (tokenized search).
    expect(whereClause.Operator).toBe("has");
    expect(whereClause.Values).toEqual(["'shared_sharepointonline'"]);
  });

  it("translates != on a sentinel to !has", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [{ field: OPERATION_FIELD, op: "!=", value: "SendEmail" }],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const extendClause = clauses.find((c) => c.$type === "extend") as
      | { FieldName: string }
      | undefined;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === extendClause?.FieldName,
    ) as { Operator: string };
    expect(whereClause.Operator).toBe("!has");
  });

  it("translates in~ on a sentinel to has_any", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          {
            field: CONNECTOR_FIELD,
            op: "in~",
            value: "shared_sharepointonline,shared_office365",
          },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const extendClause = clauses.find((c) => c.$type === "extend") as
      | { FieldName: string }
      | undefined;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === extendClause?.FieldName,
    ) as { Operator: string; Values: string[] };
    expect(whereClause.Operator).toBe("has_any");
    expect(whereClause.Values).toHaveLength(2);
  });

  it("emits the extend shim only once when two sentinel filters share it", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          {
            field: CONNECTOR_FIELD,
            op: "==",
            value: "shared_sharepointonline",
          },
          { field: OPERATION_FIELD, op: "==", value: "SendEmail" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    expect(clauses.filter((c) => c.$type === "extend")).toHaveLength(1);
  });
});

describe("buildClausesFromSpec — ordering", () => {
  it("emits orderby with a tostring() cast on properties.* fields", () => {
    const clauses = buildClausesFromSpec(
      spec({
        orderField: "properties.lastModifiedAt",
        orderDirection: "desc",
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const orderClause = clauses.find((c) => c.$type === "orderby") as
      | { FieldNamesAscDesc: Record<string, string> }
      | undefined;
    expect(orderClause?.FieldNamesAscDesc).toEqual({
      "tostring(properties.lastModifiedAt)": "desc",
    });
  });

  it("does not cast top-level fields", () => {
    const clauses = buildClausesFromSpec(
      spec({ orderField: "name", orderDirection: "asc" }),
    ) as unknown as Array<Record<string, unknown>>;
    const orderClause = clauses.find((c) => c.$type === "orderby") as
      | { FieldNamesAscDesc: Record<string, string> }
      | undefined;
    expect(orderClause?.FieldNamesAscDesc).toEqual({ name: "asc" });
  });

  it("omits orderby entirely when orderField is blank", () => {
    const clauses = buildClausesFromSpec(spec({ orderField: "  " })) as unknown as Array<
      Record<string, unknown>
    >;
    expect(clauses.find((c) => c.$type === "orderby")).toBeUndefined();
  });
});

describe("buildClausesFromSpec — limit semantics", () => {
  it("does NOT emit a take clause from spec.limit (limit is page size, not result cap)", () => {
    // This is load-bearing behavior: emitting take() inside the query
    // would cap totalRecords to spec.limit, breaking the "Load more"
    // pagination UI. The comment in buildClausesFromSpec spells this out.
    const clauses = buildClausesFromSpec(spec({ limit: 50 })) as unknown as Array<
      Record<string, unknown>
    >;
    expect(clauses.find((c) => c.$type === "take")).toBeUndefined();
  });
});

describe("buildClausesFromSpec — isempty / !isempty on arrays", () => {
  // `properties.triggers` (autonomous-agent signal) and `properties.flows`
  // are arrays; KQL doesn't have a direct "is empty array" operator, so
  // we emit an extend(array_length) shim then where == 0 / > 0.

  it("translates !isempty into extend(array_length) + where > 0", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.triggers", op: "!isempty", value: "" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const extendClause = clauses.find((c) => c.$type === "extend") as
      | { FieldName: string; Expression: string }
      | undefined;
    expect(extendClause).toBeDefined();
    expect(extendClause!.FieldName).toBe("__cnt_properties_triggers");
    expect(extendClause!.Expression).toBe(
      "iif(isnull(properties.triggers), 0, array_length(properties.triggers))",
    );
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "__cnt_properties_triggers",
    ) as { Operator: string; Values: string[] };
    expect(whereClause.Operator).toBe(">");
    expect(whereClause.Values).toEqual(["0"]);
  });

  it("translates isempty into extend(array_length) + where == 0", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.flows", op: "isempty", value: "" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "__cnt_properties_flows",
    ) as { Operator: string; Values: string[] };
    expect(whereClause.Operator).toBe("==");
    expect(whereClause.Values).toEqual(["0"]);
  });

  it("ignores the value field (arrays don't compare to a value)", () => {
    const withValue = buildClausesFromSpec(
      spec({
        filters: [
          {
            field: "properties.triggers",
            op: "!isempty",
            value: "ignored-noise",
          },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const withoutValue = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.triggers", op: "!isempty", value: "" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    expect(withValue).toEqual(withoutValue);
  });

  it("emits the extend shim only once when the same field is targeted twice", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.triggers", op: "!isempty", value: "" },
          { field: "properties.triggers", op: "isempty", value: "" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const extendClauses = clauses.filter((c) => c.$type === "extend");
    expect(extendClauses).toHaveLength(1);
    // Both where clauses against the alias survive though.
    const whereClauses = clauses.filter(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "__cnt_properties_triggers",
    );
    expect(whereClauses).toHaveLength(2);
  });

  it("sanitises path characters in the alias", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          {
            field: "properties.capabilitiesCounts.distinctFlows",
            op: "!isempty",
            value: "",
          },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const extendClause = clauses.find((c) => c.$type === "extend") as
      | { FieldName: string }
      | undefined;
    // Dots collapsed to single underscores, no double underscores.
    expect(extendClause?.FieldName).toBe(
      "__cnt_properties_capabilitiesCounts_distinctFlows",
    );
  });
});
