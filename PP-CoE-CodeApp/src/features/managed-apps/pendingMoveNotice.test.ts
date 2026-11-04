import { expect, it } from "vitest";
import { pendingMoveNotice, pendingMoveState } from "./pendingMoveNotice";
import type { MoveRecord } from "./pdeMoves";

const record: MoveRecord = {
  version: 1, id: "synthetic-pending", destinationId: "destination", previewHash: "hash", updatedAt: 123,
  pdes: [{ environmentId: "synthetic-pde", sourceId: "source", phase: "detached", remove: "accepted", add: "none", observedGroupId: "" }],
};

it("ignores timestamp-only checks and terminal history when identifying the same pending reminder", () => {
  const original = pendingMoveState([record]);
  const completed: MoveRecord = { ...record, id: "synthetic-completed", pdes: [{ ...record.pdes[0], phase: "verified" }] };
  expect(pendingMoveState([completed])).toBe("");
  expect(pendingMoveState([completed, { ...record, updatedAt: 456 }])).toBe(original);
  pendingMoveNotice.dismiss(original);
  expect(pendingMoveNotice.getSnapshot()).toBe(original);
  expect(record.pdes[0]).toMatchObject({ phase: "detached", remove: "accepted", add: "none" });
});

it("identifies new operations and real phase, request or observed-membership changes", () => {
  const original = pendingMoveState([record]);
  expect(pendingMoveState([{ ...record, id: "synthetic-new" }])).not.toBe(original);
  expect(pendingMoveState([{ ...record, pdes: [{ ...record.pdes[0], phase: "indeterminate", add: "uncertain" }] }])).not.toBe(original);
  expect(pendingMoveState([{ ...record, pdes: [{ ...record.pdes[0], observedGroupId: "other-group" }] }])).not.toBe(original);
});
