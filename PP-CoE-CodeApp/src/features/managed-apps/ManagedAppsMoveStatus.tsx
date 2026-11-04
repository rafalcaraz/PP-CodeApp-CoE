import { MoveTaskStatus } from "./MoveTaskStatus";
import { liveMoveTask } from "./liveMoveTask";
import { useLocation } from "react-router-dom";
import { useSyncExternalStore } from "react";

export function ManagedAppsMoveStatus() {
  const location = useLocation();
  const task = useSyncExternalStore(liveMoveTask.subscribe, liveMoveTask.getSnapshot);
  const attention = !!task?.error || task?.environments.some((entry) => entry.phase === "needs-attention" || entry.phase === "stopped");
  return <MoveTaskStatus runner={liveMoveTask} hideResult={location.pathname === "/managed-apps" && !!attention} />;
}
