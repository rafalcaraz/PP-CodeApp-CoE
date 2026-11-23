import { useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { CheckmarkRegular, CopyRegular } from "@fluentui/react-icons";
import { formatApiError } from "./schema";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", alignItems: "start", gap: tokens.spacingVerticalXS },
  error: { color: tokens.colorStatusDangerForeground1 },
});

export function CopyTextButton({ text, label }: { text: string; label: string }) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error?: string } | null>(null);
  const current = result?.text === text ? result : null;
  const copied = current !== null && current.error === undefined;

  async function copy() {
    setBusy(true);
    setResult(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser or player.");
      await navigator.clipboard.writeText(text);
      setResult({ text });
    } catch (error) {
      setResult({ text, error: `Could not copy: ${formatApiError(error)} Select the displayed text and copy it manually.` });
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.root}>
    <Button size="small" appearance="subtle" aria-label={label} disabled={busy || !text}
      icon={copied ? <CheckmarkRegular /> : <CopyRegular />} onClick={() => void copy()}>
      {copied ? "Copied" : label}
    </Button>
    {copied && <Text size={200} role="status">Copied to clipboard.</Text>}
    {current?.error && <Text size={200} className={styles.error} role="alert">{current.error}</Text>}
  </div>;
}
