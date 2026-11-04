import type { MovePreview } from "./governance";
import type { MoveOutcome, MoveProgress, MoveProgressPhase } from "./pdeMoves";

export type MoveTaskPhase = MoveProgressPhase;
export type MoveTaskProgress = MoveProgress;
export interface MoveTask {
  id: number;
  running: boolean;
  detailOpen: boolean;
  destinationName: string;
  destinationId: string;
  environments: Array<MoveTaskProgress & { name: string }>;
  outcome?: MoveOutcome;
  error?: string;
}
export type MoveTaskExecutor = (
  preview: MovePreview, confirmed: boolean, recoveryIds: string[],
  onProgress: (progress: MoveTaskProgress) => void,
) => Promise<MoveOutcome>;

/** In-memory execution ownership is independent of every UI subscriber. */
export function createMoveTaskRunner(execute: MoveTaskExecutor) {
  let task: MoveTask | null = null;
  let sequence = 0;
  const listeners = new Set<() => void>();
  const publish = (next: MoveTask | null) => {
    task = next;
    for (const listener of listeners) listener();
  };
  const key = (id: string) => id.trim().toLowerCase();
  return {
    getSnapshot: () => task,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    showDetails: () => { if (task) publish({ ...task, detailOpen: true }); },
    hideDetails: () => { if (task) publish({ ...task, detailOpen: false }); },
    dismiss: () => { if (task && !task.running) publish(null); },
    start: async (preview: MovePreview, confirmed: boolean, recoveryIds: string[] = []) => {
      if (task?.running) throw new Error("A move is already running. View its progress before starting another batch.");
      if (!confirmed) throw new Error("Confirm the reviewed whole-environment move before starting.");
      const id = ++sequence;
      publish({
        id, running: true, detailOpen: false,
        destinationName: preview.destination.displayName || preview.destination.id,
        destinationId: preview.destination.id,
        environments: preview.pdes.map((pde) => ({
          environmentId: pde.environmentId, name: pde.environment?.displayName || pde.environmentId, phase: "queued",
        })),
      });
      try {
        const outcome = await execute(preview, confirmed, recoveryIds, (progress) => {
          if (!task || task.id !== id || !task.running) return;
          publish({ ...task, environments: task.environments.map((entry) =>
            key(entry.environmentId) === key(progress.environmentId) ? { ...entry, phase: progress.phase } : entry) });
        });
        if (task?.id === id) publish({
          ...task, running: false, outcome,
          environments: task.environments.map((entry) => {
            const result = outcome.record.pdes.find((pde) => key(pde.environmentId) === key(entry.environmentId));
            const phase = result?.phase === "verified" ? "moved" : result?.phase === "already-member" ? "already-member"
              : result?.phase === "stopped" ? "stopped" : "needs-attention";
            return { ...entry, phase };
          }),
        });
        return outcome;
      } catch (error) {
        if (task?.id === id) publish({
          ...task, running: false, error: String(error),
          environments: task.environments.map((entry) => ({
            ...entry, phase: entry.phase === "moved" || entry.phase === "already-member" ? entry.phase : "needs-attention",
          })),
        });
        throw error;
      }
    },
  };
}

export function moveTaskPhaseLabel(phase: MoveTaskPhase): string {
  switch (phase) {
    case "queued": return "Queued";
    case "preparing": return "Checking fresh impact";
    case "removing": return "Removing from source";
    case "adding": return "Adding to destination";
    case "verifying": return "Checking membership";
    case "moved": return "Moved";
    case "already-member": return "Already in destination";
    case "needs-attention": return "Needs attention";
    case "stopped": return "Not started";
  }
}
