import { describe, expect, it } from "vitest";
import { dataSourcesInfo } from "../../../.power/schemas/appschemas/dataSourcesInfo";
import {
  costActions, costDataSourceName, initialInputs, parameterSchema, parseInputs,
  requestPreview, schemaTools, validateParameters,
} from "./catalog";

function action(id: string) {
  const found = costActions.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing action ${id}`);
  return found;
}

describe("Cost Management registered catalog", () => {
  it("covers every registered action, resolves shared parameter references and hides only connectionId", () => {
    expect(costActions).toHaveLength(24);
    expect(costActions.map((entry) => entry.id).sort()).toEqual(Object.keys(dataSourcesInfo[costDataSourceName].apis).sort());
    for (const entry of costActions) {
      expect(entry.registered).toBe(true);
      expect(entry.readOnly).toBe(entry.method === "GET");
      for (const p of entry.parameters) {
        expect(p.name).not.toBe("connectionId");
        expect(() => schemaTools.schemaDocument(parameterSchema(p))).not.toThrow();
      }
    }
    expect(action("RemoveAssignedGroup").path).toContain("/microsoft.graph.selectedGroupsSpendingPolicy/assignedGroups/{groupId}/$ref");
    expect(action("ListRecipientReferences").path).toMatch(/\/recipients\/\$ref$/);
  });

  it("requires a parent ETag on all ten existing-policy mutations, but not creation", () => {
    const writes = costActions.filter((entry) => !entry.readOnly && entry.id !== "CreateSpendingPolicy");
    expect(writes).toHaveLength(10);
    for (const entry of writes) expect(entry.parameters.find((p) => p.name === "If-Match")).toMatchObject({ in: "header", required: true });
    expect(action("CreateSpendingPolicy").parameters.some((p) => p.name === "If-Match")).toBe(false);
    expect(costActions.some((entry) => entry.path.includes("serviceSettings") && entry.method === "DELETE")).toBe(false);
  });

  it("does not invent default IDs, headers or query values", () => {
    expect(Object.values(initialInputs(action("GetUserBalance")))).toEqual(["", "", ""]);
    expect(parseInputs(action("ListSpendingPolicies"), { $top: "0", $count: "false", $select: "" })).toEqual({ $top: 0, $count: false });
    expect(parseInputs(action("GetSpendingPolicy"), { id: " preserve spaces " })).toEqual({ id: " preserve spaces " });
  });

  it("previews encoded path/query values, literal route segments and exact ETags/bodies", () => {
    const preview = requestPreview(action("RemoveAssignedGroup"), { id: "policy/a", groupId: "group?b", "If-Match": 'W/"7"' });
    expect(preview).toEqual({
      method: "DELETE",
      url: "https://graph.microsoft.com/beta/copilot/costManagement/spendingPolicies/policy%2Fa/microsoft.graph.selectedGroupsSpendingPolicy/assignedGroups/group%3Fb/$ref",
      headers: { "If-Match": 'W/"7"' },
    });
    const list = requestPreview(action("ListSpendingPolicies"), { $count: false, $filter: "displayName eq 'Example policy'" });
    const url = new URL(list.url);
    expect(url.searchParams.get("$count")).toBe("false");
    expect(url.searchParams.get("$filter")).toBe("displayName eq 'Example policy'");
    expect(requestPreview(action("UpdateAlertSetting"), { id: "p", "If-Match": 'W/"9"', body: {} }))
      .toMatchObject({ headers: { "If-Match": 'W/"9"', "Content-Type": "application/json" }, body: {} });
  });

  it("rejects unknown parameters, missing fields, wrong scalar types and invalid JSON", () => {
    expect(() => parseInputs(action("GetUserBalance"), {})).toThrow("userId is required");
    expect(() => validateParameters(action("GetUserBalance"), { userId: "u", $skip: 10 })).toThrow("Unknown parameter");
    expect(() => parseInputs(action("UpdateAlertSetting"), { id: "p", "If-Match": "tag", body: "{" })).toThrow("valid JSON");
    expect(() => parseInputs(action("ListSpendingPolicies"), { $top: "1.5" })).toThrow("integer");
    expect(() => parseInputs(action("ListSpendingPolicies"), { $count: '"false"' })).toThrow("true or false");
    expect(() => parseInputs(action("GetUserBalance"), { userId: "u", $expand: "other" })).toThrow("serviceBalances");
    expect(() => parseInputs(action("DeleteSpendingPolicy"), { id: "p", "If-Match": "*" })).toThrow("wildcard");
    expect(() => parseInputs(action("DeleteSpendingPolicy"), { id: "p", "If-Match": "tag\nheader" })).toThrow("multiline");
  });

  it("validates conditional quantity writes and rejects server-managed policy fields", () => {
    const update = (body: unknown) => validateParameters(action("UpdateSpendingPolicy"), { id: "p", "If-Match": "tag", body });
    const limited = { "@odata.type": "#microsoft.graph.limitedCostManagementQuantity", unit: "copilotCredit" };
    const unlimited = { "@odata.type": "#microsoft.graph.unlimitedCostManagementQuantity", unit: "copilotCredit" };
    expect(() => update({ periodLimit: limited })).toThrow("value is required");
    expect(() => update({ periodLimit: { ...limited, value: 0 } })).not.toThrow();
    expect(() => update({ perUserLimit: unlimited })).not.toThrow();
    expect(() => update({ perUserLimit: { ...unlimited, value: 0 } })).toThrow("must be omitted");
    expect(() => update({ status: "disabled" })).toThrow("not allowed");
    expect(() => update({ displayName: "Bad-name policy" })).toThrow("letters, digits and spaces");
  });

  it("supports empty alert merges and clearing thresholds, while rejecting invalid thresholds and nulls", () => {
    const update = (body: unknown) => validateParameters(action("UpdateAlertSetting"), { id: "p", "If-Match": "tag", body });
    expect(() => update({})).not.toThrow();
    expect(() => update({ thresholds: [] })).not.toThrow();
    expect(() => update({ thresholds: null })).toThrow("array");
    expect(() => update({ recipients: [] })).toThrow("not allowed");
    const percent = { "@odata.type": "#microsoft.graph.percentageCostManagementAlertThreshold", value: 80 };
    expect(() => update({ thresholds: [percent] })).not.toThrow();
    for (const value of [0, 101, 2.5]) expect(() => update({ thresholds: [{ ...percent, value }] })).toThrow("integer from 1 to 100");
    expect(() => update({ thresholds: [{ ...percent, unit: "copilotCredit" }] })).toThrow("unit must be omitted");
    const absolute = { "@odata.type": "#microsoft.graph.absoluteCostManagementAlertThreshold", value: 50 };
    expect(() => update({ thresholds: [absolute] })).toThrow("unit matching");
    expect(() => update({ thresholds: [{ ...absolute, unit: "copilotCredit" }] })).not.toThrow();
  });
});
