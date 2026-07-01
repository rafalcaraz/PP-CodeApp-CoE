import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDataverseInflight,
  resetDataverseRunner,
  setDataverseRunner,
} from "../../shared/dataverse";
import type { DataverseFlowInput, DataverseFlowRawResult } from "../../shared/dataverse";
import { listAgentSkills } from "./skills";

const AGENT_ID = "e2586fe2-e46d-4809-b11c-1fe7e0347bab";
const ENV_ID = "env-1";

function envelope(records: unknown[]): DataverseFlowRawResult {
  return { success: true, data: { response: JSON.stringify({ value: records }) } };
}

const runMock = vi.fn<() => Promise<DataverseFlowRawResult>>();

beforeEach(() => {
  runMock.mockReset();
  clearDataverseInflight();
  setDataverseRunner(() => runMock());
});

afterEach(() => {
  clearDataverseInflight();
  resetDataverseRunner();
});

describe("listAgentSkills", () => {
  it("maps a single (componenttype 9) skill with inline markdown", async () => {
    runMock.mockResolvedValue(
      envelope([
        {
          botcomponentid: "bc-1",
          name: "single-whatever-skill",
          description: "single desc",
          componenttype: 9,
          data:
            "kind: InlineAgentSkill\r\ncontent: |\r\n ---\r\n name: single-whatever-skill\r\n ---\r\n When activated do X\r\n",
        },
      ]),
    );

    const res = await listAgentSkills(AGENT_ID, ENV_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usedMockFallback).toBe(false);
    expect(res.data.skills).toHaveLength(1);
    const skill = res.data.skills[0];
    expect(skill.kind).toBe("single");
    expect(skill.isMock).toBe(false);
    expect(skill.tree).toHaveLength(1);
    const file = skill.tree[0];
    expect(file.kind).toBe("file");
    if (file.kind === "file") {
      expect(file.name).toBe("SKILL.md");
      expect(file.content).toContain("When activated do X");
    }
  });

  it("nests bundled file children (type 14) under their type-9 parent", async () => {
    runMock.mockResolvedValue(
      envelope([
        {
          botcomponentid: "bundle-parent",
          name: "molina-fsa-funding-aggregator-move",
          description: "a bundled skill",
          componenttype: 9,
          data:
            "kind: InlineAgentSkill\r\ncontent: <!-- bic:bundle=crc44_x.file.zip_abc -->",
        },
        {
          botcomponentid: "f1",
          name: "./SKILL.md",
          componenttype: 14,
          _parentbotcomponentid_value: "bundle-parent",
          filedata_name: "SKILL.md",
        },
        {
          botcomponentid: "f2",
          name: "./scripts/molina_summary.py",
          componenttype: 14,
          _parentbotcomponentid_value: "bundle-parent",
          filedata_name: "molina_summary.py",
        },
      ]),
    );

    const res = await listAgentSkills(AGENT_ID, ENV_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only the parent surfaces as a skill; children nest inside it.
    expect(res.data.skills).toHaveLength(1);
    const skill = res.data.skills[0];
    expect(skill.kind).toBe("bundled");
    expect(skill.name).toBe("molina-fsa-funding-aggregator-move");

    // Structure comes from the real type-14 records: SKILL.md at root + a
    // scripts/ folder holding molina_summary.py.
    const names = skill.tree.map((n) => n.name);
    expect(names).toContain("SKILL.md");
    const scripts = skill.tree.find(
      (n) => n.kind === "folder" && n.name === "scripts",
    );
    expect(scripts).toBeDefined();
    if (scripts && scripts.kind === "folder") {
      expect(scripts.children.map((c) => c.name)).toContain("molina_summary.py");
    }

    // Files carry a live recordId (for on-demand download) but no inline
    // content — mocks are detached from this path.
    expect(skill.isMock).toBe(false);
    const skillMd = skill.tree.find(
      (n) => n.kind === "file" && n.name === "SKILL.md",
    );
    if (skillMd && skillMd.kind === "file") {
      expect(skillMd.recordId).toBe("f1");
      expect(skillMd.content).toBeUndefined();
    }
  });

  it("ignores non-skill componenttypes and ConnectorTool definitions", async () => {
    runMock.mockResolvedValue(
      envelope([
        { botcomponentid: "topic-1", name: "a topic", componenttype: 0 },
        {
          botcomponentid: "tool-1",
          name: "Invoke an HTTP request",
          componenttype: 9,
          data:
            "kind: ConnectorTool\r\nauthMode: Invoker\r\nconnectorId: /providers/x\r\noperationId: InvokeHttp",
        },
        {
          botcomponentid: "bc-1",
          name: "single-whatever-skill",
          componenttype: 9,
          data: "kind: InlineAgentSkill\r\ncontent: |\r\n body\r\n",
        },
      ]),
    );
    const res = await listAgentSkills(AGENT_ID, ENV_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The topic (type 0) and the ConnectorTool (type 9) are both excluded.
    expect(res.data.skills).toHaveLength(1);
    expect(res.data.skills[0].name).toBe("single-whatever-skill");
    expect(res.data.skills[0].kind).toBe("single");
  });

  it("returns an empty skill list when no skill components are returned", async () => {
    runMock.mockResolvedValue(envelope([]));
    const res = await listAgentSkills(AGENT_ID, ENV_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usedMockFallback).toBe(false);
    expect(res.data.skills).toHaveLength(0);
  });

  it("propagates the error when the retrieve fails (no mock fallback)", async () => {
    runMock.mockResolvedValue({ success: false, error: "boom" });
    const res = await listAgentSkills(AGENT_ID, ENV_ID);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("boom");
  });

  it("sends a fetchxml filtered by parentbotid", async () => {
    const spy = vi.fn((input: DataverseFlowInput) => {
      void input;
      return Promise.resolve(envelope([]));
    });
    setDataverseRunner(spy);
    await listAgentSkills(AGENT_ID, ENV_ID);
    expect(spy).toHaveBeenCalledOnce();
    const arg = spy.mock.calls[0][0];
    expect(arg.pluralName).toBe("botcomponents");
    expect(arg.fetchXml).toContain('name="botcomponent"');
    expect(arg.fetchXml).toContain(`value="${AGENT_ID}"`);
    expect(arg.fetchXml).toContain('attribute="parentbotid"');
  });
});
