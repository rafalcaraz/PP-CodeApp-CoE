/**
 * Agents feature — public API.
 *
 * Only the routes are exported. Views (AgentsList / AgentDetail), the
 * feature-scoped data layer (./data), and any future internal components
 * are intentionally NOT re-exported — other features must not reach into
 * them. ESLint boundary rules pin this barrel as the single allowed entry
 * point.
 */
export { agentsRoutes } from "./routes";
