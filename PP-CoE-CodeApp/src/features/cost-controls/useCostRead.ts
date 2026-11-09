import { useCallback, useEffect, useRef, useState } from "react";
import { formatApiError } from "../../shared/api-explorer/schema";
import type { Result } from "./data";

export function useCostRead<T>() {
  const revision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<{ label: string; data: T; raw: unknown }>();
  const [attempt, setAttempt] = useState<{ label: string; result: Result<T> }>();
  useEffect(() => {
    const version = revision;
    return () => { version.current++; };
  }, []);
  const load = useCallback(async (label: string, read: () => Promise<Result<T>>) => {
    const version = ++revision.current;
    setBusy(true);
    setError("");
    let result: Result<T>;
    try { result = await read(); }
    catch (cause) { result = { ok: false, error: formatApiError(cause) }; }
    if (version !== revision.current) return;
    setAttempt({ label, result });
    if (result.ok) setResponse({ label, data: result.data, raw: result.raw });
    else setError(result.error);
    setBusy(false);
  }, []);
  return { busy, error, response, attempt, load };
}
