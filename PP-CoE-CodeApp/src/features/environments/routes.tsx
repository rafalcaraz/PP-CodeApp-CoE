import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const EnvironmentsList = lazy(() =>
  import("./EnvironmentsList").then((m) => ({ default: m.EnvironmentsList })),
);
const EnvironmentDetail = lazy(() =>
  import("./EnvironmentDetail").then((m) => ({ default: m.EnvironmentDetail })),
);
const PdeLandscape = lazy(() =>
  import("./PdeLandscape").then((m) => ({ default: m.PdeLandscape })),
);

/**
 * Returns the `<Route>` elements for the environments feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function environmentsRoutes() {
  return [
    <Route key="environments-EnvironmentsList--environments" path="/environments" element={<EnvironmentsList />} />,
    <Route key="environments-EnvironmentDetail--environments--envId" path="/environments/:envId" element={<EnvironmentDetail />} />,
    <Route key="environments-PdeLandscape--pde-landscape" path="/pde-landscape" element={<PdeLandscape />} />,
  ];
}
