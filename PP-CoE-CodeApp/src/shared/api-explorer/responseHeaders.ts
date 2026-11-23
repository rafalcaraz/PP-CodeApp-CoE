import { isJsonObject } from "./schema";

export function exposedResponseHeaders(result: unknown): unknown {
  if (!isJsonObject(result)) return undefined;
  const response = isJsonObject(result.response) ? result.response : undefined;
  const error = isJsonObject(result.error) ? result.error : undefined;
  const errorResponse = isJsonObject(error?.response) ? error.response : undefined;
  const data = isJsonObject(result.data) ? result.data : undefined;
  const httpData = data && (typeof data.statusCode === "number" || typeof data.status === "number") ? data : undefined;
  return result.headers ?? response?.headers ?? errorResponse?.headers ?? error?.headers ?? httpData?.headers;
}
