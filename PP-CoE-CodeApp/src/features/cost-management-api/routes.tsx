import { lazy } from "react";
import { Route } from "react-router-dom";

const CostManagementApiPlayground = lazy(() =>
  import("./CostManagementApiPlayground").then((module) => ({ default: module.CostManagementApiPlayground })),
);

export function costManagementApiRoutes() {
  return [
    <Route key="cost-management-api" path="/cost-management-api" element={<CostManagementApiPlayground />} />,
  ];
}
