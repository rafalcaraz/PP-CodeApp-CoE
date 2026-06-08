import { lazy } from "react";
import { useParams } from "react-router-dom";

const ZoneUsageView = lazy(() =>
  import("./ZoneUsageView").then((m) => ({ default: m.ZoneUsageView })),
);

export function ZoneUsageRoute() {
  const { zoneId = "" } = useParams<{ zoneId: string }>();
  return <ZoneUsageView key={zoneId} />;
}
