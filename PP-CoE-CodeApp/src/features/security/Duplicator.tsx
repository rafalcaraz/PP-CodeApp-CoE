import { lazy, Suspense, useState } from "react";
import {
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from "@fluentui/react-components";
import { LoadingPane } from "../../components/Status";

// Lazy-load both subviews so the shared shell stays light in the
// default-tab path.
const DlpDuplicator = lazy(() =>
  import("./DlpDuplicator").then((m) => ({ default: m.DlpDuplicator })),
);
const EnvGroupDuplicator = lazy(() =>
  import("./EnvGroupDuplicator").then((m) => ({ default: m.EnvGroupDuplicator })),
);

// ---------------------------------------------------------------------------
// Subject tabs
// ---------------------------------------------------------------------------

type DuplicatorSubject = "dlp" | "env-group";

const SUBJECTS: { value: DuplicatorSubject; label: string }[] = [
  { value: "dlp", label: "DLP policies" },
  { value: "env-group", label: "Environment groups" },
];

const STORAGE_KEY = "ppcoe.duplicator.subject";

function loadSubject(): DuplicatorSubject {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dlp" || v === "env-group") return v;
  } catch {
    // ignore
  }
  return "dlp";
}

function saveSubject(s: DuplicatorSubject): void {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {
    // ignore quota / privacy errors
  }
}

const useShellStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  tabRow: {
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

/**
 * Top-level multi-subject duplicator. Picks "what do you want to
 * duplicate?" first — a DLP policy or an environment group — then
 * renders the matching subview.
 *
 * Last-used subject is remembered in localStorage so the same admin
 * doesn't have to re-pick on every navigation (mirrors `Comparator`
 * and `Impact`).
 */
export function Duplicator() {
  const styles = useShellStyles();
  const [subject, setSubject] = useState<DuplicatorSubject>(() => loadSubject());

  const onSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    const next = data.value as DuplicatorSubject;
    setSubject(next);
    saveSubject(next);
  };

  const subtitle =
    subject === "dlp"
      ? "Clone an existing DLP policy onto a new set of environments. Connector buckets and the default classification are copied verbatim."
      : "Clone an existing environment group's governance rulesets onto a new group with a new name and description.";

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Text size={700} weight="semibold">
          Duplicator
        </Text>
        <Text className={styles.subtitle}>{subtitle}</Text>
      </header>

      <div className={styles.tabRow}>
        <TabList selectedValue={subject} onTabSelect={onSelect} size="large">
          {SUBJECTS.map((s) => (
            <Tab key={s.value} value={s.value}>
              {s.label}
            </Tab>
          ))}
        </TabList>
      </div>

      {subject === "dlp" && (
        <Suspense fallback={<LoadingPane label="Loading DLP duplicator…" />}>
          <DlpDuplicator />
        </Suspense>
      )}
      {subject === "env-group" && (
        <Suspense fallback={<LoadingPane label="Loading env-group duplicator…" />}>
          <EnvGroupDuplicator />
        </Suspense>
      )}
    </div>
  );
}
