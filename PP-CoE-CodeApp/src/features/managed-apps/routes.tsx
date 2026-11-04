import { lazy } from "react";
import { Route } from "react-router-dom";

const ManagedAppsView = lazy(() =>
  import("./ManagedAppsView").then((module) => ({ default: module.ManagedAppsView })),
);

export function managedAppsRoutes() {
  return [<Route key="managed-apps" path="/managed-apps" element={<ManagedAppsView />} />];
}
