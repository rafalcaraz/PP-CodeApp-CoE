import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const AgentsList = lazy(() =>
  import("./AgentsList").then((m) => ({ default: m.AgentsList })),
);
const AgentDetail = lazy(() =>
  import("./AgentDetail").then((m) => ({ default: m.AgentDetail })),
);

/**
 * Returns the `<Route>` elements for the Agents feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function agentsRoutes() {
  return [
    <Route key="agents-list" path="/agents" element={<AgentsList />} />,
    <Route
      key="agents-detail"
      path="/agents/:agentId"
      element={<AgentDetail />}
    />,
  ];
}
