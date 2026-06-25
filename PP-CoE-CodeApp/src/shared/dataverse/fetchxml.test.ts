import { describe, expect, it } from "vitest";

import { buildFetchXml } from "./fetchxml";

describe("buildFetchXml", () => {
  it("builds explicit attributes + a filter condition", () => {
    const xml = buildFetchXml({
      entity: "msdyn_solutioncomponentsummary",
      attributes: ["msdyn_displayname", "msdyn_name"],
      conditions: [
        { attribute: "msdyn_solutionid", operator: "eq", value: "guid-1" },
      ],
    });
    expect(xml).toContain('<entity name="msdyn_solutioncomponentsummary">');
    expect(xml).toContain('<attribute name="msdyn_displayname" />');
    expect(xml).toContain('<attribute name="msdyn_name" />');
    expect(xml).toContain('<filter type="and">');
    expect(xml).toContain(
      '<condition attribute="msdyn_solutionid" operator="eq" value="guid-1" />',
    );
  });

  it("emits <all-attributes/> when allAttributes is set", () => {
    const xml = buildFetchXml({ entity: "solution", allAttributes: true });
    expect(xml).toContain("<all-attributes />");
    expect(xml).not.toContain("<attribute ");
  });

  it("defaults the operator to eq", () => {
    const xml = buildFetchXml({
      entity: "solution",
      conditions: [{ attribute: "isvisible", value: true }],
    });
    expect(xml).toContain('operator="eq"');
  });

  it("XML-escapes attribute values", () => {
    const xml = buildFetchXml({
      entity: "solution",
      conditions: [{ attribute: "uniquename", value: 'a"&<b' }],
    });
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
  });

  it("adds a top cap and order when provided", () => {
    const xml = buildFetchXml({
      entity: "solution",
      allAttributes: true,
      top: 50,
      order: { attribute: "friendlyname", descending: true },
    });
    expect(xml).toContain('top="50"');
    expect(xml).toContain('<order attribute="friendlyname" descending="true" />');
  });
});
