import { createMoveTaskRunner } from "./moveTask";
import { executeLivePdeMoves } from "./pdeMoveData";

export const liveMoveTask = createMoveTaskRunner(executeLivePdeMoves);
