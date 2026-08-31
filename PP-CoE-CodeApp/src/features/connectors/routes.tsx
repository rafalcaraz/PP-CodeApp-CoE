import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const ConnectorsList = lazy(() =>
  import("./ConnectorsList").then((m) => ({ default: m.ConnectorsList })),
);
const ConnectorDetail = lazy(() =>
  import("./ConnectorDetail").then((m) => ({ default: m.ConnectorDetail })),
);

/**
 * Returns the `<Route>` elements for the connectors feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function connectorsRoutes() {
  return [
    <Route
      key="connectors-ConnectorsList--connectors"
      path="/connectors"
      element={<ConnectorsList />}
    />,
    <Route
      key="connectors-ConnectorDetail--connectors--connectorId"
      path="/connectors/:connectorId"
      element={<ConnectorDetail />}
    />,
  ];
}
