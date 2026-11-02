/** Inventory declarations, not runtime execution telemetry. Catalog capabilities
 * and reference-only connectors never imply an action was reported. */
export interface ConnectorOperationEvidence {
  operationId: string;
  role: "action" | "trigger";
  isEnabled?: boolean;
}

export interface ConnectorEvidenceSource {
  connectors: readonly {
    connectorId: string;
    operations: readonly { operationId: string; isEnabled?: boolean }[];
  }[];
  trigger?: { connectorId: string; operationId: string } | null;
}

export function connectorIdVariants(connectorId: string): string[] {
  const slug = connectorId.trim().split("/").pop()?.toLowerCase() ?? "";
  if (!slug) return [];
  const alternate = slug.startsWith("shared_") ? slug.slice(7) : `shared_${slug}`;
  return alternate ? [slug, alternate] : [slug];
}

export function connectorIdsMatch(left: string, right: string): boolean {
  const canonical = (id: string) => {
    const slug = connectorIdVariants(id)[0] ?? "";
    return slug.startsWith("shared_") ? slug.slice(7) : slug;
  };
  const normalized = canonical(left);
  return Boolean(normalized) && normalized === canonical(right);
}

export function extractConnectorOperationEvidence(
  source: ConnectorEvidenceSource,
  connectorId: string,
): ConnectorOperationEvidence[] {
  const evidence: ConnectorOperationEvidence[] = [];
  for (const connector of source.connectors) {
    if (!connectorIdsMatch(connector.connectorId, connectorId)) continue;
    for (const operation of connector.operations) {
      if (!operation.operationId.trim()) continue;
      evidence.push({
        operationId: operation.operationId.trim(),
        role: "action",
        isEnabled: operation.isEnabled,
      });
    }
  }
  if (source.trigger && connectorIdsMatch(source.trigger.connectorId, connectorId) &&
      source.trigger.operationId.trim()) {
    evidence.push({ operationId: source.trigger.operationId.trim(), role: "trigger" });
  }
  const seen = new Set<string>();
  return evidence.filter((operation) => {
    const key = `${operation.role}|${operation.operationId.toLowerCase()}|${operation.isEnabled}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Read both connector arrays and both flow-trigger schema generations.
 * The caller determines whether this resource type supports flow triggers. */
export function readConnectorEvidenceSource(
  properties: Record<string, unknown>,
  includeTrigger = false,
): ConnectorEvidenceSource {
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (value: unknown): string => typeof value === "string" ? value : "";
  const connectors: ConnectorEvidenceSource["connectors"][number][] = [];
  for (const raw of [properties.powerPlatformConnectors, properties.connectors]) {
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      const connector = object(entry);
      const operations = Array.isArray(connector.operations) ? connector.operations : [];
      connectors.push({
        connectorId: text(connector.connectorId) || text(connector.id),
        operations: operations.map((operation) => {
          const value = object(operation);
          return {
            operationId: typeof operation === "string" ? operation : text(value.operationId),
            isEnabled: typeof value.isEnabled === "boolean" ? value.isEnabled : undefined,
          };
        }),
      });
    }
  }
  const trigger = object(properties.trigger);
  return {
    connectors,
    trigger: includeTrigger ? {
      connectorId: text(trigger.connectorId) || text(properties.trigger),
      operationId: text(trigger.operationId) || text(properties.triggerOperation),
    } : undefined,
  };
}
