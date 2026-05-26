import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const ZonesView = lazy(() =>
  import("./ZonesView").then((m) => ({ default: m.ZonesView })),
);
const ZoneDetailView = lazy(() =>
  import("./ZoneDetailView").then((m) => ({ default: m.ZoneDetailView })),
);
const StandardCustomGroupDetailView = lazy(() =>
  import("./StandardCustomGroupDetailView").then((m) => ({ default: m.StandardCustomGroupDetailView })),
);

/**
 * Returns the `<Route>` elements for the zones feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function zonesRoutes() {
  return [
    <Route key="zones-ZonesView--zones" path="/zones" element={<ZonesView />} />,
    <Route key="zones-ZoneDetailView--zones--zoneId" path="/zones/:zoneId" element={<ZoneDetailView />} />,
    <Route key="zones-StandardCustomGroupDetailView--zones-custom-groups--groupId" path="/zones/custom-groups/:groupId" element={<StandardCustomGroupDetailView />} />,
  ];
}
