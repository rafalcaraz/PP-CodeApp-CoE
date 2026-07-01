import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

import { SkillFileViewer } from "./SkillFileViewer";
import { buildSkillTree, type SkillFileNode } from "./skillTree";

const RAW_MD = "---\nname: demo\n---\n# Hello Skill\n\nbody text";

/** A single-skill inline markdown file (static content, no live fetch). */
function mdFile(): SkillFileNode {
  const tree = buildSkillTree([{ path: "SKILL.md", content: RAW_MD }]);
  const node = tree[0];
  if (node.kind !== "file") throw new Error("expected file node");
  return node;
}

function renderViewer(file: SkillFileNode) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <SkillFileViewer file={file} />
    </FluentProvider>,
  );
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("SkillFileViewer markdown raw toggle", () => {
  it("renders the preview (frontmatter stripped) by default", () => {
    renderViewer(mdFile());
    expect(screen.getByRole("heading", { name: "Hello Skill" })).toBeInTheDocument();
    // The frontmatter fence isn't shown as literal text in preview mode.
    expect(screen.queryByText("name: demo")).not.toBeInTheDocument();
  });

  it("shows the raw source when the Raw tab is selected", () => {
    renderViewer(mdFile());
    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));
    // Raw view shows the full source verbatim, including the frontmatter.
    expect(screen.getByText(/name: demo/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Hello Skill" }),
    ).not.toBeInTheDocument();
  });

  it("copies the full raw markdown to the clipboard", async () => {
    renderViewer(mdFile());
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(RAW_MD);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument(),
    );
  });
});
