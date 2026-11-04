import { useSyncExternalStore } from "react";
import { Text } from "@fluentui/react-components";
import type { ManagedAppsEstateSource } from "../data/dashboardManagedAppSource";

export function ManagedAppsEstateFreshness({ source }: { source: ManagedAppsEstateSource }) {
  const status = useSyncExternalStore(source.subscribe, source.getStatus, source.getStatus);
  return <Text size={200} role="status">
    {status.phase === "ready" ? `Snapshot ${new Date(status.capturedAt!).toLocaleString()} · Refresh to update`
      : status.phase === "loading" ? "Reading managed apps and ACP assignments…"
      : status.phase === "error" ? "Snapshot read failed · see tile errors; Refresh to retry"
      : "Managed Apps Estate · one shared snapshot"}
  </Text>;
}
