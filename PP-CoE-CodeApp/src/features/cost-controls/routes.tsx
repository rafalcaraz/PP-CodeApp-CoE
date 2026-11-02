import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";

const CostControls = lazy(() => import("./CostControls").then((module) => ({ default: module.CostControls })));

export function costControlsRoutes() {
  return [
    <Route key="cost-controls" path="/cost-controls" element={<Navigate to="/cost-controls/reporting" replace />} />,
    <Route key="cost-reporting" path="/cost-controls/reporting" element={<CostControls />} />,
    <Route key="cost-management" path="/cost-controls/management" element={<CostControls />} />,
  ];
}
