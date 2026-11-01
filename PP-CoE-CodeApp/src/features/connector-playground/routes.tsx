import { lazy } from "react";
import { Route } from "react-router-dom";

const ConnectorPlayground = lazy(() =>
  import("./ConnectorPlayground").then((module) => ({ default: module.ConnectorPlayground })),
);

export function connectorPlaygroundRoutes() {
  return [
    <Route key="connector-playground" path="/connector-playground" element={<ConnectorPlayground />} />,
  ];
}
