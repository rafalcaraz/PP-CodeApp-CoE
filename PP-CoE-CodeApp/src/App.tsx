import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { HashRouter, Route, Routes } from "react-router-dom";
import { SideNav } from "./components/SideNav";
import { TopBar } from "./components/TopBar";
import { EnvironmentGroupsList } from "./views/EnvironmentGroupsList";
import { EnvironmentGroupDetail } from "./views/EnvironmentGroupDetail";
import { EnvironmentsList } from "./views/EnvironmentsList";
import { EnvironmentDetail } from "./views/EnvironmentDetail";
import { AppsList } from "./views/AppsList";
import { AppDetail } from "./views/AppDetail";
import { FlowsList } from "./views/FlowsList";
import { FlowDetail } from "./views/FlowDetail";
import { AgentsList } from "./views/AgentsList";
import { AgentDetail } from "./views/AgentDetail";
import { QueriesView } from "./views/QueriesView";
import { DashboardsList } from "./views/DashboardsList";
import { DashboardDetail } from "./views/DashboardDetail";
import { HomeRedirect } from "./views/HomeRedirect";

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
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </FluentProvider>
  );
}

export default App;
