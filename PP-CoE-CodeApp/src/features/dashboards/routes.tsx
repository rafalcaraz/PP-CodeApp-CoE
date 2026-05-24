import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const DashboardsList = lazy(() =>
  import("./DashboardsList").then((m) => ({ default: m.DashboardsList })),
);
const DashboardDetail = lazy(() =>
  import("./DashboardDetail").then((m) => ({ default: m.DashboardDetail })),
);

/**
 * Returns the `<Route>` elements for the dashboards feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function dashboardsRoutes() {
  return [
    <Route key="dashboards-DashboardsList--dashboards" path="/dashboards" element={<DashboardsList />} />,
    <Route key="dashboards-DashboardDetail--dashboards--dashboardId" path="/dashboards/:dashboardId" element={<DashboardDetail />} />,
  ];
}
