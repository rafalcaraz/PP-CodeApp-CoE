/**
 * Per-feature routing smoke tests.
 *
 * For each feature, we verify:
 *  1. The public-API barrel (`features/<name>/index.ts`) exports a
 *     `<name>Routes()` function.
 *  2. Calling it returns an array of <Route> elements with the expected
 *     paths.
 *
 * These are tripwires, not behavioral tests — they catch the most common
 * regression we'd see after refactors: someone renames a route, removes
 * an export, or breaks the lazy-import chain. They run in milliseconds
 * because they don't render the lazy-loaded view components.
 *
 * Adding a new feature?  Add it to the list below.
 */
import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import type { ReactElement } from "react";

import { agentsRoutes } from "../features/agents";
import { appsRoutes } from "../features/apps";
import { flowsRoutes } from "../features/flows";
import { environmentsRoutes } from "../features/environments";
import { environmentGroupsRoutes } from "../features/environment-groups";
import { dashboardsRoutes } from "../features/dashboards";
import { zonesRoutes } from "../features/zones";
import { securityRoutes } from "../features/security";
import { queriesRoutes } from "../features/queries";
import { connectorsRoutes } from "../features/connectors";
import { deepInventoryRoutes } from "../features/deep-inventory";
import { settingsRoutes } from "../features/settings";

type RouteProps = { path: string; element: ReactElement };

function pathsOf(routes: ReactElement[]): string[] {
  return routes.map((r) => {
    expect(isValidElement(r)).toBe(true);
    return (r.props as RouteProps).path;
  });
}

const FEATURES: Array<{
  name: string;
  routes: () => ReactElement[];
  expectedPaths: string[];
}> = [
  {
    name: "agents",
    routes: agentsRoutes,
    expectedPaths: ["/agents", "/agents/:agentId"],
  },
  {
    name: "apps",
    routes: appsRoutes,
    expectedPaths: ["/apps", "/apps/:appId"],
  },
  {
    name: "flows",
    routes: flowsRoutes,
    expectedPaths: ["/flows", "/flows/:flowId"],
  },
  {
    name: "environments",
    routes: environmentsRoutes,
    expectedPaths: ["/environments", "/environments/:envId", "/pde-landscape"],
  },
  {
    name: "environment-groups",
    routes: environmentGroupsRoutes,
    expectedPaths: ["/environment-groups", "/environment-groups/:groupId"],
  },
  {
    name: "dashboards",
    routes: dashboardsRoutes,
    expectedPaths: ["/dashboards", "/dashboards/:dashboardId"],
  },
  {
    name: "zones",
    routes: zonesRoutes,
    expectedPaths: [
      "/zones",
      "/zones/reporting",
      "/zones/usage",
      "/zones/:zoneId",
      "/zones/:zoneId/usage",
      "/zones/:zoneId/reporting",
      "/zones/custom-groups/:groupId",
      "/zones/custom-groups/:groupId/reporting",
    ],
  },
  {
    name: "security",
    routes: securityRoutes,
    expectedPaths: [
      "/security/dlp-comparator",
      "/security/comparator",
      "/security/dlp-impact",
      "/security/impact",
      "/security/dlp-duplicator",
      "/security/env-group-duplicator",
      "/security/duplicator",
      "/security/ownerless",
    ],
  },
  {
    name: "queries",
    routes: queriesRoutes,
    expectedPaths: ["/queries"],
  },
  {
    name: "connectors",
    routes: connectorsRoutes,
    expectedPaths: ["/connectors"],
  },
  {
    name: "deep-inventory",
    routes: deepInventoryRoutes,
    expectedPaths: ["/tenant-scans"],
  },
  {
    name: "settings",
    routes: settingsRoutes,
    expectedPaths: ["/settings"],
  },
];

describe("feature routes", () => {
  for (const { name, routes, expectedPaths } of FEATURES) {
    describe(name, () => {
      it("public barrel exports a routes() function", () => {
        expect(typeof routes).toBe("function");
      });

      it("returns the expected route paths", () => {
        const result = routes();
        expect(Array.isArray(result)).toBe(true);
        expect(pathsOf(result)).toEqual(expectedPaths);
      });

      it("every returned route has a React element in its `element` prop", () => {
        const result = routes();
        for (const r of result) {
          const props = r.props as RouteProps;
          // Lazy components are still ReactElements.
          expect(isValidElement(props.element)).toBe(true);
        }
      });
    });
  }
});



