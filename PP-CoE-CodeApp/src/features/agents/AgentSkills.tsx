import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbButton,
  BreadcrumbDivider,
  Card,
  Badge,
  Button,
  Spinner,
  Tree,
  TreeItem,
  TreeItemLayout,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
  mergeClasses,
} from "@fluentui/react-components";
import {
  FolderRegular,
  DocumentRegular,
  DocumentBulletListRegular,
  ArrowDownloadRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { getAgent, type AgentRow } from "./data";
import { listAgentSkills, type AgentSkillsResult } from "./skills";
import type { SkillFileNode, SkillNode, SkillSummary } from "./skillTree";
import { SkillFileViewer } from "./SkillFileViewer";
import { buildSkillZip } from "./skillZip";
import { triggerBlobDownload } from "./skillDownload";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    height: "100%",
    minHeight: 0,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  panes: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 320px) 1fr",
    gap: tokens.spacingHorizontalL,
    flex: 1,
    minHeight: 0,
    "@media (max-width: 800px)": {
      gridTemplateColumns: "1fr",
    },
  },
  treeCard: {
    padding: tokens.spacingVerticalM,
    overflow: "auto",
    minHeight: 0,
  },
  viewerCard: {
    padding: tokens.spacingVerticalL,
    minWidth: 0,
    minHeight: "400px",
  },
  skillLabel: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  skillName: {
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileLayout: {
    cursor: "pointer",
  },
  fileSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    borderRadius: tokens.borderRadiusMedium,
  },
});

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      agent: AgentRow | null;
      skills: AgentSkillsResult;
      environmentId?: string;
    };

/** Collect all branch (skill + folder) values so the tree opens expanded. */
function collectOpenItems(skills: SkillSummary[]): string[] {
  const open: string[] = [];
  const walk = (skillId: string, nodes: SkillNode[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        open.push(`${skillId}::${node.path}`);
        walk(skillId, node.children);
      }
    }
  };
  for (const skill of skills) {
    open.push(`skill::${skill.id}`);
    walk(skill.id, skill.tree);
  }
  return open;
}

/** First renderable file across all skills, used as the initial selection. */
function firstFile(skills: SkillSummary[]): SkillFileNode | null {
  const find = (nodes: SkillNode[]): SkillFileNode | null => {
    for (const node of nodes) {
      if (node.kind === "file") return node;
      const nested = find(node.children);
      if (nested) return nested;
    }
    return null;
  };
  for (const skill of skills) {
    const f = find(skill.tree);
    if (f) return f;
  }
  return null;
}

export function AgentSkills() {
  const styles = useStyles();
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();
  const envId = searchParams.get("envId")?.trim() || undefined;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<SkillFileNode | null>(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      setState({ kind: "loading" });
      // Agent lookup is best-effort (for the display name / env); the skills
      // retrieve is what matters. Resolve the environment id from the agent
      // when it wasn't passed on the query string.
      const agentRes = await getAgent(agentId, envId);
      if (cancelled) return;
      const agent = agentRes.ok && agentRes.data ? agentRes.data.row : null;
      const resolvedEnv = envId || agent?.environmentId || "";
      const skillsRes = await listAgentSkills(agentId, resolvedEnv);
      if (cancelled) return;
      if (!skillsRes.ok) {
        setState({ kind: "error", message: skillsRes.error });
        return;
      }
      setState({
        kind: "ready",
        agent,
        skills: skillsRes.data,
        environmentId: resolvedEnv || undefined,
      });
      setSelected(firstFile(skillsRes.data.skills));
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, envId]);

  const agentName =
    state.kind === "ready" ? state.agent?.displayName || agentId : agentId;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Breadcrumb size="medium">
          <BreadcrumbItem>
            <BreadcrumbButton onClick={() => navigate("/agents")}>Agents</BreadcrumbButton>
          </BreadcrumbItem>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <BreadcrumbButton
              onClick={() =>
                navigate(
                  `/agents/${encodeURIComponent(agentId ?? "")}${
                    envId ? `?envId=${encodeURIComponent(envId)}` : ""
                  }`,
                )
              }
            >
              {agentName}
            </BreadcrumbButton>
          </BreadcrumbItem>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <BreadcrumbButton current>Skills</BreadcrumbButton>
          </BreadcrumbItem>
        </Breadcrumb>
        <Text size={600} weight="semibold">
          Skills
        </Text>
      </div>

      {state.kind === "loading" && <LoadingPane label="Loading skills…" />}
      {state.kind === "error" && (
        <ErrorPane title="Couldn't load skills" message={state.message} />
      )}
      {state.kind === "ready" && (
        <ReadyView
          skills={state.skills}
          selected={selected}
          onSelect={setSelected}
          environmentId={state.environmentId}
        />
      )}
    </div>
  );
}

function ReadyView({
  skills,
  selected,
  onSelect,
  environmentId,
}: {
  skills: AgentSkillsResult;
  selected: SkillFileNode | null;
  onSelect: (file: SkillFileNode) => void;
  environmentId?: string;
}) {
  const styles = useStyles();
  const openItems = useMemo(() => collectOpenItems(skills.skills), [skills.skills]);
  const [zipError, setZipError] = useState<string | null>(null);

  if (skills.skills.length === 0) {
    return (
      <MessageBar intent="info">
        <MessageBarBody>This agent has no skills.</MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <>
      {skills.usedMockFallback && (
        <MessageBar intent="warning">
          <MessageBarBody>
            {skills.note ??
              "Showing sample skills — live skill data was not available."}
          </MessageBarBody>
        </MessageBar>
      )}
      {zipError && (
        <MessageBar intent="error">
          <MessageBarBody>{zipError}</MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button
                appearance="transparent"
                icon={<DismissRegular />}
                aria-label="Dismiss"
                onClick={() => setZipError(null)}
              />
            }
          />
        </MessageBar>
      )}
      <div className={styles.panes}>
        <Card className={styles.treeCard}>
          <Tree aria-label="Agent skills" defaultOpenItems={openItems}>
            {skills.skills.map((skill) => (
              <SkillBranch
                key={skill.id}
                skill={skill}
                selected={selected}
                onSelect={onSelect}
                environmentId={environmentId}
                onZipError={setZipError}
              />
            ))}
          </Tree>
        </Card>
        <Card className={styles.viewerCard}>
          <SkillFileViewer file={selected} environmentId={environmentId} />
        </Card>
      </div>
    </>
  );
}

function SkillBranch({
  skill,
  selected,
  onSelect,
  environmentId,
  onZipError,
}: {
  skill: SkillSummary;
  selected: SkillFileNode | null;
  onSelect: (file: SkillFileNode) => void;
  environmentId?: string;
  onZipError: (message: string | null) => void;
}) {
  const styles = useStyles();
  const [zipping, setZipping] = useState(false);
  // Only bundled skills group multiple files worth zipping; single skills are
  // one inline markdown file already downloadable from the viewer.
  const canZip = skill.kind === "bundled" && skill.tree.length > 0;

  const handleDownloadZip = async (e: MouseEvent) => {
    // Don't let the click toggle the tree branch open/closed.
    e.stopPropagation();
    onZipError(null);
    setZipping(true);
    try {
      const res = await buildSkillZip(skill, environmentId);
      if (!res.ok || !res.blob) {
        onZipError(
          `Couldn't build a zip for "${skill.name}": ${
            res.errors[0]?.error ?? "no files could be downloaded."
          }`,
        );
        return;
      }
      triggerBlobDownload(res.blob, res.filename ?? `${skill.name}.zip`);
      if (res.errors.length > 0) {
        onZipError(
          `Downloaded "${skill.name}" with ${res.errors.length} file(s) skipped — see _download-errors.txt in the zip.`,
        );
      }
    } catch (err) {
      onZipError(
        `Couldn't build a zip for "${skill.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setZipping(false);
    }
  };

  return (
    <TreeItem itemType="branch" value={`skill::${skill.id}`}>
      <TreeItemLayout
        iconBefore={<DocumentBulletListRegular />}
        actions={
          canZip ? (
            <Button
              appearance="subtle"
              size="small"
              icon={zipping ? <Spinner size="tiny" /> : <ArrowDownloadRegular />}
              aria-label={`Download ${skill.name} as a zip`}
              title="Download all files as a .zip"
              disabled={zipping}
              onClick={handleDownloadZip}
            />
          ) : undefined
        }
        aside={
          <Badge appearance="tint" color={skill.kind === "single" ? "brand" : "informative"} size="small">
            {skill.kind}
          </Badge>
        }
      >
        <span className={styles.skillLabel}>
          <span className={styles.skillName}>{skill.name}</span>
        </span>
      </TreeItemLayout>
      <Tree>
        {skill.tree.length === 0 ? (
          <TreeItem itemType="leaf" value={`empty::${skill.id}`}>
            <TreeItemLayout>
              <Text italic size={200}>
                No files available for this bundle.
              </Text>
            </TreeItemLayout>
          </TreeItem>
        ) : (
          renderNodes(skill.id, skill.tree, selected, onSelect, styles)
        )}
      </Tree>
    </TreeItem>
  );
}

function renderNodes(
  skillId: string,
  nodes: SkillNode[],
  selected: SkillFileNode | null,
  onSelect: (file: SkillFileNode) => void,
  styles: ReturnType<typeof useStyles>,
) {
  return nodes.map((node) => {
    const value = `${skillId}::${node.path}`;
    if (node.kind === "folder") {
      return (
        <TreeItem itemType="branch" value={value} key={value}>
          <TreeItemLayout iconBefore={<FolderRegular />}>{node.name}</TreeItemLayout>
          <Tree>{renderNodes(skillId, node.children, selected, onSelect, styles)}</Tree>
        </TreeItem>
      );
    }
    const isSelected =
      selected != null && selected.path === node.path && selected.content === node.content;
    return (
      <TreeItem itemType="leaf" value={value} key={value}>
        <TreeItemLayout
          iconBefore={<DocumentRegular />}
          className={mergeClasses(
            styles.fileLayout,
            isSelected ? styles.fileSelected : undefined,
          )}
          onClick={() => onSelect(node)}
        >
          {node.name}
        </TreeItemLayout>
      </TreeItem>
    );
  });
}
