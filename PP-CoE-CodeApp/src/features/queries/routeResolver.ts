import { ResourceType } from "../../data/inventory";

interface QueryResultRouteInput {
  id: string;
  type: string;
  environmentId?: string;
}

const APP_TYPES = new Set<string>([
  ResourceType.CanvasApp,
  ResourceType.ModelDrivenApp,
  ResourceType.CodeApp,
  ResourceType.AppBuilderApp,
]);

const FLOW_TYPES = new Set<string>([
  ResourceType.CloudFlow,
  ResourceType.AgentFlow,
  ResourceType.WorkflowAgentFlow,
]);

function buildDetailPath(input: QueryResultRouteInput): string | null {
  const id = input.id.trim();
  if (!id) return null;
  const encodedId = encodeURIComponent(id);
  if (input.type === ResourceType.CopilotStudioAgent) {
    return `/agents/${encodedId}`;
  }
  if (APP_TYPES.has(input.type)) {
    return `/apps/${encodedId}`;
  }
  if (FLOW_TYPES.has(input.type)) {
    return `/flows/${encodedId}`;
  }
  if (input.type === ResourceType.Environment) {
    return `/environments/${encodedId}`;
  }
  if (input.type === ResourceType.EnvironmentGroup) {
    return `/environment-groups/${encodedId}`;
  }
  return null;
}

function shouldAppendEnvId(type: string): boolean {
  return type === ResourceType.CopilotStudioAgent || APP_TYPES.has(type) || FLOW_TYPES.has(type);
}

export function getQueryResultHref(input: QueryResultRouteInput): string | null {
  const path = buildDetailPath(input);
  if (!path) return null;
  const envId = input.environmentId?.trim();
  if (!envId || !shouldAppendEnvId(input.type)) return path;
  const params = new URLSearchParams({ envId });
  return `${path}?${params.toString()}`;
}

