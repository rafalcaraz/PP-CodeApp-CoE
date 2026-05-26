import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const QueriesView = lazy(() =>
  import("./QueriesView").then((m) => ({ default: m.QueriesView })),
);

/**
 * Returns the `<Route>` elements for the queries feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function queriesRoutes() {
  return [
    <Route key="queries-QueriesView--queries" path="/queries" element={<QueriesView />} />,
  ];
}
