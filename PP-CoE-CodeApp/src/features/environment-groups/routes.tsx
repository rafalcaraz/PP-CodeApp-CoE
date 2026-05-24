import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const EnvironmentGroupsList = lazy(() =>
  import("./EnvironmentGroupsList").then((m) => ({ default: m.EnvironmentGroupsList })),
);
const EnvironmentGroupDetail = lazy(() =>
  import("./EnvironmentGroupDetail").then((m) => ({ default: m.EnvironmentGroupDetail })),
);

/**
 * Returns the `<Route>` elements for the environment-groups feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function environmentGroupsRoutes() {
  return [
    <Route key="environment-groups-EnvironmentGroupsList--environment-groups" path="/environment-groups" element={<EnvironmentGroupsList />} />,
    <Route key="environment-groups-EnvironmentGroupDetail--environment-groups--groupId" path="/environment-groups/:groupId" element={<EnvironmentGroupDetail />} />,
  ];
}
