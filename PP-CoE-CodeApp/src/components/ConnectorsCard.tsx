import {
  makeStyles,
  tokens,
  Text,
  Card,
  CardHeader,
  Divider,
  Badge,
} from "@fluentui/react-components";
import type { ResourceConnector, ResourceConnectorOperation } from "../data/inventory";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
  },
  body: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
  connector: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  connectorHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  connectorName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  connectorId: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontFamily: "Consolas, 'Courier New', monospace",
  },
  ops: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    marginInlineStart: tokens.spacingHorizontalL,
  },
  opRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
    fontSize: tokens.fontSizeBase200,
  },
  opName: {
    fontFamily: "Consolas, 'Courier New', monospace",
    color: tokens.colorNeutralForeground1,
  },
  opMuted: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },
  noOps: {
    marginInlineStart: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontStyle: "italic",
  },
  empty: {
    padding: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface ConnectorsCardProps {
  connectors: ResourceConnector[];
}

function usedAsColor(usedAs: string | undefined): "brand" | "success" | "informative" | "subtle" {
  switch ((usedAs ?? "").toLowerCase()) {
    case "tool":
      return "brand";
    case "knowledge":
      return "success";
    case "topic tool":
      return "informative";
    default:
      return "subtle";
  }
}

function OperationRow({ op }: { op: ResourceConnectorOperation }) {
  const styles = useStyles();
  return (
    <div className={styles.opRow}>
      {op.operationId ? (
        <span className={styles.opName}>{op.operationId}</span>
      ) : (
        <span className={styles.opMuted}>(no operation — connector only)</span>
      )}
      {op.usedAs && (
        <Badge appearance="filled" color={usedAsColor(op.usedAs)} size="small">
          {op.usedAs}
        </Badge>
      )}
      {op.isEnabled === false && (
        <Badge appearance="filled" color="danger" size="small">
          Disabled
        </Badge>
      )}
      {op.connectionProvider && (
        <Badge appearance="outline" size="small">
          {op.connectionProvider}
        </Badge>
      )}
      {op.requiresEndUserConsent && (
        <Badge appearance="outline" color="warning" size="small">
          End-user consent
        </Badge>
      )}
      {op.whenCanBeUsed && op.whenCanBeUsed !== "Anytime" && (
        <Badge appearance="outline" size="small">
          {op.whenCanBeUsed}
        </Badge>
      )}
    </div>
  );
}

/** Renders the `properties.powerPlatformConnectors` array from inventory:
 *  - A quick-glance chip strip of connector display names at top.
 *  - For each connector, a section listing the operations declared. When the
 *    inventory provides rich per-operation metadata (as for Copilot Studio
 *    agents) the row shows badges for `usedAs`, `isEnabled`,
 *    `connectionProvider`, `requiresEndUserConsent`, and `whenCanBeUsed`.
 *
 *  When the source array is empty (the resource doesn't declare any —
 *  e.g. a Code app), an inline empty-state explains that. */
export function ConnectorsCard({ connectors }: ConnectorsCardProps) {
  const styles = useStyles();
  const totalOps = connectors.reduce((sum, c) => sum + c.operations.length, 0);

  return (
    <Card className={styles.root}>
      <CardHeader
        header={
          <Text weight="semibold">
            Connectors &amp; actions
            {connectors.length > 0 && ` (${connectors.length})`}
          </Text>
        }
        description={
          connectors.length > 0 ? (
            <Text size={200}>
              {totalOps > 0
                ? `${totalOps} declared operation${totalOps === 1 ? "" : "s"}`
                : "No specific operations declared"}
            </Text>
          ) : undefined
        }
      />
      <Divider />
      {connectors.length === 0 ? (
        <div className={styles.empty}>
          No connector usage reported by the inventory schema for this resource.
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.chips}>
            {connectors.map((c) => (
              <Badge
                key={c.connectorId}
                appearance="tint"
                color="informative"
                size="medium"
              >
                {c.displayName}
              </Badge>
            ))}
          </div>

          {connectors.map((c) => (
            <div key={c.connectorId} className={styles.connector}>
              <div className={styles.connectorHeader}>
                <Text className={styles.connectorName}>{c.displayName}</Text>
                <Text className={styles.connectorId}>{c.connectorId}</Text>
                <Badge appearance="outline" size="small">
                  {c.operations.length === 0
                    ? "no operations declared"
                    : `${c.operations.length} operation${c.operations.length === 1 ? "" : "s"}`}
                </Badge>
                {c.connectionType && (
                  <Badge appearance="outline" color="informative" size="small">
                    {c.connectionType}
                  </Badge>
                )}
              </div>
              {c.operations.length > 0 ? (
                <div className={styles.ops}>
                  {c.operations.map((op, idx) => (
                    <OperationRow key={`${op.operationId || "op"}-${idx}`} op={op} />
                  ))}
                </div>
              ) : (
                <div className={styles.opMuted}>
                  Connector is referenced but no specific operation IDs were captured.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

