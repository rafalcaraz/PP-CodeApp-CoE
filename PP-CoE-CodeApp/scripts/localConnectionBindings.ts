import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const privateFile = "power.bindings.local";
const configRoute = "/__vite_powerapps_plugin__/power.config.json";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resolveLocalBindings(config: unknown, bindings: unknown): Record<string, unknown> {
  if (!object(config) || !object(config.connectionReferences) || typeof config.environmentId !== "string"
    || !object(bindings) || bindings.environmentId !== config.environmentId || !object(bindings.sharedConnections)
    || Object.keys(bindings).some((key) => !["environmentId", "sharedConnections"].includes(key))) {
    throw new Error("Invalid private local bindings or environment mismatch. No connection metadata was changed.");
  }
  const resolved = structuredClone(config);
  const references = structuredClone(config.connectionReferences);
  resolved.connectionReferences = references;
  for (const [logicalName, connection] of Object.entries(bindings.sharedConnections)) {
    const matches = Object.values(references).filter((ref) => object(ref) && ref.xrmConnectionReferenceLogicalName === logicalName);
    const ref = matches[0];
    if (matches.length !== 1 || !object(ref) || typeof ref.id !== "string" || typeof ref.sharedConnectionId !== "string") {
      throw new Error("Private bindings must match one existing shared connection reference; adding capabilities or pinning an unshared connector is not supported.");
    }
    if (typeof connection !== "string") throw new Error("Private bindings require full connection resource paths.");
    const prefix = `${ref.id}/connections/`;
    const id = connection.slice(prefix.length);
    if (!connection.toLowerCase().startsWith(prefix.toLowerCase()) || !/^[a-zA-Z0-9-]+$/.test(id)) {
      throw new Error("Private binding connector/path does not match its existing reference.");
    }
    ref.sharedConnectionId = connection;
  }
  return resolved;
}

export function localConnectionBindings(): Plugin {
  return {
    name: "private-local-connection-bindings",
    apply: "serve",
    configureServer(server) {
      const bindingsPath = join(server.config.root, privateFile);
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0];
        if (pathname === `/${privateFile}`) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (pathname !== configRoute || !existsSync(bindingsPath)) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          next();
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        try {
          const config: unknown = JSON.parse(readFileSync(join(server.config.root, "power.config.json"), "utf8"));
          const bindings: unknown = JSON.parse(readFileSync(bindingsPath, "utf8"));
          res.end(JSON.stringify(resolveLocalBindings(config, bindings)));
        } catch {
          server.config.logger.error("[powerApps] Private local bindings are invalid or cannot be read; check their environment, logical references and connection paths.");
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "Private local bindings are invalid or unreadable. Connection admission is blocked; no fallback bindings were served." }));
        }
      });
    },
  };
}
