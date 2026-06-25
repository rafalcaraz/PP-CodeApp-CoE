/**
 * Flow contract + swappable runner indirection for the Dataverse passthrough.
 *
 * Why this layer exists
 * ---------------------
 * Every passthrough call is routed through a single, replaceable "runner" so
 * the data layer never imports the generated flow service directly. This keeps
 * the slice testable (tests inject a fake runner via `setDataverseRunner`) and
 * isolates the one place that knows the generated trigger parameter names.
 *
 * The live default is `realDataverseRunner`, which calls the generated
 * `ListRows_DataverseService.Run`. The flow's PowerApp V2 trigger inputs are
 * auto-named `text` / `text_1` (titled `environmentId` / `schemaNamePlural` in
 * the flow), and its single output is `result` — this runner maps our
 * ergonomic input to those names and normalizes `result` → `response` so the
 * client and mock can stay agnostic of the generated wire shape.
 */

import { ListRows_DataverseService } from "../../generated/services/ListRows_DataverseService";
import { mockDataverseRunner } from "./mock";

/** Ergonomic input the rest of the app uses to invoke the flow. */
export interface DataverseFlowInput {
  environmentId: string;
  pluralName: string;
  /**
   * FetchXML query, mapped to the flow's third trigger input (`text_2`,
   * titled `filterXMLQuery`). Required by the flow — always sent.
   */
  fetchXml: string;
}

/**
 * Raw envelope the client consumes. Modeled on the Power Apps SDK
 * `IOperationResult` shape that the generated service yields:
 *
 *   - `success`  — whether the flow run itself succeeded
 *   - `data.response` — the stringified JSON body the flow emitted (the
 *     generated output field is `result`; the real runner re-keys it to
 *     `response` so this contract is stable)
 *   - `error`    — loosely-typed failure payload when `success` is false
 *
 * The client (`./client`) parses `data.response` and normalizes every failure
 * mode into a `DataverseResult`.
 */
export interface DataverseFlowRawResult {
  success: boolean;
  data?: { response?: string };
  error?: unknown;
}

/** A runner turns an ergonomic input into the raw flow envelope. */
export type DataverseRunner = (
  input: DataverseFlowInput,
) => Promise<DataverseFlowRawResult>;

/**
 * Live runner backed by the generated `ListRows_DataverseService`.
 *
 * Trigger-input mapping (confirmed against the flow swagger):
 *   - `text`   ← environmentId
 *   - `text_1` ← pluralName (schemaNamePlural)
 *   - `text_2` ← fetchXml (filterXMLQuery) — required by the flow
 * Output mapping:
 *   - `data.result` → `data.response`
 *
 * The generated `ManualTriggerInput` already declares `text_2`; the input is
 * still built as a plain object and cast through `unknown` so a future
 * regeneration that tweaks the param shape won't break this call site.
 */
export const realDataverseRunner: DataverseRunner = async (input) => {
  const triggerInput = {
    text: input.environmentId,
    text_1: input.pluralName,
    text_2: input.fetchXml,
  };
  const raw = (await ListRows_DataverseService.Run(
    triggerInput as unknown as Parameters<typeof ListRows_DataverseService.Run>[0],
  )) as unknown as {
    success: boolean;
    data?: { result?: string };
    error?: unknown;
  };
  return {
    success: raw.success,
    data: { response: raw.data?.result },
    error: raw.error,
  };
};

// The active runner. Defaults to the live flow service. Tests swap in a fake
// via `setDataverseRunner`; `mockDataverseRunner` is exported for that purpose
// and for local development without a connection.
let activeRunner: DataverseRunner = realDataverseRunner;

/** Invoke the flow via the currently active runner. */
export function runDataverseFlow(
  input: DataverseFlowInput,
): Promise<DataverseFlowRawResult> {
  return activeRunner(input);
}

/** Replace the active runner (used by tests and for the mock/dev runner). */
export function setDataverseRunner(runner: DataverseRunner): void {
  activeRunner = runner;
}

/** Restore the default (live) runner. */
export function resetDataverseRunner(): void {
  activeRunner = realDataverseRunner;
}

/** The in-memory mock runner, re-exported for convenience. */
export { mockDataverseRunner };

