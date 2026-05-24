import {
  Badge,
  Card,
  Divider,
  Switch,
  Text,
  makeStyles,
  tokens,
  type SwitchOnChangeData,
} from "@fluentui/react-components";
import {
  FEATURE_FLAGS,
  useAllFeatureFlags,
  useSetFeatureFlag,
} from "../../featureFlags";

const useStyles = makeStyles({
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
  sectionCard: {
    padding: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
  },
  sectionTitleColumn: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  flagRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalL,
  },
  flagText: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    flex: 1,
    minWidth: 0,
  },
  flagDescription: {
    color: tokens.colorNeutralForeground3,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export function SettingsView() {
  const styles = useStyles();
  const flags = useAllFeatureFlags();
  const setFlag = useSetFeatureFlag();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Settings
        </Text>
        <Text className={styles.subtitle}>
          Per-user preferences for this CoE inventory app.
        </Text>
      </div>

      <Card className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleColumn}>
            <Text size={500} weight="semibold">
              Feature flags
            </Text>
            <Text className={styles.hint}>
              Stored in your browser&apos;s local storage. In a future
              release these will be sourced from environment variables so
              tenant operators can enforce them centrally.
            </Text>
          </div>
          <Badge appearance="outline" color="informative">
            Local storage
          </Badge>
        </div>

        <Divider />

        {FEATURE_FLAGS.map((def, index) => {
          const checked = flags[def.key];
          return (
            <div key={def.key}>
              <div className={styles.flagRow}>
                <div className={styles.flagText}>
                  <Text weight="semibold">{def.label}</Text>
                  <Text className={styles.flagDescription}>
                    {def.description}
                  </Text>
                </div>
                <Switch
                  checked={checked}
                  onChange={(_, data: SwitchOnChangeData) =>
                    setFlag(def.key, data.checked)
                  }
                  aria-label={def.label}
                  label={checked ? "On" : "Off"}
                  labelPosition="before"
                />
              </div>
              {index < FEATURE_FLAGS.length - 1 && <Divider />}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
