const sourceRecord = Symbol("sourceRecord");

/** Retain the returned envelope in memory without adding fields to JSON/CSV exports. */
export function retainSourceRecord<T extends object>(row: T, source: unknown): T {
  Object.defineProperty(row, sourceRecord, { value: source });
  return row;
}

export function hasSourceRecord(row: unknown): boolean {
  return row !== null && typeof row === "object" && Object.hasOwn(row, sourceRecord);
}

export function readPropertyPath(record: unknown, path: string): unknown {
  if (!path.trim() || path.split(".").some((part) => !part)) return undefined;
  if (record !== null && typeof record === "object" && Object.hasOwn(record, path)) {
    return Reflect.get(record, path);
  }
  let value: unknown = record;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = Reflect.get(value, part);
  }
  return value;
}

export function readRowProperty(row: unknown, path: string): unknown {
  const source: unknown = hasSourceRecord(row) && row !== null && typeof row === "object"
    ? Reflect.get(row, sourceRecord) : row;
  return readPropertyPath(source, path);
}
