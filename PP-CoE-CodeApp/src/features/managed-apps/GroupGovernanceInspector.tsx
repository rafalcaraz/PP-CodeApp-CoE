import { useEffect, useRef, useState } from "react";
import { formatApiError } from "../../shared/api-explorer/schema";
import { membershipId, type EnvironmentGroupRow } from "./data";
import { loadGroupEvidenceBatch, type GroupEvidence } from "./governance";
import { GroupPanel } from "./GovernancePanels";
import { CloneCompletionNotice } from "./CloneCompletionNotice";
import type { CloneOutcome } from "./groupClone";

interface GroupGovernanceInspectorProps {
  group: EnvironmentGroupRow;
  open: boolean;
  onClose: () => void;
}

export function GroupGovernanceInspector(props: GroupGovernanceInspectorProps) {
  return <SelectedGroupInspector key={props.group.id} {...props} />;
}

function SelectedGroupInspector({ group, open, onClose }: GroupGovernanceInspectorProps) {
  const [completion, setCompletion] = useState<CloneOutcome | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return <>
    <CloneCompletionNotice outcome={completion} />
    {open && <OpenGroupInspector group={group} onClose={onClose} onCompleted={(outcome) => {
      if (!mounted.current) return;
      setCompletion(outcome); onClose();
    }} />}
  </>;
}

function OpenGroupInspector({ group, onClose, onCompleted }: Omit<GroupGovernanceInspectorProps, "open"> & {
  onCompleted: (outcome: CloneOutcome) => void;
}) {
  const [evidence, setEvidence] = useState<GroupEvidence>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadGroupEvidenceBatch([group.id], controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const selected = result.find((item) => membershipId(item.groupId) === membershipId(group.id));
      if (!selected) {
        setError("No governance evidence was returned for the selected group. Refresh to retry.");
      } else {
        setEvidence(selected);
      }
      setLoading(false);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      setError(formatApiError(failure)); setLoading(false);
    });
    return () => controller.abort();
  }, [group.id, attempt]);
  return <GroupPanel group={group} evidence={evidence} loading={loading} loadError={error}
    initialSection="rules" onRetry={() => {
      setEvidence(undefined); setLoading(true); setError(""); setAttempt((value) => value + 1);
    }} onClose={onClose} onCompleted={onCompleted} />;
}
