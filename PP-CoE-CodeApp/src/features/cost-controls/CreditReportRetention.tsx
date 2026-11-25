import { useEffect, useState } from "react";
import { Badge, Button, Checkbox, Text } from "@fluentui/react-components";
import {
  initializeCreditReportRetention, setCreditReportRetention, useCreditReportRetention,
} from "../../shared/credit-reports";
import { ErrorPane } from "../../components/Status";
import { useCostStyles } from "./styles";

export function CreditReportRetention() {
  const styles = useCostStyles(), state = useCreditReportRetention();
  const [consent, setConsent] = useState(false);
  useEffect(() => { void initializeCreditReportRetention(); }, []);
  return <details className={styles.list}><summary>Browser history and privacy</summary>
    <Text>Retention is opt-in. Saved originals and capture provenance contain tenant data and stay in this browser profile on this app origin. They are not encrypted by this app, synced across devices, or stored in Dataverse. Do not enable on a shared browser profile. Browser cleanup or eviction can remove history; keep ZIP backups.</Text>
    <Badge appearance="outline">{!state.ready ? "Checking browser history" : state.error ? "Retention needs attention" : state.busy ? "Updating browser history" : state.enabled ? "Browser retention enabled" : "Session memory only"}</Badge>
    {!state.enabled && <Checkbox label="I consent to keeping these tenant reports in this browser profile" checked={consent} onChange={(_, data) => setConsent(data.checked === true)} />}
    <div className={styles.row}>
      <Button disabled={!state.ready || state.busy || (!state.enabled && !consent)} onClick={() => void setCreditReportRetention(true)}>
        {state.enabled ? "Save browser history again" : "Enable browser retention"}
      </Button>
      <Button disabled={!state.ready || state.busy} onClick={() => { setConsent(false); void setCreditReportRetention(false); }}>Disable and delete saved browser reports</Button>
    </div>
    {state.savedAt && <Text size={200}>Last browser save: {state.savedAt}. Limit: 100 MiB of originals. No automatic eviction by this app.</Text>}
    {state.error && <ErrorPane title="Browser retention needs attention" message={state.error} />}
  </details>;
}
