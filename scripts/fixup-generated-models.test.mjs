import assert from "node:assert/strict";
import { test } from "node:test";
import { fixOdataTypeAliases } from "./fixup-generated-models.mjs";

test("repairs generated OData alias declarations and references without changing wire names", () => {
  const source = `export type Quantity@odata_type = '#microsoft.graph.limitedCostManagementQuantity';
export interface Quantity {
  "@odata.type": Quantity@odata_type;
  "other@odata.type"?: string;
}`;
  const fixed = fixOdataTypeAliases(source);
  assert.match(fixed, /export type QuantityOdataType =/);
  assert.match(fixed, /"@odata.type": QuantityOdataType;/);
  assert.match(fixed, /"other@odata.type"\?: string/);
  assert.match(fixed, /'#microsoft.graph.limitedCostManagementQuantity'/);
  assert.equal(fixOdataTypeAliases(fixed), fixed);
});

test("leaves already-valid models unchanged and rejects alias collisions", () => {
  assert.equal(fixOdataTypeAliases('export type State = "enabled";'), 'export type State = "enabled";');
  assert.throws(() => fixOdataTypeAliases('export type Quantity@odata_type = "x";\nexport type QuantityOdataType = "y";'), /collision/);
});
