import { describe, expect, it } from "vitest";
import { findResponseMatches } from "./responseSearch";

describe("response text matching", () => {
  it("matches case-insensitively with exact source offsets", () => {
    expect(findResponseMatches("Name name NAME", "name")).toEqual([
      { start: 0, end: 4 }, { start: 5, end: 9 }, { start: 10, end: 14 },
    ]);
  });
  it("treats regex characters literally and preserves Unicode offsets", () => {
    expect(findResponseMatches("😀 [a.*] [A.*]", "[a.*]")).toEqual([{ start: 3, end: 8 }, { start: 9, end: 14 }]);
    expect(findResponseMatches("\\path $ (x)", "\\path")).toEqual([{ start: 0, end: 5 }]);
  });
  it("returns no highlights for an empty or unmatched query", () => {
    expect(findResponseMatches("data", "")).toEqual([]);
    expect(findResponseMatches("data", "absent")).toEqual([]);
  });
  it("finds non-overlapping matches, including line breaks and whitespace", () => {
    expect(findResponseMatches("aaaa", "aa")).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(findResponseMatches("a\nb", "\n")).toEqual([{ start: 1, end: 2 }]);
  });
});
