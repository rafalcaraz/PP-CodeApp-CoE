import { useCallback, useEffect, useState } from "react";
import {
  makeStyles,
  mergeClasses,
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
  ChartMultipleRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  BranchCompareRegular,
  EarthRegular,
  FlowRegular,
  HomeRegular,
  PeopleTeamRegular,
  SearchSquareRegular,
  SettingsRegular,
  ShieldRegular,
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
    overflowY: "auto",
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
  section: {
    display: "flex",
    flexDirection: "column",
    marginBottom: tokens.spacingVerticalXS,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    width: "100%",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    paddingInline: tokens.spacingHorizontalL,
    paddingBlock: tokens.spacingVerticalXS,
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    ":hover": {
      color: tokens.colorNeutralForeground2,
    },
    ":focus-visible": {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: "-2px",
    },
  },
  sectionHeaderIcon: {
    display: "inline-flex",
    alignItems: "center",
    color: tokens.colorNeutralForeground3,
  },
  sectionHeaderLabel: {
    flex: 1,
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

interface NavSection {
  key: string;
  label: string;
  icon?: React.ReactElement;
  defaultOpen?: boolean;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    key: "inventory",
    label: "Inventory",
    defaultOpen: true,
    items: [
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
      { key: "settings", label: "Settings", icon: <SettingsRegular />, path: "/settings" },
    ],
  },
  {
    key: "security",
    label: "Security",
    icon: <ShieldRegular />,
    defaultOpen: true,
    items: [
      {
        key: "comparator",
        label: "Comparator",
        icon: <BranchCompareRegular />,
        path: "/security/comparator",
      },
      {
        key: "impact",
        label: "Impact",
        icon: <ChartMultipleRegular />,
        path: "/security/impact",
      },
    ],
  },
];

const COLLAPSED_STORAGE_KEY = "ppcoe.sidenav.collapsedSections";

function loadCollapsedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedSections(collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(collapsed)));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function SideNav() {
  const styles = useStyles();
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const stored = loadCollapsedSections();
    // Seed with sections that opt out of defaultOpen, unless the user already
    // expanded them in a previous session.
    for (const section of NAV_SECTIONS) {
      if (section.defaultOpen === false && !stored.has(section.key)) {
        stored.add(section.key);
      }
    }
    return stored;
  });

  useEffect(() => {
    saveCollapsedSections(collapsed);
  }, [collapsed]);

  const toggleSection = useCallback((sectionKey: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  const allItems = NAV_SECTIONS.flatMap((s) => s.items);
  const activeKey =
    allItems.find((item) => item.path && location.pathname.startsWith(item.path))?.key ?? "home";

  const onSelect = (_e: SelectTabEvent, data: SelectTabData) => {
    const target = allItems.find((item) => item.key === data.value);
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
      {NAV_SECTIONS.map((section) => {
        const isCollapsed = collapsed.has(section.key);
        const sectionId = `sidenav-section-${section.key}`;
        return (
          <div key={section.key} className={styles.section}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => toggleSection(section.key)}
              aria-expanded={!isCollapsed}
              aria-controls={sectionId}
            >
              <span className={styles.sectionHeaderIcon} aria-hidden="true">
                {isCollapsed ? <ChevronRightRegular /> : <ChevronDownRegular />}
              </span>
              {section.icon && (
                <span className={styles.sectionHeaderIcon} aria-hidden="true">
                  {section.icon}
                </span>
              )}
              <span className={styles.sectionHeaderLabel}>{section.label}</span>
            </button>
            {!isCollapsed && (
              <TabList
                id={sectionId}
                className={mergeClasses(styles.tabList)}
                vertical
                // Each TabList is independent; only the list owning the active
                // item will visually highlight it. Passing the global activeKey
                // is harmless for the others.
                selectedValue={activeKey}
                onTabSelect={onSelect}
                size="large"
              >
                {section.items.map((item) => (
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
            )}
          </div>
        );
      })}
    </nav>
  );
}
