/**
 * Unit tests for the CSV serialization helpers.
 *
 * Focus on the cell-escape contract (commas, quotes, newlines, leading
 * /trailing whitespace) and the column-union behavior across rows with
 * different shapes. Nested objects flatten with dot notation; arrays of
 * primitives semicolon-join; arrays of objects JSON-encode.
 */
import { describe, it, expect } from "vitest";
import { rowsToCsv } from "./csv";

describe("rowsToCsv — empty / trivial", () => {
  it("returns an empty string for an empty row list", () => {
    expect(rowsToCsv([])).toBe("");
  });

  it("emits just the header row when every flattened row is empty", () => {
    expect(rowsToCsv([{}])).toBe("");
  });

  it("emits a single header + value line for one primitive row", () => {
    expect(rowsToCsv([{ name: "Alice", age: 30 }])).toBe(
      "name,age\r\nAlice,30",
    );
  });
});

describe("rowsToCsv — escape rules", () => {
  it("quotes values containing commas", () => {
    expect(rowsToCsv([{ s: "a,b" }])).toBe('s\r\n"a,b"');
  });

  it("doubles embedded quotes inside a quoted cell", () => {
    expect(rowsToCsv([{ s: 'she said "hi"' }])).toBe(
      's\r\n"she said ""hi"""',
    );
  });

  it("quotes values containing carriage returns or newlines", () => {
    expect(rowsToCsv([{ s: "a\nb" }])).toBe('s\r\n"a\nb"');
    expect(rowsToCsv([{ s: "a\rb" }])).toBe('s\r\n"a\rb"');
  });

  it("quotes values with leading or trailing whitespace", () => {
    expect(rowsToCsv([{ s: " padded" }])).toBe('s\r\n" padded"');
    expect(rowsToCsv([{ s: "padded " }])).toBe('s\r\n"padded "');
  });

  it("emits empty cells for null / undefined / empty string", () => {
    expect(rowsToCsv([{ a: null, b: undefined, c: "" }])).toBe("a,b,c\r\n,,");
  });
});

describe("rowsToCsv — nested objects flatten with dot notation", () => {
  it("dotnames object properties", () => {
    expect(rowsToCsv([{ user: { name: "Alice", age: 30 } }])).toBe(
      "user.name,user.age\r\nAlice,30",
    );
  });

  it("collapses deeply nested objects up to maxDepth (5 by default)", () => {
    // 6 levels deep: the 6th nested object should be JSON-encoded.
    const row = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    const csv = rowsToCsv([row]);
    expect(csv).toMatch(/a\.b\.c\.d\.e/);
    // The leaf should be a JSON blob, not 'a.b.c.d.e.f,1'.
    expect(csv).toContain('"{""f"":1}"');
  });
});

describe("rowsToCsv — arrays", () => {
  it("semicolon-joins arrays of primitives", () => {
    expect(rowsToCsv([{ tags: ["one", "two", "three"] }])).toBe(
      "tags\r\none; two; three",
    );
  });

  it("emits just the header for a row that flattens to a single empty cell", () => {
    // `tags: []` flattens to `tags: ""`, the body row becomes the empty
    // string, and rowsToCsv returns header-only when the body is empty.
    expect(rowsToCsv([{ tags: [] }])).toBe("tags");
  });

  it("renders an empty array alongside other columns as an empty cell", () => {
    expect(rowsToCsv([{ name: "Alice", tags: [] }])).toBe(
      "name,tags\r\nAlice,",
    );
  });

  it("JSON-stringifies arrays of objects (single cell)", () => {
    const csv = rowsToCsv([{ items: [{ k: 1 }, { k: 2 }] }]);
    expect(csv).toBe('items\r\n"[{""k"":1},{""k"":2}]"');
  });
});

describe("rowsToCsv — column union across rows", () => {
  it("collects the union of keys, in first-seen order", () => {
    const csv = rowsToCsv([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
      { a: 5, c: 6 },
    ]);
    const [header, ...body] = csv.split("\r\n");
    expect(header).toBe("a,b,c");
    expect(body).toEqual(["1,2,", ",3,4", "5,,6"]);
  });
});
