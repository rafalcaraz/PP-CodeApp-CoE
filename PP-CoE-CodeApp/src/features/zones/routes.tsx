import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const ZonesView = lazy(() =>
  import("./ZonesView").then((m) => ({ default: m.ZonesView })),
);
const ZonesReportingOverviewView = lazy(() =>
  import("./ZonesReportingOverviewView").then((m) => ({
    default: m.ZonesReportingOverviewView,
  })),
);
const ZoneDetailView = lazy(() =>
  import("./ZoneDetailView").then((m) => ({ default: m.ZoneDetailView })),
);
const ZoneReportingView = lazy(() =>
  import("./ZoneReportingView").then((m) => ({
    default: m.ZoneReportingView,
  })),
);
const StandardCustomGroupDetailView = lazy(() =>
  import("./StandardCustomGroupDetailView").then((m) => ({ default: m.StandardCustomGroupDetailView })),
);
const CustomGroupReportingView = lazy(() =>
  import("./CustomGroupReportingView").then((m) => ({
    default: m.CustomGroupReportingView,
  })),
);

/**
 * Returns the `<Route>` elements for the zones feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 *
 * Route order matters: the tenant-wide `/zones/reporting` overview must
 * be declared BEFORE the dynamic `/zones/:zoneId` route. React Router 7
 * does rank static segments above dynamic ones, but listing the static
 * one first is the unambiguous + future-proof pattern.
 */
export function zonesRoutes() {
  return [
    <Route key="zones-ZonesView--zones" path="/zones" element={<ZonesView />} />,
    <Route
      key="zones-ZonesReportingOverviewView--zones--reporting"
      path="/zones/reporting"
      element={<ZonesReportingOverviewView />}
    />,
    <Route key="zones-ZoneDetailView--zones--zoneId" path="/zones/:zoneId" element={<ZoneDetailView />} />,
    <Route
      key="zones-ZoneReportingView--zones--zoneId--reporting"
      path="/zones/:zoneId/reporting"
      element={<ZoneReportingView />}
    />,
    <Route key="zones-StandardCustomGroupDetailView--zones-custom-groups--groupId" path="/zones/custom-groups/:groupId" element={<StandardCustomGroupDetailView />} />,
    <Route
      key="zones-CustomGroupReportingView--zones-custom-groups--groupId--reporting"
      path="/zones/custom-groups/:groupId/reporting"
      element={<CustomGroupReportingView />}
    />,
  ];
}
