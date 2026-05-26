/**
 * Unit tests for the date formatting helpers used by detail pages.
 *
 * `formatRelative` has six bucket branches plus past/future framing —
 * easy to break without noticing. These tests pin each bucket boundary
 * by mocking `Date.now()` so the assertions are stable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDate, formatRelative } from "./formatting";

describe("formatDate", () => {
  it("returns the em-dash for empty input", () => {
    expect(formatDate("")).toBe("—");
  });

  it("returns the input string when not parseable as a date", () => {
    expect(formatDate("not a date")).toBe("not a date");
  });

  it("returns a locale-formatted string for a valid ISO date", () => {
    const out = formatDate("2026-01-15T12:34:56Z");
    // We don't pin the exact locale output (varies by Node version), but
    // it should at least contain the year.
    expect(out).toMatch(/2026/);
  });
});

describe("formatRelative", () => {
  // Pin "now" so the rolling buckets are deterministic.
  const NOW = new Date("2026-05-26T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(ms: number): string {
    return formatRelative(new Date(NOW - ms).toISOString());
  }

  it("returns empty string for empty / unparseable input", () => {
    expect(formatRelative("")).toBe("");
    expect(formatRelative("not a date")).toBe("");
  });

  it("renders sub-minute deltas as `just now`", () => {
    expect(at(30_000)).toBe("just now");
  });

  it("pluralizes minutes correctly", () => {
    expect(at(60_000)).toBe("1 minute ago");
    expect(at(5 * 60_000)).toBe("5 minutes ago");
  });

  it("pluralizes hours correctly", () => {
    expect(at(60 * 60_000)).toBe("1 hour ago");
    expect(at(3 * 60 * 60_000)).toBe("3 hours ago");
  });

  it("renders 1-day-old as `yesterday` (no `ago` suffix)", () => {
    expect(at(24 * 60 * 60_000)).toBe("yesterday");
  });

  it("renders multi-day deltas in days", () => {
    expect(at(5 * 24 * 60 * 60_000)).toBe("5 days ago");
  });

  it("renders multi-month deltas in months", () => {
    expect(at(90 * 24 * 60 * 60_000)).toBe("3 months ago");
  });

  it("renders >1-year deltas in years", () => {
    expect(at(2 * 365 * 24 * 60 * 60_000)).toBe("2 years ago");
  });

  it("prefixes future deltas with `in`", () => {
    const future = new Date(NOW + 3 * 60 * 60_000).toISOString();
    expect(formatRelative(future)).toBe("in 3 hours");
  });
});
