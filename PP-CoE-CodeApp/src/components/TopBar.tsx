import { makeStyles, tokens, Text, Avatar } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    height: "48px",
    minHeight: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    borderBottom: `1px solid ${tokens.colorBrandStroke2}`,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  title: {
    color: tokens.colorNeutralForegroundOnBrand,
    fontWeight: tokens.fontWeightSemibold,
  },
});

export function TopBar() {
  const styles = useStyles();
  return (
    <header className={styles.root}>
      <div className={styles.brand}>
        <Text className={styles.title} size={400}>
          Power Platform Center of Excellence
        </Text>
      </div>
      <Avatar size={28} name="Admin" />
    </header>
  );
}
