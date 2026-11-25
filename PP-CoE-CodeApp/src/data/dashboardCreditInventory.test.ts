import { beforeEach, describe, expect, it, vi } from "vitest";
const { agents, environments, estate } = vi.hoisted(() => ({ agents: vi.fn(), environments: vi.fn(), estate: vi.fn() }));
vi.mock("./inventory", () => ({ listAgentsPage: agents, listEnvironments: environments }));
vi.mock("./dashboardManagedAppSource", () => ({ readManagedAppsEstate: estate }));
import { loadConsumptionInventory, loadManagedAppConsumptionInventory } from "./dashboardCreditInventory";

const agent = { environmentId: "ENV", id: "record-id", botId: "bot-id", schemaName: "prefix_agent", displayName: "Sample agent" };
beforeEach(() => {
  vi.clearAllMocks();
  environments.mockResolvedValue({ ok: true, data: [{ id: "ENV", displayName: "Environment", environmentGroupId: "group", environmentGroup: "Group", environmentType: "Sandbox" }] });
});
describe("current consumption inventory matching", () => {
  it("reuses managed inventory without ACP reads, retains instance IDs and does not invent uncertain groups", async () => {
    estate.mockResolvedValue({ ok: true, data: { capturedAt: "2026-11-24T00:00:00Z", apps: [
      { id: "app", displayName: "Current app", environmentId: "dev", environmentName: "Dev", environmentType: "Sandbox", membershipKnown: true, groupId: "business", groupName: "Business" },
      { id: "app", displayName: "Another deployment", environmentId: "prod", environmentName: "Prod", membershipKnown: false, groupId: "unverified", groupName: "Unverified" },
    ] } });
    const signal = new AbortController().signal;
    const result = await loadManagedAppConsumptionInventory(signal);
    expect(estate).toHaveBeenCalledWith(signal, false, { includeAssignments: false });
    expect(result.apps).toHaveLength(2);
    expect(result.environments.map((env) => env.groupId)).toEqual(["business", ""]);
    estate.mockResolvedValue({ ok: false, error: "Incomplete managed inventory" });
    await expect(loadManagedAppConsumptionInventory(signal)).rejects.toThrow("Incomplete managed inventory");
  });
  it("drains every token with an advancing offset and does not rely on approximate totals", async () => {
    agents.mockResolvedValueOnce({ ok: true, data: { rows: [agent], skipToken: "next", totalRecords: 1 } })
      .mockResolvedValueOnce({ ok: true, data: { rows: [{ ...agent, botId: "second" }], totalRecords: 1 } });
    const result = await loadConsumptionInventory(new AbortController().signal);
    expect(agents.mock.calls.map((call) => call.slice(1))).toEqual([[undefined, 500, 0], ["next", 500, 1]]);
    expect(result.agents.map((row) => row.resourceId)).toEqual(["bot-id", "second"]);
    expect(result.agents[0].resourceAliases).toEqual(["record-id", "bot-id"]);
    expect(result.environments[0]).toMatchObject({ id: "env", groupId: "group" });
  });
  it("rejects nonadvancing pages, read failures and cancellation without publishing partial matches", async () => {
    agents.mockResolvedValue({ ok: true, data: { rows: [agent], skipToken: "same" } });
    await expect(loadConsumptionInventory(new AbortController().signal)).rejects.toThrow(/did not advance/);
    agents.mockResolvedValue({ ok: false, error: "Synthetic read failure" });
    await expect(loadConsumptionInventory(new AbortController().signal)).rejects.toThrow(/Synthetic read failure/);
    const controller = new AbortController(); controller.abort(new Error("Cancelled"));
    await expect(loadConsumptionInventory(controller.signal)).rejects.toThrow(/Cancelled/);
  });
});
