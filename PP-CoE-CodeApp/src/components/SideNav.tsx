import { useCallback, useEffect, useMemo, useState } from "react";
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
  CopyRegular,
  DataTrending24Regular,
  EarthRegular,
  FlowRegular,
  HomeRegular,
  Library24Regular,
  LockClosed24Regular,
  PeopleTeamRegular,
  PersonAccountsRegular,
  PersonQuestionMarkRegular,
  PlugConnectedRegular,
  SearchSquareRegular,
  ScanRegular,
  SettingsRegular,
  ShieldKeyhole24Regular,
  DataPieRegular,
  GridDotsRegular,
} from "@fluentui/react-icons";
import { useLocation, useNavigate } from "react-router-dom";
import { useFeatureFlag } from "../featureFlags";

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
  // Items inside a card section don't need extra horizontal padding —
  // the card's own margin provides the visual boundary, and the Tab
  // component has its own internal padding. Adding more here squeezes
  // long labels (e.g. "Ownerless resources") into a second line.
  groupedTabList: {
    paddingInlineStart: 0,
    paddingInlineEnd: 0,
  },
  tab: {
    justifyContent: "flex-start",
  },
  // Grouped sections render as a subtle card so the section's items
  // visibly belong together and the section boundaries are obvious at
  // a glance. The background is one step lighter than the sidebar
  // (Background1 vs Background2), which reads as a soft elevated tile
  // in light theme and a soft well in dark theme without needing extra
  // borders. Standalone items (Home, Settings) skip this treatment so
  // they remain clearly top-level destinations.
  groupedSection: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    marginInline: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalXS,
  },
  groupedSectionHeader: {
    // Header sits flush with the card edges so the click target spans
    // the full card width, not just the inner padding.
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
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
  // When omitted, the section renders as a flat list of items with no
  // collapsible header. Used for ungrouped top/bottom items like Home
  // and Settings that don't belong under any wedge.
  label?: string;
  icon?: React.ReactElement;
  defaultOpen?: boolean;
  items: NavItem[];
}

// Sections rendered above the optional Zones section. Ungrouped items
// (Home, Settings) live in headerless sections so they don't carry a
// collapsible group header.
const PRE_ZONES_SECTIONS: NavSection[] = [
  {
    key: "home",
    items: [{ key: "home", label: "Home", icon: <HomeRegular />, path: "/home" }],
  },
  {
    key: "risk-governance",
    label: "Risk & Governance",
    icon: <ShieldKeyhole24Regular />,
    defaultOpen: true,
    items: [
      {
        key: "ownerless",
        label: "Ownerless resources",
        icon: <PersonQuestionMarkRegular />,
        path: "/security/ownerless",
      },
    ],
  },
  {
    key: "dlp-acp",
    label: "DLP & ACP",
    icon: <LockClosed24Regular />,
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
      {
        key: "duplicator",
        label: "Duplicator",
        icon: <CopyRegular />,
        path: "/security/duplicator",
      },
    ],
  },
];

const POST_ZONES_SECTIONS: NavSection[] = [
  {
    key: "insights",
    label: "Insights",
    icon: <DataTrending24Regular />,
    defaultOpen: true,
    items: [
      { key: "dashboards", label: "Dashboards", icon: <DataPieRegular />, path: "/dashboards" },
      {
        key: "pde-landscape",
        label: "PDE landscape",
        icon: <PersonAccountsRegular />,
        path: "/pde-landscape",
      },
      { key: "tenant-scans", label: "Tenant scans", icon: <ScanRegular />, path: "/tenant-scans" },
      { key: "queries", label: "Queries", icon: <SearchSquareRegular />, path: "/queries" },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    icon: <Library24Regular />,
    defaultOpen: true,
    items: [
      { key: "environments", label: "Environments", icon: <EarthRegular />, path: "/environments" },
      {
        key: "environment-groups",
        label: "Environment groups",
        icon: <PeopleTeamRegular />,
        path: "/environment-groups",
      },
      { key: "apps", label: "Apps", icon: <AppsRegular />, path: "/apps" },
      { key: "flows", label: "Flows", icon: <FlowRegular />, path: "/flows" },
      { key: "agents", label: "Agents", icon: <BotRegular />, path: "/agents" },
      {
        key: "connectors",
        label: "Connectors",
        icon: <PlugConnectedRegular />,
        path: "/connectors",
      },
    ],
  },
  {
    key: "settings",
    items: [
      { key: "settings", label: "Settings", icon: <SettingsRegular />, path: "/settings" },
    ],
  },
];

// Zones section is gated by a feature flag so it can ship dark. The
// view itself remains code-split, so when the flag is off no chunk loads.
const ZONES_SECTION: NavSection = {
  key: "zones",
  label: "Zones",
  icon: <GridDotsRegular />,
  defaultOpen: true,
  items: [
    {
      key: "zones-board",
      label: "Zones board",
      icon: <GridDotsRegular />,
      path: "/zones",
    },
    {
      key: "zones-reporting",
      label: "Zone reporting",
      icon: <ChartMultipleRegular />,
      path: "/zones/reporting",
    },
    {
      key: "zones-usage",
      label: "Zone usage",
      icon: <DataPieRegular />,
      path: "/zones/usage",
    },
  ],
};

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
  const zonesEnabled = useFeatureFlag("zones");

  // Merge in the optional Zones section when the flag is on. Building
  // the array at render time (rather than mutating a module constant)
  // keeps the feature-flag dependency localized to this component.
  // Zones slots in between DLP & ACP and Insights so the story arc
  // reads risk → DLP → zones → insights → resources.
  const sections = useMemo<NavSection[]>(
    () =>
      zonesEnabled
        ? [...PRE_ZONES_SECTIONS, ZONES_SECTION, ...POST_ZONES_SECTIONS]
        : [...PRE_ZONES_SECTIONS, ...POST_ZONES_SECTIONS],
    [zonesEnabled],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const stored = loadCollapsedSections();
    // Seed with sections that opt out of defaultOpen, unless the user already
    // expanded them in a previous session.
    for (const section of [...PRE_ZONES_SECTIONS, ZONES_SECTION, ...POST_ZONES_SECTIONS]) {
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

  const allItems = sections.flatMap((s) => s.items);
  const activeKey =
    allItems
      .filter(
        (item): item is NavItem & { path: string } =>
          !!item.path &&
          (location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)),
      )
      .sort((a, b) => b.path.length - a.path.length)[0]?.key ?? "home";

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
      {sections.map((section) => {
        const hasHeader = Boolean(section.label);
        // Headerless sections (Home, Settings) always render their items.
        const isCollapsed = hasHeader && collapsed.has(section.key);
        const sectionId = `sidenav-section-${section.key}`;
        return (
          <div
            key={section.key}
            className={mergeClasses(styles.section, hasHeader && styles.groupedSection)}
          >
            {hasHeader && (
              <button
                type="button"
                className={mergeClasses(styles.sectionHeader, styles.groupedSectionHeader)}
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
            )}
            {!isCollapsed && (
              <TabList
                id={sectionId}
                className={mergeClasses(styles.tabList, hasHeader && styles.groupedTabList)}
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

