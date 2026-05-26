import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const FlowsList = lazy(() =>
  import("./FlowsList").then((m) => ({ default: m.FlowsList })),
);
const FlowDetail = lazy(() =>
  import("./FlowDetail").then((m) => ({ default: m.FlowDetail })),
);

/**
 * Returns the `<Route>` elements for the flows feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function flowsRoutes() {
  return [
    <Route key="flows-FlowsList--flows" path="/flows" element={<FlowsList />} />,
    <Route key="flows-FlowDetail--flows--flowId" path="/flows/:flowId" element={<FlowDetail />} />,
  ];
}
