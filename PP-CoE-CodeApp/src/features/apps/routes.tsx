import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const AppsList = lazy(() =>
  import("./AppsList").then((m) => ({ default: m.AppsList })),
);
const AppDetail = lazy(() =>
  import("./AppDetail").then((m) => ({ default: m.AppDetail })),
);

/**
 * Returns the `<Route>` elements for the apps feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function appsRoutes() {
  return [
    <Route key="apps-AppsList--apps" path="/apps" element={<AppsList />} />,
    <Route key="apps-AppDetail--apps--appId" path="/apps/:appId" element={<AppDetail />} />,
  ];
}
