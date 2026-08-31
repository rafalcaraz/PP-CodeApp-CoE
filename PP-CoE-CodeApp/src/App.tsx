import { lazy, Suspense, useEffect } from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { HashRouter, Route, Routes } from "react-router-dom";
import { SideNav } from "./components/SideNav";
import { TopBar } from "./components/TopBar";
import { UserLookupProvider } from "./components/UserLookupProvider";
import { AdminAccessGate } from "./components/AdminAccessGate";
import { LoadingPane } from "./components/Status";
import { HomeRedirect } from "./app/HomeRedirect";
import { FeatureFlagsProvider, useFeatureFlag } from "./featureFlags";
import { loadCatalog } from "./shared/connector-catalog";

// ---------------------------------------------------------------------------
// Feature-slice routing.
//
// Each feature exports a `<feature>Routes()` function from its own
// `routes.tsx` that returns the `<Route>` elements for that feature
// (lazy-loaded at the feature boundary). Adding a new feature now means
// creating one folder + adding one import + one spread here — no central
// registry to corrupt.
//
// HomeRedirect stays eager — it's tiny and is the landing route, so lazy
// loading would add a Suspense fallback flash on cold boot for no win.
// ---------------------------------------------------------------------------
import { agentsRoutes } from "./features/agents";
import { appsRoutes } from "./features/apps";
import { flowsRoutes } from "./features/flows";
import { environmentsRoutes } from "./features/environments";
import { environmentGroupsRoutes } from "./features/environment-groups";
import { dashboardsRoutes } from "./features/dashboards";
import { zonesRoutes } from "./features/zones";
import { securityRoutes } from "./features/security";
import { queriesRoutes } from "./features/queries";
import { connectorsRoutes } from "./features/connectors";
import { deepInventoryRoutes } from "./features/deep-inventory";
import { settingsRoutes } from "./features/settings";

const CopilotChatLauncher = lazy(() =>
  import("./components/CopilotChat").then((m) => ({ default: m.CopilotChatLauncher }))
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
  // Bootstrap the tenant connector catalog once on mount. QueryResources is
  // primary; the legacy environment probe is retained as a preview/sovereign
  // fallback. Consumers re-render when the cached snapshot lands.
  useEffect(() => {
    void loadCatalog();
  }, []);
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
              {/* Feature routes — see src/features/<name>/routes.tsx */}
              {dashboardsRoutes()}
              {environmentGroupsRoutes()}
              {environmentsRoutes()}
              {appsRoutes()}
              {flowsRoutes()}
              {agentsRoutes()}
              {queriesRoutes()}
              {connectorsRoutes()}
              {deepInventoryRoutes()}
              {settingsRoutes()}
              {securityRoutes()}
              {zonesRoutes()}
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
          <UserLookupProvider>
            <AdminAccessGate>
              <AppShell />
            </AdminAccessGate>
          </UserLookupProvider>
        </HashRouter>
      </FeatureFlagsProvider>
    </FluentProvider>
  );
}

export default App;
