import { lazy } from "react";

export const GroupGovernanceInspector = lazy(() =>
  import("./GroupGovernanceInspector").then((module) => ({ default: module.GroupGovernanceInspector })),
);
