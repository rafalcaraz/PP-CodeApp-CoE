import {
  makeStyles,
  tokens,
  Text,
  Tab,
  TabList,
  type SelectTabEvent,
  type SelectTabData,
} from "@fluentui/react-components";
import {
  AppsRegular,
  BotRegular,
  EarthRegular,
  FlowRegular,
  HomeRegular,
  PeopleTeamRegular,
  SearchSquareRegular,
  SettingsRegular,
  DataPieRegular,
} from "@fluentui/react-icons";
import { useLocation, useNavigate } from "react-router-dom";

const useStyles = makeStyles({
  root: {
    width: "240px",
    minWidth: "240px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    paddingTop: tokens.spacingVerticalM,
  },
  brand: {
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalS,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
  },
  brandTitle: {
    fontWeight: tokens.fontWeightSemibold,
  },
  brandSubtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  tabList: {
    paddingInlineStart: tokens.spacingHorizontalS,
    paddingInlineEnd: tokens.spacingHorizontalS,
  },
  tab: {
    justifyContent: "flex-start",
  },
});

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactElement;
  path?: string; // when set, the item is enabled
}

const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Home", icon: <HomeRegular />, path: "/home" },
  { key: "dashboards", label: "Dashboards", icon: <DataPieRegular />, path: "/dashboards" },
  {
    key: "environment-groups",
    label: "Environment groups",
    icon: <PeopleTeamRegular />,
    path: "/environment-groups",
  },
  {
    key: "environments",
    label: "Environments",
    icon: <EarthRegular />,
    path: "/environments",
  },
  { key: "apps", label: "Apps", icon: <AppsRegular />, path: "/apps" },
  { key: "flows", label: "Flows", icon: <FlowRegular />, path: "/flows" },
  { key: "agents", label: "Agents", icon: <BotRegular />, path: "/agents" },
  { key: "queries", label: "Queries", icon: <SearchSquareRegular />, path: "/queries" },
  { key: "settings", label: "Settings", icon: <SettingsRegular /> },
];

export function SideNav() {
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();

  const activeKey =
    NAV_ITEMS.find((item) => item.path && location.pathname.startsWith(item.path))?.key ?? "home";

  const onSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    const target = NAV_ITEMS.find((item) => item.key === data.value);
    if (target?.path) {
      navigate(target.path);
    }
  };

  return (
    <nav className={styles.root} aria-label="Primary">
      <div className={styles.brand}>
        <Text className={styles.brandTitle} size={500}>
          Power Platform CoE
        </Text>
        <Text className={styles.brandSubtitle}>Inventory &amp; governance</Text>
      </div>
      <TabList
        className={styles.tabList}
        vertical
        selectedValue={activeKey}
        onTabSelect={onSelect}
        size="large"
      >
        {NAV_ITEMS.map((item) => (
          <Tab
            key={item.key}
            value={item.key}
            icon={item.icon}
            disabled={!item.path}
            className={styles.tab}
          >
            {item.label}
          </Tab>
        ))}
      </TabList>
    </nav>
  );
}
