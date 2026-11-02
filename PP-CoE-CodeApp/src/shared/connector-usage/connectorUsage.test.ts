import { describe, expect, it } from "vitest";
import {
  connectorIdVariants,
  connectorIdsMatch,
  extractConnectorOperationEvidence,
  readConnectorEvidenceSource,
} from "./index";

describe("connector declaration evidence", () => {
  it("normalizes ARM paths, prefix variants and case without accepting substrings", () => {
    expect(connectorIdVariants(" /providers/Microsoft.PowerApps/apis/SHARED_SQL ")).toEqual(["shared_sql", "sql"]);
    expect(connectorIdsMatch("shared_sql", "SQL")).toBe(true);
    expect(connectorIdsMatch("shared_sqlserver", "sql")).toBe(false);
    expect(connectorIdsMatch("shared_shared_sql", "sql")).toBe(false);
    expect(connectorIdsMatch("", "")).toBe(false);
  });

  it("keeps roles and disabled metadata while deduplicating case-insensitively", () => {
    const source = readConnectorEvidenceSource({
      powerPlatformConnectors: [
        { connectorId: "shared_sql", operations: [
          { operationId: " DeleteRow ", isEnabled: false },
          { operationId: "deleterow", isEnabled: false },
          { operationId: "DeleteRow", isEnabled: true },
          null, {}, { operationId: 1 },
        ] },
        { connectorId: "shared_sqlserver", operations: ["OtherAction"] },
      ],
      connectors: [{ id: "/providers/Microsoft.PowerApps/apis/sql", operations: ["GetRows"] }],
      trigger: "SQL",
      triggerOperation: "DeleteRow",
    }, true);
    expect(extractConnectorOperationEvidence(source, "shared_SQL")).toEqual([
      { operationId: "DeleteRow", role: "action", isEnabled: false },
      { operationId: "DeleteRow", role: "action", isEnabled: true },
      { operationId: "GetRows", role: "action", isEnabled: undefined },
      { operationId: "DeleteRow", role: "trigger" },
    ]);
  });

  it("does not infer operations from catalog capabilities, references or malformed entries", () => {
    const source = readConnectorEvidenceSource({
      operations: [{ operationId: "DeleteRow" }],
      powerPlatformConnectors: [null, 1, { connectorId: "shared_sql" }],
      connectors: [{ connectorId: "shared_other", operations: ["DeleteRow"] }],
      triggerOperation: "DeleteRow",
    }, true);
    expect(extractConnectorOperationEvidence(source, "sql")).toEqual([]);
    expect(extractConnectorOperationEvidence(source, "")).toEqual([]);
  });

  it("ignores trigger-looking properties when resource type does not support flow triggers", () => {
    const source = readConnectorEvidenceSource({ trigger: { connectorId: "sql", operationId: "OnRow" } });
    expect(extractConnectorOperationEvidence(source, "sql")).toEqual([]);
  });
});
