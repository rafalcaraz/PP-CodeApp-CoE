import { Link, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { isCompletedClone, type CloneOutcome } from "./groupClone";

export function CloneCompletionNotice({ outcome }: { outcome: CloneOutcome | null }) {
  if (!outcome || !isCompletedClone(outcome.operation.phase) || !outcome.destinationUrl) return null;
  return <MessageBar intent={outcome.operation.phase === "verified" ? "success" : "warning"}><MessageBarBody>
    {outcome.message} <Link href={outcome.destinationUrl} target="_blank" rel="noopener noreferrer">Open verified destination group in admin center</Link>
    {!!outcome.operation.skipped?.length && <ul>{outcome.operation.skipped.map((entry) => <li key={`${entry.kind}:${entry.id}`}>
      {entry.kind === "group-rule" ? "Group settings" : entry.id}: {entry.reasons.join(" ")}
    </li>)}</ul>}
  </MessageBarBody></MessageBar>;
}
