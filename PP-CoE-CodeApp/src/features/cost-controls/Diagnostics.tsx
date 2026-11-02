import { ResponseViewer } from "../../shared/api-explorer/ResponseViewer";

export function Diagnostics({ label, data }: { label: string; data: unknown }) {
  return <details><summary>{label}</summary>
    <ResponseViewer sources={[{ label: "SDK response", ariaLabel: label, text: JSON.stringify(data, null, 2) ?? "No response body exposed." }]} />
  </details>;
}
