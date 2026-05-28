import { lazy } from "react";
import { Route } from "react-router-dom";

// Feature routes are lazy-loaded at the feature boundary so a new feature
// adds at most one lazy() call instead of touching the App.tsx central
// registry of every route in the app.
//
// Note: DlpComparator, DlpImpact, and DlpDuplicator are not routed
// independently — they are tab children rendered inside Comparator /
// Impact / Duplicator, which lazy-load them on demand. Keeping the
// routing surface flat keeps SideNav simple.
const Comparator = lazy(() =>
  import("./Comparator").then((m) => ({ default: m.Comparator })),
);
const Impact = lazy(() =>
  import("./Impact").then((m) => ({ default: m.Impact })),
);
const Duplicator = lazy(() =>
  import("./Duplicator").then((m) => ({ default: m.Duplicator })),
);
const Ownerless = lazy(() =>
  import("./Ownerless").then((m) => ({ default: m.Ownerless })),
);

/**
 * Returns the `<Route>` elements for the security feature.
 */
export function securityRoutes() {
  return [
    <Route key="security-comparator-dlp" path="/security/dlp-comparator" element={<Comparator />} />,
    <Route key="security-comparator" path="/security/comparator" element={<Comparator />} />,
    <Route key="security-impact-dlp" path="/security/dlp-impact" element={<Impact />} />,
    <Route key="security-impact" path="/security/impact" element={<Impact />} />,
    <Route key="security-duplicator-dlp" path="/security/dlp-duplicator" element={<Duplicator />} />,
    <Route key="security-duplicator-envgroup" path="/security/env-group-duplicator" element={<Duplicator />} />,
    <Route key="security-duplicator" path="/security/duplicator" element={<Duplicator />} />,
    <Route key="security-ownerless" path="/security/ownerless" element={<Ownerless />} />,
  ];
}
