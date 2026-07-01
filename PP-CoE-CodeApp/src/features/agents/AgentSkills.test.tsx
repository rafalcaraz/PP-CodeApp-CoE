import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

vi.mock("./data", async () => {
  const actual = await vi.importActual<typeof import("./data")>("./data");
  return { ...actual, getAgent: vi.fn() };
});
vi.mock("./skills", () => ({ listAgentSkills: vi.fn() }));

import { AgentSkills } from "./AgentSkills";
import { getAgent } from "./data";
import { listAgentSkills } from "./skills";
import { buildSkillTree } from "./skillTree";
import type { SkillSummary } from "./skillTree";

function renderExplorer(route = "/agents/agent-1/skills?envId=env-1") {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/agents/:agentId/skills" element={<AgentSkills />} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  );
}

const singleSkill: SkillSummary = {
  id: "bc-1",
  name: "single-whatever-skill",
  description: "a single skill",
  kind: "single",
  componentType: 9,
  tree: buildSkillTree([{ path: "SKILL.md", content: "# Hello Skill\nbody text" }]),
  isMock: false,
};

const bundledSkill: SkillSummary = {
  id: "bc-2",
  name: "molina-bundle",
  description: "",
  kind: "bundled",
  componentType: 14,
  tree: buildSkillTree([
    { path: "scripts/run.py", content: "print('hi')" },
  ]),
  isMock: true,
};

beforeEach(() => {
  vi.mocked(getAgent).mockResolvedValue({
    ok: true,
    data: { row: { environmentId: "env-1", displayName: "My Agent" } as never, raw: {} },
  });
});

describe("AgentSkills", () => {
  it("renders the skill tree and the first file's markdown", async () => {
    vi.mocked(listAgentSkills).mockResolvedValue({
      ok: true,
      data: { skills: [singleSkill, bundledSkill], usedMockFallback: false },
    });

    renderExplorer();

    await waitFor(() =>
      expect(screen.getByText("single-whatever-skill")).toBeInTheDocument(),
    );
    // Tree lists both skills
    expect(screen.getByText("molina-bundle")).toBeInTheDocument();
    // The first file (SKILL.md) is auto-selected and rendered as markdown
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Hello Skill" })).toBeInTheDocument(),
    );
  });

  it("shows a warning banner when mock fallback is used", async () => {
    vi.mocked(listAgentSkills).mockResolvedValue({
      ok: true,
      data: {
        skills: [singleSkill],
        usedMockFallback: true,
        note: "showing sample skills",
      },
    });

    renderExplorer();
    await waitFor(() =>
      expect(screen.getByText("showing sample skills")).toBeInTheDocument(),
    );
  });

  it("selects a code file and renders its contents when clicked", async () => {
    vi.mocked(listAgentSkills).mockResolvedValue({
      ok: true,
      data: { skills: [bundledSkill], usedMockFallback: false },
    });

    renderExplorer();
    const fileNode = await screen.findByText("run.py");
    fireEvent.click(fileNode);
    await waitFor(() =>
      expect(screen.getByText("print('hi')")).toBeInTheDocument(),
    );
  });

  it("surfaces an error when the skills retrieve fails", async () => {
    vi.mocked(listAgentSkills).mockResolvedValue({ ok: false, error: "kaboom" });
    renderExplorer();
    await waitFor(() =>
      expect(screen.getByText("Couldn't load skills")).toBeInTheDocument(),
    );
  });
});
