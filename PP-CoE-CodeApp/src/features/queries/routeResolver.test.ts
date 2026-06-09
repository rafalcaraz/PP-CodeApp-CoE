import { describe, expect, it } from "vitest";
import { ResourceType } from "../../data/inventory";
import { getQueryResultHref } from "./routeResolver";

describe("getQueryResultHref", () => {
  it("maps agents/apps/flows/environments/environment groups to detail routes", () => {
    expect(
      getQueryResultHref({
        id: "agent-1",
        type: ResourceType.CopilotStudioAgent,
      })
    ).toBe("/agents/agent-1");

    expect(
      getQueryResultHref({
        id: "app-1",
        type: ResourceType.CanvasApp,
      })
    ).toBe("/apps/app-1");

    expect(
      getQueryResultHref({
        id: "flow-1",
        type: ResourceType.CloudFlow,
      })
    ).toBe("/flows/flow-1");

    expect(
      getQueryResultHref({
        id: "env-1",
        type: ResourceType.Environment,
      })
    ).toBe("/environments/env-1");

    expect(
      getQueryResultHref({
        id: "group-1",
        type: ResourceType.EnvironmentGroup,
      })
    ).toBe("/environment-groups/group-1");
  });

  it("appends envId for app/flow/agent results", () => {
    expect(
      getQueryResultHref({
        id: "agent-1",
        type: ResourceType.CopilotStudioAgent,
        environmentId: "env-1",
      })
    ).toBe("/agents/agent-1?envId=env-1");

    expect(
      getQueryResultHref({
        id: "app-1",
        type: ResourceType.CanvasApp,
        environmentId: "env-2",
      })
    ).toBe("/apps/app-1?envId=env-2");

    expect(
      getQueryResultHref({
        id: "flow-1",
        type: ResourceType.CloudFlow,
        environmentId: "env-3",
      })
    ).toBe("/flows/flow-1?envId=env-3");
  });

  it("does not append envId for environment resources", () => {
    expect(
      getQueryResultHref({
        id: "env-1",
        type: ResourceType.Environment,
        environmentId: "env-1",
      })
    ).toBe("/environments/env-1");
  });

  it("returns null for unsupported types or missing ids", () => {
    expect(getQueryResultHref({ id: "x", type: "microsoft.foo/bar" })).toBeNull();
    expect(
      getQueryResultHref({
        id: " ",
        type: ResourceType.CanvasApp,
      })
    ).toBeNull();
  });
});

