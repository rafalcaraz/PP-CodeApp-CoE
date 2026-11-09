import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useCostRead } from "./useCostRead";
import type { Result } from "./data";

it("retains the original source/period after refresh errors and ignores superseded responses", async () => {
  const { result } = renderHook(() => useCostRead<number>());
  let finish!: (value: Result<number>) => void;
  let old!: Promise<void>;
  act(() => { old = result.current.load("old period", () => new Promise((resolve) => { finish = resolve; })); });
  await act(() => result.current.load("new period", async () => ({ ok: true, data: 2, raw: {} })));
  await act(async () => { finish({ ok: true, data: 1, raw: {} }); await old; });
  expect(result.current.response).toMatchObject({ label: "new period", data: 2 });
  await act(() => result.current.load("failed period", async () => ({ ok: false, error: "503 source unavailable" })));
  expect(result.current.response).toMatchObject({ label: "new period", data: 2 });
  expect(result.current.error).toBe("503 source unavailable");
  expect(result.current.attempt?.label).toBe("failed period");
});
