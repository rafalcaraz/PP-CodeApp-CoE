import { useEffect, useMemo, useState } from "react";
import {
  makeStyles,
  tokens,
  Text,
  Button,
  Badge,
  Spinner,
  MessageBar,
  MessageBarBody,
  TabList,
  Tab,
} from "@fluentui/react-components";
import {
  ArrowDownloadRegular,
  DocumentRegular,
  CopyRegular,
  CheckmarkRegular,
} from "@fluentui/react-icons";
import ReactMarkdown from "react-markdown";
import { splitFrontmatter, type SkillFileNode } from "./skillTree";
import { fetchSkillFileContent, type FetchedFileContent } from "./skillFiles";
import type { DataverseResult } from "../../shared/dataverse";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    height: "100%",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    marginBottom: tokens.spacingVerticalM,
  },
  fileName: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  headerControls: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexShrink: 0,
  },
  fileNameText: {
    fontFamily: "Consolas, 'Courier New', monospace",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  body: {
    minWidth: 0,
    overflow: "auto",
  },
  code: {
    margin: 0,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase300,
    whiteSpace: "pre",
    overflowX: "auto",
  },
  /** Constrains markdown block spacing to something card-appropriate. */
  markdown: {
    minWidth: 0,
    lineHeight: tokens.lineHeightBase400,
    "& h1": { fontSize: tokens.fontSizeBase600, marginTop: tokens.spacingVerticalL },
    "& h2": { fontSize: tokens.fontSizeBase500, marginTop: tokens.spacingVerticalL },
    "& h3": { fontSize: tokens.fontSizeBase400, marginTop: tokens.spacingVerticalM },
    "& p": { marginBlock: tokens.spacingVerticalS },
    "& ul, & ol": { paddingInlineStart: tokens.spacingHorizontalXL },
    "& code": {
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: tokens.fontSizeBase200,
      backgroundColor: tokens.colorNeutralBackground3,
      padding: "1px 4px",
      borderRadius: tokens.borderRadiusSmall,
    },
    "& pre": {
      padding: tokens.spacingHorizontalM,
      borderRadius: tokens.borderRadiusMedium,
      backgroundColor: tokens.colorNeutralBackground3,
      overflowX: "auto",
    },
    "& pre code": { backgroundColor: "transparent", padding: 0 },
    "& table": { borderCollapse: "collapse", width: "100%" },
    "& th, & td": {
      border: `1px solid ${tokens.colorNeutralStroke2}`,
      padding: tokens.spacingHorizontalS,
      textAlign: "left",
    },
    "& a": { color: tokens.colorBrandForegroundLink },
    "& img": { maxWidth: "100%" },
  },
  download: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground3,
    textAlign: "center",
  },
  placeholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
});

/** Human-readable byte size, e.g. `12.4 KB`. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Effective, viewer-ready content for a file, resolved from live or mock. */
interface ResolvedFile {
  content?: string;
  downloadUrl?: string;
  loading: boolean;
  /** Set when a live download was attempted and failed. */
  error?: string;
}

/**
 * Resolve a file's effective content.
 *
 *  - Inline files (no `recordId`) or no environment → use the node's own
 *    `content` / `downloadUrl` verbatim (single-skill markdown, mock overlays).
 *  - Bundled files (`recordId` + environment) → attempt a live download via the
 *    flow; on success prefer the live content, on failure fall back to any mock
 *    content the node already carries and surface the error.
 *
 * The static/loading result is derived during render; state is only written
 * from the async fetch callback (keyed by env+record) to avoid cascading
 * effect renders.
 */
function useResolvedFile(
  file: SkillFileNode | null,
  environmentId?: string,
): ResolvedFile {
  const needsFetch = !!(file?.recordId && environmentId);
  const fetchKey = needsFetch ? `${environmentId}::${file!.recordId}` : "";
  const [fetched, setFetched] = useState<{
    key: string;
    result: DataverseResult<FetchedFileContent>;
  } | null>(null);

  useEffect(() => {
    if (!needsFetch || !file) return;
    let cancelled = false;
    fetchSkillFileContent({
      environmentId: environmentId!,
      recordId: file.recordId!,
      render: file.render,
      ext: file.ext,
    })
      .then((result) => {
        if (!cancelled) setFetched({ key: fetchKey, result });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setFetched({
            key: fetchKey,
            result: { ok: false, error: e instanceof Error ? e.message : String(e) },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsFetch, fetchKey, file, environmentId]);

  if (!file) return { loading: false };
  const fallback = { content: file.content, downloadUrl: file.downloadUrl };
  if (!needsFetch) return { ...fallback, loading: false };
  if (!fetched || fetched.key !== fetchKey) return { ...fallback, loading: true };
  const res = fetched.result;
  if (res.ok) {
    return {
      content: res.data.content ?? file.content,
      downloadUrl: res.data.downloadUrl ?? file.downloadUrl,
      loading: false,
    };
  }
  return { ...fallback, loading: false, error: res.error };
}

/**
 * Renders the currently-selected skill file.
 *
 *  - `markdown` → rendered via react-markdown (raw HTML disabled).
 *  - `code`     → monospace code block (JSON is pretty-printed when valid).
 *  - `download` → an icon + Download button. When no `downloadUrl` is present
 *    the button is disabled with an explanatory note.
 *
 * For bundled-skill files the content is fetched live via the download flow
 * (with the mock overlay as fallback); a spinner shows while fetching and a
 * warning banner surfaces a live-download failure.
 */
export function SkillFileViewer({
  file,
  environmentId,
}: {
  file: SkillFileNode | null;
  environmentId?: string;
}) {
  const styles = useStyles();
  const resolved = useResolvedFile(file, environmentId);
  const content = resolved.content;
  const downloadUrl = resolved.downloadUrl;
  const isMarkdown = file?.render === "markdown";

  const [mdView, setMdView] = useState<"preview" | "raw">("preview");
  const [copied, setCopied] = useState(false);

  // Reset the preview/raw toggle and copy affordance when switching files.
  // (Adjusting state during render per the React docs, rather than an effect.)
  const fileKey = `${file?.path ?? ""}::${file?.recordId ?? ""}`;
  const [prevFileKey, setPrevFileKey] = useState(fileKey);
  if (fileKey !== prevFileKey) {
    setPrevFileKey(fileKey);
    setMdView("preview");
    setCopied(false);
  }

  const copyRaw = () => {
    if (content === undefined) return;
    void navigator.clipboard?.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const { rendered, isFrontmatterBody } = useMemo(() => {
    if (!file || file.render !== "markdown" || content === undefined) {
      return { rendered: "", isFrontmatterBody: false };
    }
    const { frontmatter, body } = splitFrontmatter(content);
    return {
      rendered: body,
      isFrontmatterBody: Object.keys(frontmatter).length > 0,
    };
  }, [file, content]);

  const prettyCode = useMemo(() => {
    if (!file || file.render !== "code" || content === undefined) return "";
    if (file.ext === "json") {
      try {
        return JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        return content;
      }
    }
    return content;
  }, [file, content]);

  if (!file) {
    return (
      <div className={styles.placeholder}>
        <Text>Select a file to view its contents.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.fileName}>
          <DocumentRegular />
          <Text weight="semibold" className={styles.fileNameText}>
            {file.path}
          </Text>
          {file.ext && (
            <Badge appearance="tint" color="informative" size="small">
              {file.ext}
            </Badge>
          )}
        </div>
        <div className={styles.headerControls}>
          {isMarkdown && content !== undefined && !resolved.loading && (
            <>
              <TabList
                size="small"
                selectedValue={mdView}
                onTabSelect={(_e, d) => setMdView(d.value as "preview" | "raw")}
              >
                <Tab value="preview">Preview</Tab>
                <Tab value="raw">Raw</Tab>
              </TabList>
              <Button
                size="small"
                appearance="subtle"
                icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
                onClick={copyRaw}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </>
          )}
          {downloadUrl && (
            <Button
              size="small"
              icon={<ArrowDownloadRegular />}
              as="a"
              href={downloadUrl}
              download={file.name}
            >
              Download
            </Button>
          )}
        </div>
      </div>

      <div className={styles.body}>
        {resolved.loading && <Spinner size="small" label="Downloading file…" />}

        {!resolved.loading && resolved.error && (
          <MessageBar intent="warning">
            <MessageBarBody>
              Couldn't download this file live: {resolved.error}
              {content !== undefined || downloadUrl
                ? " Showing sample content instead."
                : ""}
            </MessageBarBody>
          </MessageBar>
        )}

        {!resolved.loading &&
          isMarkdown &&
          content !== undefined &&
          mdView === "preview" && (
            <div className={styles.markdown}>
              <ReactMarkdown skipHtml>{rendered}</ReactMarkdown>
              {!isFrontmatterBody && rendered.trim() === "" && (
                <Text className={styles.placeholder}>This file is empty.</Text>
              )}
            </div>
          )}

        {!resolved.loading &&
          isMarkdown &&
          content !== undefined &&
          mdView === "raw" && <pre className={styles.code}>{content}</pre>}

        {!resolved.loading && file.render === "code" && content !== undefined && (
          <pre className={styles.code}>{prettyCode}</pre>
        )}

        {!resolved.loading &&
          (file.render === "download" || content === undefined) && (
            <div className={styles.download}>
              <DocumentRegular fontSize={48} />
              <Text weight="semibold">{file.name}</Text>
              {typeof file.size === "number" && <Text>{formatSize(file.size)}</Text>}
              {downloadUrl ? (
                <Button
                  appearance="primary"
                  icon={<ArrowDownloadRegular />}
                  as="a"
                  href={downloadUrl}
                  download={file.name}
                >
                  Download file
                </Button>
              ) : (
                !resolved.error && (
                  <MessageBar intent="info">
                    <MessageBarBody>
                      This file type can't be previewed
                      {file.recordId ? "" : " and downloading isn't available yet"}.
                    </MessageBarBody>
                  </MessageBar>
                )
              )}
            </div>
          )}
      </div>
    </div>
  );
}
