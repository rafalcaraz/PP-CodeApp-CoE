/**
 * Tiny FetchXML builder for the Dataverse passthrough.
 *
 * The flow's third input (`filterXMLQuery`) is a **FetchXML** string that
 * specifies the entity, the columns to return, and any filter conditions. This
 * helper builds well-formed, XML-escaped FetchXML from a small spec so callers
 * (the feature data layers) don't hand-concatenate strings.
 *
 * FetchXML notes:
 *  - The `entity` name is the **logical (singular)** name (e.g. `solution`),
 *    not the plural entity-set name.
 *  - With neither explicit `<attribute>`s nor `<all-attributes/>`, Dataverse
 *    returns only the primary id + primary name, so specify one or the other.
 */

/** A single FetchXML filter condition. */
export interface FetchCondition {
  attribute: string;
  /** OData/FetchXML operator, e.g. `eq`, `ne`, `like`. Defaults to `eq`. */
  operator?: string;
  /** Comparison value. Omitted for value-less operators (e.g. `null`). */
  value?: string | number | boolean;
}

/** Spec describing the FetchXML query to build. */
export interface FetchXmlSpec {
  /** Logical (singular) entity name, e.g. `solution`. */
  entity: string;
  /** Explicit column logical names. Ignored when `allAttributes` is true. */
  attributes?: string[];
  /** Emit `<all-attributes/>` instead of explicit columns. */
  allAttributes?: boolean;
  /** Filter conditions (AND-combined). */
  conditions?: FetchCondition[];
  /** Optional row cap (`top` attribute on `<fetch>`). */
  top?: number;
  /** Optional ordering. */
  order?: { attribute: string; descending?: boolean };
}

/** Escape a string for use inside an XML attribute value. */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Build a FetchXML string from a spec. */
export function buildFetchXml(spec: FetchXmlSpec): string {
  const fetchAttrs = [
    'version="1.0"',
    'output-format="xml-platform"',
    'mapping="logical"',
    'distinct="false"',
  ];
  if (typeof spec.top === "number") {
    fetchAttrs.push(`top="${spec.top}"`);
  }

  const lines: string[] = [`<fetch ${fetchAttrs.join(" ")}>`];
  lines.push(`  <entity name="${escapeXmlAttr(spec.entity)}">`);

  if (spec.allAttributes) {
    lines.push("    <all-attributes />");
  } else if (spec.attributes && spec.attributes.length > 0) {
    for (const attr of spec.attributes) {
      lines.push(`    <attribute name="${escapeXmlAttr(attr)}" />`);
    }
  }

  if (spec.order) {
    lines.push(
      `    <order attribute="${escapeXmlAttr(spec.order.attribute)}" descending="${
        spec.order.descending ? "true" : "false"
      }" />`,
    );
  }

  if (spec.conditions && spec.conditions.length > 0) {
    lines.push('    <filter type="and">');
    for (const c of spec.conditions) {
      const op = c.operator ?? "eq";
      if (c.value === undefined) {
        lines.push(
          `      <condition attribute="${escapeXmlAttr(c.attribute)}" operator="${escapeXmlAttr(op)}" />`,
        );
      } else {
        lines.push(
          `      <condition attribute="${escapeXmlAttr(c.attribute)}" operator="${escapeXmlAttr(
            op,
          )}" value="${escapeXmlAttr(String(c.value))}" />`,
        );
      }
    }
    lines.push("    </filter>");
  }

  lines.push("  </entity>");
  lines.push("</fetch>");
  return lines.join("\n");
}
