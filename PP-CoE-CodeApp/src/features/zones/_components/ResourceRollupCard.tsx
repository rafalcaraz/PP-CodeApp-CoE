/**
 * Resource roll-up stat grid for the Zones surfaces.
 *
 * Mirrors the inline stat-grid pattern already used on
 * `EnvironmentGroupDetail` and `EnvironmentDetail` so a user moving
 * between an env, an env group, a custom group, and a zone always sees
 * the same shape of resource summary.
 *
 * Pulled into its own component because both `ZoneDetailView` and
 * `StandardCustomGroupDetailView` render the same card today, and a
 * future "Zone overview" tile on the dashboard surface will too.
 */
import {
  Card,
  CardHeader,
  Divider,
  makeStyles,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  EmptyPane,
  ErrorPane,
  LoadingPane,
} from "../../../components/Status";
import {
  friendlyResourceType,
  type ResourceCountRow,
} from "../../../data/inventory";

export type ResourceRollupState =
  | { kind: "loading" }
  | { kind: "ready"; rows: ResourceCountRow[] }
  | { kind: "error"; message: string };

interface Props {
  state: ResourceRollupState;
  title?: string;
  description?: string;
  /** Override the empty-state copy — defaults to a generic message. */
  emptyMessage?: string;
}

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    overflow: "hidden",
  },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalL,
  },
  statCard: {
    padding: tokens.spacingVerticalM,
  },
  statValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  bodyPad: {
    padding: tokens.spacingHorizontalL,
  },
});

export function ResourceRollupCard({
  state,
  title = "Resource roll-up",
  description = "Counts of every resource type across all environments in scope.",
  emptyMessage = "No resources found across these environments.",
}: Props) {
  const styles = useStyles();
  return (
    <Card className={styles.card}>
      <CardHeader
        header={<Text weight="semibold">{title}</Text>}
        description={<Text size={200}>{description}</Text>}
      />
      <Divider />
      {state.kind === "loading" && (
        <div className={styles.bodyPad}>
          <LoadingPane label="Loading resource counts…" />
        </div>
      )}
      {state.kind === "error" && (
        <div className={styles.bodyPad}>
          <ErrorPane
            title="Couldn't load resource roll-up"
            message={state.message}
          />
        </div>
      )}
      {state.kind === "ready" && state.rows.length === 0 && (
        <div className={styles.bodyPad}>
          <EmptyPane message={emptyMessage} />
        </div>
      )}
      {state.kind === "ready" && state.rows.length > 0 && (
        <div className={styles.statGrid}>
          {state.rows.map((row) => (
            <Card
              key={row.type}
              className={styles.statCard}
              appearance="outline"
            >
              <CardHeader
                header={
                  <Text className={styles.statValue}>
                    {row.count.toLocaleString()}
                  </Text>
                }
                description={
                  <Text className={styles.statLabel}>
                    {friendlyResourceType(row.type)}
                  </Text>
                }
              />
            </Card>
          ))}
        </div>
      )}
    </Card>
  );
}
