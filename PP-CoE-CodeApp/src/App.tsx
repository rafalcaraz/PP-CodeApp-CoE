import { lazy, Suspense } from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { HashRouter, Route, Routes } from "react-router-dom";
import { SideNav } from "./components/SideNav";
import { TopBar } from "./components/TopBar";
import { LoadingPane } from "./components/Status";
import { HomeRedirect } from "./views/HomeRedirect";
import { FeatureFlagsProvider, useFeatureFlag } from "./featureFlags";

// ---------------------------------------------------------------------------
// Route-level code splitting.
//
// Every page is loaded lazily so the initial bundle only contains the shell
// (Fluent provider, side nav, top bar, router, redirect logic). Each route
// becomes its own chunk that Vite/Rollup downloads on demand the first time
// the user navigates to it. The lazy chunks themselves are then cached by
// the browser, so subsequent visits are instant.
//
// HomeRedirect stays eager — it's tiny and is the landing route, so lazy
// loading would add a Suspense fallback flash on cold boot for no win.
// ---------------------------------------------------------------------------
const EnvironmentGroupsList = lazy(() =>
  import("./views/EnvironmentGroupsList").then((m) => ({ default: m.EnvironmentGroupsList }))
);
const EnvironmentGroupDetail = lazy(() =>
  import("./views/EnvironmentGroupDetail").then((m) => ({ default: m.EnvironmentGroupDetail }))
);
const EnvironmentsList = lazy(() =>
  import("./views/EnvironmentsList").then((m) => ({ default: m.EnvironmentsList }))
);
const EnvironmentDetail = lazy(() =>
  import("./views/EnvironmentDetail").then((m) => ({ default: m.EnvironmentDetail }))
);
const AppsList = lazy(() =>
  import("./views/AppsList").then((m) => ({ default: m.AppsList }))
);
const AppDetail = lazy(() =>
  import("./views/AppDetail").then((m) => ({ default: m.AppDetail }))
);
const FlowsList = lazy(() =>
  import("./views/FlowsList").then((m) => ({ default: m.FlowsList }))
);
const FlowDetail = lazy(() =>
  import("./views/FlowDetail").then((m) => ({ default: m.FlowDetail }))
);
const AgentsList = lazy(() =>
  import("./views/AgentsList").then((m) => ({ default: m.AgentsList }))
);
const AgentDetail = lazy(() =>
  import("./views/AgentDetail").then((m) => ({ default: m.AgentDetail }))
);
const QueriesView = lazy(() =>
  import("./views/QueriesView").then((m) => ({ default: m.QueriesView }))
);
const DashboardsList = lazy(() =>
  import("./views/DashboardsList").then((m) => ({ default: m.DashboardsList }))
);
const DashboardDetail = lazy(() =>
  import("./views/DashboardDetail").then((m) => ({ default: m.DashboardDetail }))
);
const CopilotChatLauncher = lazy(() =>
  import("./components/CopilotChat").then((m) => ({ default: m.CopilotChatLauncher }))
);
const SettingsView = lazy(() =>
  import("./views/SettingsView").then((m) => ({ default: m.SettingsView }))
);
const Comparator = lazy(() =>
  import("./views/Comparator").then((m) => ({ default: m.Comparator }))
);
const DlpImpact = lazy(() =>
  import("./views/DlpImpact").then((m) => ({ default: m.DlpImpact }))
);

const useStyles = makeStyles({
  app: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: "flex",
  },
  content: {
    flex: 1,
    minWidth: 0,
    overflow: "auto",
    padding: tokens.spacingHorizontalXXL,
  },
});

function AppShell() {
  const styles = useStyles();
  return (
    <div className={styles.app}>
      <TopBar />
      <div className={styles.body}>
        <SideNav />
        <main className={styles.content}>
          {/* Single Suspense boundary catches every lazy route. The fallback
              is brief (chunk sizes are small and the browser caches them) so
              one shared spinner reads as a normal page-level loading state. */}
          <Suspense fallback={<LoadingPane label="Loading…" />}>
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/home" element={<HomeRedirect />} />
              <Route path="/dashboards" element={<DashboardsList />} />
              <Route path="/dashboards/:dashboardId" element={<DashboardDetail />} />
              <Route path="/environment-groups" element={<EnvironmentGroupsList />} />
              <Route
                path="/environment-groups/:groupId"
                element={<EnvironmentGroupDetail />}
              />
              <Route path="/environments" element={<EnvironmentsList />} />
              <Route path="/environments/:envId" element={<EnvironmentDetail />} />
              <Route path="/apps" element={<AppsList />} />
              <Route path="/apps/:appId" element={<AppDetail />} />
              <Route path="/flows" element={<FlowsList />} />
              <Route path="/flows/:flowId" element={<FlowDetail />} />
              <Route path="/agents" element={<AgentsList />} />
              <Route path="/agents/:agentId" element={<AgentDetail />} />
              <Route path="/queries" element={<QueriesView />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="/security/dlp-comparator" element={<Comparator />} />
              <Route path="/security/comparator" element={<Comparator />} />
              <Route path="/security/dlp-impact" element={<DlpImpact />} />
              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      {/* Global floating Copilot Studio chat launcher. Lives outside the
          routed <main> so it persists across every route. The launcher
          itself is lazy-loaded so the panel + service wrapper stay out of
          the initial bundle until the user opens it.
          Gated by the `copilotStudioAssistant` feature flag — when it's
          off (the default), nothing renders, the lazy chunk never loads,
          and the connector is never contacted. */}
      <CopilotAssistantSlot />
    </div>
  );
}

function CopilotAssistantSlot() {
  const enabled = useFeatureFlag("copilotStudioAssistant");
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <CopilotChatLauncher />
    </Suspense>
  );
}

function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <FeatureFlagsProvider>
        <HashRouter>
          <AppShell />
        </HashRouter>
      </FeatureFlagsProvider>
    </FluentProvider>
  );
}

export default App;
