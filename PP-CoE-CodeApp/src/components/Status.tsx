import { makeStyles, tokens, Spinner, MessageBar, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";

const useStyles = makeStyles({
  centered: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: tokens.spacingVerticalXXXL,
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    paddingBlock: tokens.spacingVerticalXXXL,
    textAlign: "center",
  },
});

export function LoadingPane({ label = "Loading…" }: { label?: string }) {
  const styles = useStyles();
  return (
    <div className={styles.centered}>
      <Spinner label={label} />
    </div>
  );
}

export function ErrorPane({ title, message }: { title: string; message: string }) {
  return (
    <MessageBar intent="error">
      <MessageBarBody>
        <MessageBarTitle>{title}</MessageBarTitle>
        {message}
      </MessageBarBody>
    </MessageBar>
  );
}

export function EmptyPane({ message }: { message: string }) {
  const styles = useStyles();
  return <div className={styles.empty}>{message}</div>;
}
