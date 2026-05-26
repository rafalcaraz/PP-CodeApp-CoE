import { Navigate } from "react-router-dom";
import { listDashboards } from "../data/dashboards";

/** Resolves Home to the user's first dashboard (Tenant overview is seeded
 *  on first run). If they've deleted everything, fall back to the
 *  Dashboards list so they can create one. */
export function HomeRedirect() {
  const items = listDashboards();
  if (items.length === 0) return <Navigate to="/dashboards" replace />;
  return <Navigate to={`/dashboards/${items[0].id}`} replace />;
}
