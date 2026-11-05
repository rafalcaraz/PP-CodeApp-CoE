import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Badge, Button, Caption1, Dialog, DialogActions, DialogBody, DialogContent,
  DialogSurface, DialogTitle, DrawerBody, DrawerHeader, DrawerHeaderTitle,
  Field, Link, MessageBar, MessageBarBody, OverlayDrawer,
  Text, makeStyles, mergeClasses, tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { ErrorPane, LoadingPane } from "../../components/Status";
import { RawJsonAccordion } from "../../components/RawJsonAccordion";
import {
  getPolicyRuleItems, getRulesetBucketItems, GovernanceRulesGrid,
} from "../../components/ruleRenderers";
import {
  connectorDeclarations, connectorEvidence, groupFacts,
  groupPortalUrl, preparePdeMoves,
  type ConnectorEvidence, type GroupEvidence, type MovePreview, type MoveSelection,
} from "./governance";
import { membershipId, type EnvironmentGroupRow, type DataResult } from "./data";
import { GroupClonePanel } from "./GroupClonePanel";
import type { CloneOutcome } from "./groupClone";
import { SearchPicker } from "./SearchPicker";
import { PdeMoveExecution } from "./PdeMoveExecution";
import type { MoveOutcome } from "./pdeMoves";
import { liveMoveTask } from "./liveMoveTask";
import { moveTaskPhaseLabel } from "./moveTask";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, minWidth: 0, overflowWrap: "anywhere", "& > *": { flexShrink: 0 } },
  section: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, paddingBlock: tokens.spacingVerticalM, borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL, overflowWrap: "anywhere" },
  drawer: { width: "min(640px, 100vw)", maxWidth: "100vw" },
  dialog: { width: "min(900px, calc(100vw - 32px))", maxWidth: "900px" },
  impact: { maxHeight: "65vh", overflowY: "auto", paddingRight: tokens.spacingHorizontalS },
  table: { width: "100%", borderCollapse: "collapse", fontSize: tokens.fontSizeBase200, "& th, & td": { padding: tokens.spacingHorizontalS, textAlign: "left", verticalAlign: "top", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, overflowWrap: "anywhere" } },
  scroll: { overflowX: "auto", maxWidth: "100%" },
});

export function EvidenceProblems({ evidence }: { evidence?: GroupEvidence }) {
  if (!evidence) return <Text>Group evidence has not been loaded. Runtime permissions are unavailable.</Text>;
  return <>
    {!evidence.details.ok && <ErrorPane title="Group properties unavailable" message={evidence.details.error} />}
    {!evidence.rulesets.ok && <><ErrorPane title="Group rules unavailable" message="The group rules request failed. ACP evidence is shown separately when available." />
      <details><summary>Group rules technical detail</summary><Text>{evidence.rulesets.error}</Text></details></>}
    {evidence.rulesets.ok && !!evidence.rulesets.data.unresolved.length && <Text>{evidence.rulesets.data.unresolved.length} rulesets have unresolved applicability. Only explicit Include / EnvironmentGroup settings are shown as group rules.</Text>}
    {!evidence.policies.ok && <ErrorPane title="Connector permissions unavailable" message={evidence.policies.error} />}
  </>;
}

export function ConnectorConfiguration({ value }: { value: ConnectorEvidence }) {
  const labels: Record<ConnectorEvidence["state"], string> = {
    "allowed-configured": "All actions configured",
    "restricted-configured": "Listed actions configured",
    "not-listed": "Not listed (not proven blocked)",
    unknown: "Unavailable / unknown",
  };
  return <div>
    <Text weight="semibold">{labels[value.state]}</Text>
    {value.declarations.map((entry, index) => <div key={`${entry.policyId}:${entry.ruleVersion}:${index}`}>
      <Caption1>Policy {entry.policyId} · v{entry.ruleVersion || "unknown"} · actions {entry.actionsMode || "unknown"} · connections {entry.connectionTypesMode || "unknown"}</Caption1>
      {!!entry.actions.length && <div><Caption1>{entry.actions.join(", ")}</Caption1></div>}
    </div>)}
  </div>;
}

export function GroupPanel({ group, evidence, loading, onClose, onCompleted }: {
  group: EnvironmentGroupRow; evidence?: GroupEvidence; loading: boolean; onClose: () => void; onCompleted: (outcome: CloneOutcome) => void;
}) {
  const styles = useStyles();
  const portalUrl = groupPortalUrl(group.id);
  const declarations = connectorDeclarations(evidence);
  const connectors = declarations.ok ? [...new Set(declarations.data.map((entry) => entry.connectorId))].sort() : [];
  return <OverlayDrawer open position="end" className={styles.drawer} onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DrawerHeader><DrawerHeaderTitle action={<Button appearance="subtle" icon={<DismissRegular />} aria-label="Close group inspection" onClick={onClose} />}>{group.displayName || group.id}</DrawerHeaderTitle></DrawerHeader>
    <DrawerBody className={styles.stack}>
      {portalUrl && <Link href={portalUrl} target="_blank" rel="noopener noreferrer">Open / configure this group in Power Platform admin center</Link>}
      <GroupClonePanel sourceId={group.id} sourceName={group.displayName || group.id} onCompleted={onCompleted} />
      {loading && <LoadingPane label="Loading group properties, rules and ACP evidence..." />}
      {!loading && evidence && <>
        <EvidenceProblems evidence={evidence} />
        {evidence.policies.ok && <Text>{evidence.policies.data.length
          ? `${evidence.policies.data.length} assigned polic${evidence.policies.data.length === 1 ? "y" : "ies"} · ${connectors.length} configured connectors`
          : "No policy assignments were returned. Connector permissions are unknown, not unrestricted."}</Text>}
        <details><summary>Group settings and policy details</summary>
        <Caption1 className={styles.muted}>Group ID: {group.id} · Read {new Date(evidence.capturedAt).toLocaleTimeString()}. Configuration only, not a runtime permission verdict.</Caption1>
        <section className={styles.section}>
          <Text as="h3" weight="semibold">Properties and rules</Text>
          {evidence.details.ok && <><Text>{evidence.details.data.description || "No description returned."}</Text><RawJsonAccordion title="Group properties" data={evidence.details.data} /></>}
          {evidence.rulesets.ok && !evidence.rulesets.data.matching.length && <Text>No explicitly associated Model A group rules returned.</Text>}
          {evidence.rulesets.ok && evidence.rulesets.data.matching.map((rule) => <div key={rule.id}>
            <Caption1>Model A ruleset: {rule.id}</Caption1>
            <GovernanceRulesGrid items={getRulesetBucketItems(rule, group.id)} />
            <RawJsonAccordion title="Ruleset applicability and inputs" data={rule} />
          </div>)}
        </section>
        <section className={styles.section}>
          <Text as="h3" weight="semibold">ACP and assigned policies</Text>
          {evidence.policies.ok && evidence.policies.data.map((policy) => <div key={policy.id} className={styles.stack}>
            <Text weight="semibold">{policy.name || policy.id}</Text><Caption1>Policy ID: {policy.id}</Caption1>
            <Caption1>ACP-only flag: {policy.ruleSets?.find((rule) => rule.id === "AdvancedConnectorPoliciesOnly")?.inputs?.EnableAdvancedConnectorPoliciesOnly === true ? "Enabled in returned configuration" : policy.ruleSets?.find((rule) => rule.id === "AdvancedConnectorPoliciesOnly")?.inputs?.EnableAdvancedConnectorPoliciesOnly === false ? "Disabled in returned configuration" : "Unavailable"}</Caption1>
            <details><summary>Policy settings ({policy.ruleSets?.length ?? 0})</summary><GovernanceRulesGrid items={getPolicyRuleItems(policy)} /></details>
            <RawJsonAccordion title="Policy evidence (rule versions and raw modes)" data={policy} />
          </div>)}
          {!declarations.ok && evidence.policies.ok && <ErrorPane title="Connector declarations unavailable" message={declarations.error} />}
          {!!connectors.length && <details><summary>Configured connectors ({connectors.length})</summary>
            {connectors.map((id) => <div key={id}><Text weight="semibold">{id}</Text><ConnectorConfiguration value={connectorEvidence(evidence, id)} /></div>)}
          </details>}
          <Caption1>Runtime blocked connectors: unavailable. These APIs do not supply a verified effective blocked-connector list.</Caption1>
        </section>
        </details>
      </>}
    </DrawerBody>
  </OverlayDrawer>;
}

function RuleComparison({ source, destination }: { source?: GroupEvidence; destination?: GroupEvidence }) {
  const styles = useStyles();
  const from = groupFacts(source).filter((fact) => !fact.field.startsWith("Group."));
  const to = groupFacts(destination).filter((fact) => !fact.field.startsWith("Group."));
  const fields = [...new Set([...from, ...to].map((fact) => fact.field))].sort();
  return <details><summary>Compare returned group rules ({fields.length} fields)</summary>
    <Text>Configuration differences only. Missing values mean unavailable / not returned, not disabled. Policy and ruleset identities are retained below.</Text>
    <div className={styles.scroll}><table className={styles.table}>
      <thead><tr><th>Rule / input</th><th>Source</th><th>Destination</th></tr></thead>
      <tbody>{fields.map((field) => <tr key={field}><th>{field}</th>{[from, to].map((facts, index) => <td key={index}>{facts.filter((fact) => fact.field === field).map((fact) => <div key={`${fact.identity}:${fact.value}`}>{fact.value}<div><Caption1>{fact.identity}</Caption1></div></div>)}{!facts.some((fact) => fact.field === field) && "Not returned / unavailable"}</td>)}</tr>)}</tbody>
    </table></div>
  </details>;
}

export function MovePreparationDialog({ selection, groups, environmentNames, destinationId, onClose, onBusyChange, onStatusChecked, onReviewRecovery }: {
  selection: MoveSelection[]; groups: EnvironmentGroupRow[]; destinationId?: string; onClose: () => void;
  environmentNames?: Record<string, string>;
  onBusyChange: (busy: boolean) => void;
  onStatusChecked?: (outcomes: MoveOutcome[]) => void;
  onReviewRecovery?: (environmentIds: string[], destinationId: string) => void;
}) {
  const styles = useStyles();
  const [destination, setDestination] = useState(destinationId ?? "");
  const [result, setResult] = useState<DataResult<MovePreview> | null>(null);
  const [loading, setLoading] = useState(!!destinationId);
  const [attempt, setAttempt] = useState(destinationId ? 1 : 0);
  const [checking, setChecking] = useState(false);
  const task = useSyncExternalStore(liveMoveTask.subscribe, liveMoveTask.getSnapshot);
  const executing = checking || !!task?.running;
  const pdeCount = useMemo(() => new Set(selection.map((item) => membershipId(item.environmentId))).size, [selection]);
  useEffect(() => {
    if (!attempt || !destination) return;
    let cancelled = false;
    const controller = new AbortController();
    void preparePdeMoves(selection, destination, controller.signal).then((next) => {
      if (!cancelled) { setResult(next); setLoading(false); }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [attempt, destination, selection]);
  const portalUrl = result?.ok ? groupPortalUrl(result.data.destination.id) : undefined;
  return <Dialog open onOpenChange={(_, data) => { if (!data.open) onClose(); }}>
    <DialogSurface className={styles.dialog}><DialogBody>
      <DialogTitle>{selection.length ? "Move PDEs" : "Resolve pending move"}</DialogTitle>
      <DialogContent className={mergeClasses(styles.stack, styles.impact)}>
        {!!selection.length && <>
        <Text>All apps and resources in each PDE move together, including hidden or unselected apps.</Text>
        <Caption1>{pdeCount} selected PDE{pdeCount === 1 ? "" : "s"} · all apps and resources included</Caption1>
        <Field label="Destination environment group"><SearchPicker label="Destination environment group" value={destination} disabled={loading || executing} showIds
          options={groups.map((group) => ({ id: group.id, name: group.displayName || group.id }))}
          onChange={(id) => { setDestination(id); setResult(null); setAttempt(0); }} /></Field>
        <Button disabled={!destination || loading || executing} onClick={() => { setLoading(true); setResult(null); setAttempt((value) => value + 1); }}>{result ? "Refresh impact preview" : "Review impact"}</Button>
        {loading && <LoadingPane label="Refreshing membership, all PDE resources and group policy evidence..." />}
        {result && !result.ok && <ErrorPane title="Couldn't prepare moves" message={result.error} />}
        {result?.ok && <>
          <Text weight="semibold">Destination: {result.data.destination.displayName || result.data.destination.id}</Text>
          {portalUrl && <Link href={portalUrl} target="_blank" rel="noopener noreferrer">Open destination group in admin center</Link>}
          {result.data.pdes.map((pde) => <section key={pde.environmentId} className={styles.section}>
            <Text as="h3" weight="semibold">{pde.environment?.displayName || pde.environmentId}</Text>
            <Badge appearance="outline">{task?.running
              ? moveTaskPhaseLabel(task.environments.find((entry) => membershipId(entry.environmentId) === membershipId(pde.environmentId))?.phase ?? "queued")
              : pde.status === "prepared" ? "Ready for review" : pde.status === "already-member" ? "Already in destination" : "Cannot prepare move"}</Badge>
            {pde.status === "error" ? <ErrorPane title="PDE impact unavailable" message={pde.error || "Preparation failed."} /> : <>
              <Text>Source: {pde.sourceEvidence?.details.ok ? pde.sourceEvidence.details.data.displayName || pde.sourceEvidence.groupId : pde.environment?.environmentGroup || pde.environment?.environmentGroupId || "No environment group"} → Destination: {result.data.destination.displayName || result.data.destination.id}</Text>
              <Text weight="semibold">{pde.apps.length} affected apps · {pde.resourceCount - pde.apps.length} other inventory resources</Text>
              <ul className={styles.list}>{pde.apps.map((app) => <li key={`${app.type}:${app.id}`}>{app.displayName || app.id}</li>)}</ul>
              {(!pde.sourceEvidence?.policies.ok || !pde.sourceEvidence?.rulesets.ok || !pde.destinationEvidence?.policies.ok || !pde.destinationEvidence?.rulesets.ok) && <MessageBar intent="warning"><MessageBarBody>Policy comparison is incomplete. Inspect source / destination evidence below; missing sections are not treated as safe, unrestricted or blocked.</MessageBarBody></MessageBar>}
              <details><summary>Policy evidence and resource details</summary>
                <Caption1>PDE ID: {pde.environmentId} · Source group ID: {pde.environment?.environmentGroupId || "No membership"} · Destination group ID: {result.data.destination.id} · Read {new Date(result.data.preparedAt).toLocaleTimeString()}. External changes can invalidate this preview.</Caption1>
                <ul className={styles.list}>{pde.apps.map((app) => <li key={`${app.type}:${app.id}`}>{app.displayName || app.id}: {app.type} · {app.id}</li>)}</ul>
                <Text>Source</Text><EvidenceProblems evidence={pde.sourceEvidence} />
                <Text>Destination</Text><EvidenceProblems evidence={pde.destinationEvidence} />
              </details>
              <RuleComparison source={pde.sourceEvidence} destination={pde.destinationEvidence} />
              <details><summary>Connector configuration and observed usage ({pde.connectors.length})</summary>
                <Text>Observed operations are inventory evidence, not a complete behavioral guarantee. Unknown or not-listed permissions are never treated as safe or blocked.</Text>
                {!pde.connectors.length && <Text>No connector references returned. This does not prove that apps use no connectors.</Text>}
                {pde.connectors.map((connector) => <div key={connector.id} className={styles.section}>
                  <Text weight="semibold">{connector.name} · {connector.id}</Text>
                  <Caption1>Observed operations: {connector.operations.join(", ") || "Unavailable"}</Caption1>
                  <Text>Source configuration</Text><ConnectorConfiguration value={connector.source} />
                  <Text>Destination configuration</Text><ConnectorConfiguration value={connector.destination} />
                </div>)}
              </details>
            </>}
          </section>)}
        </>}
        </>}
        <PdeMoveExecution key={`${destination}:${attempt}`} preview={result?.ok ? result.data : null} statusOnly={!selection.length}
          selectedEnvironmentIds={selection.map((item) => item.environmentId)}
          environmentNames={environmentNames} groupNames={Object.fromEntries(groups.map((group) => [membershipId(group.id), group.displayName || group.id]))}
          onBusyChange={(busy) => { setChecking(busy); onBusyChange(busy); }}
          onStatusChecked={onStatusChecked} onReviewRecovery={onReviewRecovery} />
      </DialogContent>
      <DialogActions><Button appearance="primary" onClick={onClose}>{task?.running ? "Continue in background" : "Close preview"}</Button></DialogActions>
    </DialogBody></DialogSurface>
  </Dialog>;
}
