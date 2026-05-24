import { describe, it, expect } from "vitest";
import {
  buildClausesFromSpec,
  CONNECTOR_FIELD,
  OPERATION_FIELD,
  ResourceType,
  type QuerySpec,
} from "./inventory";

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

describe("buildClausesFromSpec — resource-type clause", () => {
  it("emits no type clause when no resourceTypes are selected", () => {
    const clauses = buildClausesFromSpec(spec()) as unknown as Array<Record<string, unknown>>;
    expect(clauses.find((c) => c.$type === "where")).toBeUndefined();
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

  it("drops filters whose field is empty", () => {
    const clauses = buildClausesFromSpec(
      spec({
        filters: [{ field: "   ", op: "==", value: "anything" }],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    expect(clauses).toEqual([]);
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

  it("clamps lastNdays to a minimum of 1 day (Math.max guard)", () => {
    // Reading buildClausesFromSpec: `Math.max(1, Math.floor(Number(value)||0))`
    // means value "0" / "" / non-numeric all become 1 day. This pins that
    // behavior — if someone removes the Math.max() guard, this test fails.
    const clauses = buildClausesFromSpec(
      spec({
        filters: [
          { field: "properties.lastModifiedAt", op: "lastNdays", value: "0" },
        ],
      }),
    ) as unknown as Array<Record<string, unknown>>;
    const whereClause = clauses.find(
      (c) =>
        c.$type === "where" &&
        (c as { FieldName?: string }).FieldName === "properties.lastModifiedAt",
    ) as { Values: string[] };
    expect(whereClause.Values).toEqual(["ago(1d)"]);
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
