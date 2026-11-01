import { lazy } from "react";
import { Route } from "react-router-dom";

const PowerPlatformApiPlayground = lazy(() =>
  import("./PowerPlatformApiPlayground").then((module) => ({ default: module.PowerPlatformApiPlayground })),
);

export function powerPlatformApiRoutes() {
  return [
    <Route key="power-platform-api" path="/power-platform-api" element={<PowerPlatformApiPlayground />} />,
  ];
}
