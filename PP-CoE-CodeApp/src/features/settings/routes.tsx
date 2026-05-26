import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
const SettingsView = lazy(() =>
  import("./SettingsView").then((m) => ({ default: m.SettingsView })),
);

/**
 * Returns the `<Route>` elements for the settings feature.
 *
 * Returned as an array (not a fragment) so the consumer can spread them
 * inside a `<Routes>` block. react-router 7 still walks fragment children
 * but spreading is unambiguous and survives lint/dead-code removal.
 */
export function settingsRoutes() {
  return [
    <Route key="settings-SettingsView--settings" path="/settings" element={<SettingsView />} />,
  ];
}
