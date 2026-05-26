import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const DeepScanView = lazy(() =>
  import("./DeepScanView").then((m) => ({ default: m.DeepScanView })),
);

/**
 * Returns the `<Route>` elements for the deep-inventory feature.
 *
 * v1 ships a single page at `/tenant-scans` — a forward-looking name
 * that reads cleanly when sources beyond `admin-apps` are added. A
 * future scan-list / saved-query revival page would slot in here too.
 */
export function deepInventoryRoutes() {
  return [
    <Route
      key="deep-inventory-DeepScanView--tenant-scans"
      path="/tenant-scans"
      element={<DeepScanView />}
    />,
  ];
}
