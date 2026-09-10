import { describe, expect, it } from "vitest";

import fixture from "../../../test/fixtures/copilot-agent-evidence.json";
import {
  normalizeAgentEvidence,
  type CapabilityDetector,
} from "./index";

describe("normalizeAgentEvidence", () => {
  it("joins inventory, bot, configuration, and component evidence", () => {
    const result = normalizeAgentEvidence(fixture);

    expect(result.inventory).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      schemaName: "contoso_agent",
    });
    expect(result.bot).toEqual({
      botid: "11111111-1111-1111-1111-111111111111",
      authenticationmode: "Integrated",
    });
    expect(result.configuration).toEqual({
      agentSettings: { enableMemory: true },
    });
    expect(result.components).toMatchObject({
      componentCount: 1,
      records: [
        expect.objectContaining({
          botcomponentid: "22222222-2222-2222-2222-222222222222",
        }),
      ],
      types: [17],
      names: ["Daily trigger"],
      schemaNames: ["contoso_daily"],
      kinds: ["ExternalTriggerConfiguration"],
    });
    expect(result.capabilities).toMatchObject({
      memoryEnabled: true,
      externalTrigger: true,
      recurrenceTrigger: true,
    });
    expect(result.diagnostics).toEqual({
      hasIssues: false,
      count: 0,
      items: [],
    });
  });

  it("removes Dataverse annotation noise from normalized bot evidence", () => {
    const result = normalizeAgentEvidence({
      inventory: {},
      bot: {
        botid: "agent-1",
        "ismanaged@OData.Community.Display.V1.FormattedValue": "No",
      },
    });

    expect(result.bot).toEqual({ botid: "agent-1" });
  });

  it("decodes double-encoded configuration JSON", () => {
    const configuration = JSON.stringify(
      JSON.stringify({ agentSettings: { enableMemory: true } }),
    );

    const result = normalizeAgentEvidence({
      inventory: {},
      bot: { configuration },
    });

    expect(result.configuration).toEqual({
      agentSettings: { enableMemory: true },
    });
    expect(result.capabilities.memoryEnabled).toBe(true);
    expect(result.diagnostics.items).toEqual([]);
  });

  it("detects memory only from the strict configuration boolean", () => {
    const enabled = normalizeAgentEvidence({
      inventory: {},
      bot: {
        configuration: { agentSettings: { enableMemory: true } },
      },
    });
    const disabled = normalizeAgentEvidence({
      inventory: {},
      bot: {
        configuration: { agentSettings: { enableMemory: false } },
      },
    });

    expect(enabled.capabilities.memoryEnabled).toBe(true);
    expect(enabled.capabilities.evidence.memoryEnabled).toEqual([
      "configuration.agentSettings.enableMemory=true",
    ]);
    expect(disabled.capabilities.memoryEnabled).toBe(false);
  });

  it("reports malformed configuration without dropping the agent", () => {
    const result = normalizeAgentEvidence({
      inventory: { id: "kept" },
      bot: { configuration: '{"agentSettings":' },
    });

    expect(result.inventory.id).toBe("kept");
    expect(result.configuration).toEqual({});
    expect(result.diagnostics.hasIssues).toBe(true);
    expect(result.diagnostics.items[0]).toMatchObject({
      code: "configuration.invalid-json",
      section: "configuration",
    });
  });

  it("reports malformed YAML without dropping the component or agent", () => {
    const result = normalizeAgentEvidence({
      inventory: { id: "kept" },
      components: [
        {
          botcomponentid: "bad-component",
          name: "Broken",
          data: "kind: [unterminated",
        },
      ],
    });

    expect(result.inventory.id).toBe("kept");
    expect(result.components.componentCount).toBe(1);
    expect(result.diagnostics.items).toEqual([
      expect.objectContaining({
        code: "component.invalid-yaml",
        componentId: "bad-component",
        componentName: "Broken",
      }),
    ]);
  });

  it("aggregates distinct primitive leaves with any-value paths", () => {
    const result = normalizeAgentEvidence({
      inventory: {},
      components: [
        {
          componenttype: 9,
          name: "One",
          schemaname: "schema_one",
          data: [
            "kind: AdaptiveDialog",
            "actions:",
            "  - type: SendActivity",
            "    enabled: true",
            "  - type: SendActivity",
            "    enabled: false",
            "tags: [alpha, beta]",
          ].join("\n"),
        },
        {
          componenttype: 9,
          name: "Two",
          schemaName: "schema_two",
          data: [
            "kind: AdaptiveDialog",
            "actions:",
            "  - type: InvokeAction",
            "    enabled: true",
            "tags: [beta, gamma]",
          ].join("\n"),
        },
      ],
    });

    expect(result.components.types).toEqual([9]);
    expect(result.components.names).toEqual(["One", "Two"]);
    expect(result.components.schemaNames).toEqual([
      "schema_one",
      "schema_two",
    ]);
    expect(result.components.kinds).toEqual(["AdaptiveDialog"]);
    expect(result.components.any).toMatchObject({
      kind: ["AdaptiveDialog"],
      "actions.type": ["SendActivity", "InvokeAction"],
      "actions.enabled": [true, false],
      tags: ["alpha", "beta", "gamma"],
    });
  });

  it("does not infer an external trigger from componenttype 17 alone", () => {
    const result = normalizeAgentEvidence({
      inventory: {},
      components: [
        {
          componenttype: 17,
          name: "Webhook",
          data: "kind: AdaptiveDialog",
        },
      ],
    });

    expect(result.components.types).toEqual([17]);
    expect(result.capabilities.externalTrigger).toBe(false);
    expect(result.capabilities.recurrenceTrigger).toBe(false);
    expect(result.capabilities.evidence.externalTrigger).toEqual([]);
  });

  it("detects recurrence from the parsed external trigger kind", () => {
    const result = normalizeAgentEvidence({
      inventory: {},
      components: [
        {
          componenttype: 9,
          name: "Schedule",
          data: [
            "kind: ExternalTriggerConfiguration",
            "externalTriggerSource:",
            "  kind: AgentRecurrenceTrigger",
          ].join("\n"),
        },
      ],
    });

    expect(result.capabilities.externalTrigger).toBe(true);
    expect(result.capabilities.recurrenceTrigger).toBe(true);
    expect(result.capabilities.evidence.recurrenceTrigger).toEqual([
      "externalTriggerSource.kind=AgentRecurrenceTrigger (Schedule)",
    ]);
  });

  it("has no capability false positives from lookalike values", () => {
    const result = normalizeAgentEvidence({
      inventory: {},
      bot: {
        configuration: {
          agentSettings: { enableMemory: "true" },
        },
      },
      components: [
        {
          componenttype: 9,
          data: [
            "kind: AdaptiveDialog",
            "externalTriggerSource:",
            "  kind: AgentRecurrenceTrigger",
          ].join("\n"),
        },
      ],
    });

    expect(result.capabilities).toMatchObject({
      memoryEnabled: false,
      externalTrigger: false,
      recurrenceTrigger: false,
    });
  });

  it("accepts an extended capability registry", () => {
    const customDetector: CapabilityDetector = {
      id: "hasComponents",
      detect: ({ components }) => ({
        detected: components.length > 0,
        evidence: components.length > 0 ? ["componentCount>0"] : [],
      }),
    };

    const result = normalizeAgentEvidence(
      {
        inventory: {},
        components: [{ name: "One" }],
      },
      {
        capabilityRegistry: [customDetector],
      },
    );

    expect(result.capabilities.hasComponents).toBe(true);
    expect(result.capabilities.evidence.hasComponents).toEqual([
      "componentCount>0",
    ]);
  });
});
