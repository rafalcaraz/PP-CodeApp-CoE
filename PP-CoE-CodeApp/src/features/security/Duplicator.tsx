import { lazy, Suspense, useState } from "react";
import {
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from "@fluentui/react-components";
import { LoadingPane } from "../../components/Status";

// Lazy-load the DLP subview so the shared shell stays light in the
// default-tab path. The environment-group subview is a "coming soon"
// placeholder for now (see the stub below for the rationale).
const DlpDuplicator = lazy(() =>
  import("./DlpDuplicator").then((m) => ({ default: m.DlpDuplicator })),
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
      : "Clone an existing environment group along with its governance rules. (Coming soon.)";

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
      {subject === "env-group" && <EnvironmentGroupDuplicatorPlaceholder />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environment group duplicator — coming soon
//
// An earlier prototype attempted to clone an env group's governance
// rules (Model A `parameters`-bucket rulesets surfaced under "Rules"
// on the env-group detail page) using the standard
// `PowerPlatformforAdminsV2` connector. It turned out the connector
// has no working endpoint to create a ruleset on an env group:
//   - `CreateRuleSet` declares an env-scoped URL
//     (`/governance/environments/{envId}/environmentGroups/{groupId}/ruleSets`)
//     that the real API never routes — 404 "Resource not found"
//     regardless of which env id is supplied.
//   - `UpdateRuleSet` is strict-update only and 404s on unknown ids
//     (Cosmos `ItemNotFound`).
//   - The real working endpoint is
//     `POST /governance/environmentGroups/{groupId}/ruleSets`, which
//     has no connector wrap.
// Model B rule-based policies (e.g. ACPs) can be cloned end-to-end
// via `CreateRuleBasedPolicy` + `CreateEnviornmentGroupRuleBasedAssignment`,
// but cloning a group's rules in isolation without the Model A path
// would only give a partial result and produce confusion. Until we
// either:
//   a) ship a custom connector for the missing endpoint, or
//   b) Microsoft adds a working wrap to the standard connector,
// this tab stays a placeholder. The DLP duplicator on the sibling
// tab is fully functional today.
// ---------------------------------------------------------------------------

function EnvironmentGroupDuplicatorPlaceholder() {
  return (
    <MessageBar intent="info">
      <MessageBarBody>
        <MessageBarTitle>Coming soon</MessageBarTitle>
        Cloning an environment group along with its rules isn't supported
        yet. The standard Power Platform for Admins V2 connector doesn't
        expose a working endpoint to create governance rulesets on a
        group, so a full duplication isn't possible without a custom
        connector. In the meantime, use the <strong>DLP policies</strong>{" "}
        tab to duplicate DLP policies, and recreate environment groups
        manually in the Power Platform admin center.
      </MessageBarBody>
    </MessageBar>
  );
}
