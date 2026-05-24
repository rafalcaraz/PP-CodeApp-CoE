/**
 * Environment-groups feature — public API.
 *
 * Only the routes are exported. Views, the feature-scoped data layer, and
 * any future internal components are intentionally NOT re-exported — other
 * features must not reach into them. ESLint boundary rules pin this barrel
 * as the single allowed entry point.
 */
export { environmentGroupsRoutes } from "./routes";
