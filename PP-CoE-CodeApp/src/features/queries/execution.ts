import { runRawQuery } from "../../data/inventory";
import type { Clause } from "../../generated/models/PowerPlatformforAdminsV2Model";
import { isProjected, resourceIdentity } from "./workspace";

export interface Execution {
  key: string;
  clauses: Clause[];
  pageSize: number;
  rows: unknown[];
  offset: number;
  token?: string;
  seenTokens: string[];
  total: number;
  complete: boolean;
  warning?: string;
  startedAt: string;
  defaultColumns?: string[];
}
export function appendPage(execution: Execution, page: { items: unknown[]; skipToken?: string; totalRecords: number }): Execution {
  const identityFor = (row: unknown) => isProjected(execution.clauses) ? null : resourceIdentity(row);
  const keys = new Set(execution.rows.flatMap((r) => {
    const id = identityFor(r);
    return id ? [JSON.stringify(id)] : [];
  }));
  const fresh = page.items.filter((r) => {
    const id = identityFor(r);
    if (!id) return true;
    const key = JSON.stringify(id);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  const repeated = !!page.skipToken && execution.seenTokens.includes(page.skipToken);
  const noProgress = page.items.length === 0 || (page.items.length > 0 && fresh.length === 0);
  const warning = repeated ? "The connector repeated a continuation token. Paging stopped; results may be incomplete." :
    noProgress && page.skipToken ? "The connector returned no new rows with a continuation token. Paging stopped; results may be incomplete." : undefined;
  return {
    ...execution, rows: [...execution.rows, ...fresh], offset: execution.offset + page.items.length,
    total: page.totalRecords, token: warning ? undefined : page.skipToken || undefined,
    seenTokens: page.skipToken ? [...execution.seenTokens, page.skipToken] : execution.seenTokens,
    complete: !page.skipToken && !warning, warning,
  };
}
export function createExecution(key: string, clauses: Clause[], pageSize: number): Execution {
  return { key, clauses: structuredClone(clauses), pageSize, rows: [], offset: 0, seenTokens: [], total: 0, complete: false, startedAt: new Date().toISOString() };
}
export async function nextPage(execution: Execution): Promise<{ ok: true; execution: Execution } | { ok: false; error: string }> {
  const result = await runRawQuery(execution.clauses, {
    Top: execution.pageSize, Skip: execution.offset, SkipToken: execution.token ?? "",
  }, { forceFresh: true });
  return result.ok ? { ok: true, execution: appendPage(execution, result.data) } : result;
}
export async function drainExecution(
  initial: Execution,
  onProgress: (execution: Execution) => void,
  cancelled: () => boolean,
  cap = 200,
): Promise<{ execution: Execution; error?: string; cancelled?: boolean }> {
  let current = initial;
  for (let page = 0; current.token && page < cap; page++) {
    if (cancelled()) return { execution: current, cancelled: true };
    const next = await nextPage(current);
    if (cancelled()) return { execution: current, cancelled: true };
    if (!next.ok) return { execution: current, error: `Export stopped: ${next.error}` };
    current = next.execution;
    onProgress(current);
    if (current.warning) return { execution: current, error: current.warning };
  }
  return { execution: current, error: current.token ? `Export stopped at the ${cap}-page safety limit. Results are incomplete.` : current.warning };
}

// Results live only in this tab's JavaScript memory, never durable browser storage.
let investigation: Execution | undefined;
export function rememberExecution(value: Execution | undefined): void { investigation = value; }
export function recallExecution(): Execution | undefined { return investigation; }
