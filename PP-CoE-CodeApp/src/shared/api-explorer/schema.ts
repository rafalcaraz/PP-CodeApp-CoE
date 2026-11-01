export interface JsonSchema {
  $ref?: string;
  type?: string;
  description?: string;
  example?: unknown;
  format?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: boolean | number;
  exclusiveMaximum?: boolean | number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchema;
  readOnly?: boolean;
  nullable?: boolean;
  "x-nullable"?: boolean;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatApiError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error || "Unknown error.";
  if (error === undefined || error === null) return "No error details were returned.";
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createSchemaTools(definitions: Record<string, JsonSchema>) {
  function resolveSchema(input: JsonSchema): JsonSchema {
    let schema = input;
    const visited = new Set<string>();
    while (schema.$ref) {
      const reference = schema.$ref;
      if (!reference.startsWith("#/definitions/") || visited.has(reference)) {
        throw new Error(`Unsupported or circular schema reference: ${reference}`);
      }
      visited.add(reference);
      const name = reference.slice("#/definitions/".length).replace(/~1/g, "/").replace(/~0/g, "~");
      if (!Object.hasOwn(definitions, name)) throw new Error(`Schema definition not found: ${reference}`);
      const siblings = { ...schema };
      delete siblings.$ref;
      schema = { ...definitions[name], ...siblings };
    }
    return schema;
  }

  function schemaDocument(input: JsonSchema): JsonSchema & { definitions: Record<string, JsonSchema> } {
    const referenced: Record<string, JsonSchema> = {};
    function collect(schema: JsonSchema) {
      if (schema.$ref) {
        const name = schema.$ref.slice("#/definitions/".length).replace(/~1/g, "/").replace(/~0/g, "~");
        if (Object.hasOwn(referenced, name)) return;
        referenced[name] = resolveSchema(schema);
        collect(referenced[name]);
      }
      for (const property of Object.values(schema.properties ?? {})) collect(property);
      for (const part of [...schema.allOf ?? [], ...schema.oneOf ?? [], ...schema.anyOf ?? []]) collect(part);
      if (schema.items) collect(schema.items);
      if (typeof schema.additionalProperties === "object") collect(schema.additionalProperties);
    }
    collect(input);
    return { ...resolveSchema(input), definitions: referenced };
  }

  function schemaTemplate(input: JsonSchema, includeOptional = false, depth = 0): unknown {
    const schema = resolveSchema(input);
    if (schema.default !== undefined) return schema.default;
    if (schema.enum?.length) return schema.enum[0];
    if (depth > 8) return schema.type === "object" ? {} : null;
    const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
    if (variant) return schemaTemplate(variant, includeOptional, depth + 1);
    const inherited = schema.allOf
      ? Object.assign({}, ...schema.allOf.map((part) => schemaTemplate(part, includeOptional, depth + 1)))
      : {};
    switch (schema.type ?? (schema.properties || schema.allOf ? "object" : undefined)) {
      case "object":
        return {
          ...inherited,
          ...Object.fromEntries(
            Object.entries(schema.properties ?? {})
              .filter(([name, property]) => !resolveSchema(property).readOnly && (includeOptional || schema.required?.includes(name)))
              .map(([name, property]) => [name, schemaTemplate(property, includeOptional, depth + 1)]),
          ),
        };
      case "array": return [];
      case "integer":
      case "number": return schema.minimum ?? 0;
      case "boolean": return false;
      default: return "";
    }
  }

  function validateValue(value: unknown, input: JsonSchema, path: string): void {
    const schema = resolveSchema(input);
    if (value === null && (schema.nullable || schema["x-nullable"])) return;
    for (const part of schema.allOf ?? []) validateValue(value, part, path);
    for (const [name, variants] of [["oneOf", schema.oneOf], ["anyOf", schema.anyOf]] as const) {
      if (!variants) continue;
      const matches = variants.filter((variant) => {
        try {
          validateValue(value, variant, path);
          return true;
        } catch {
          return false;
        }
      }).length;
      if (matches === 0 || (name === "oneOf" && matches !== 1)) {
        throw new Error(`${path}: must match ${name === "oneOf" ? "exactly one" : "at least one"} documented schema variant.`);
      }
    }
    if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
      throw new Error(`${path}: choose one of ${schema.enum.map(String).join(", ")}.`);
    }
    switch (schema.type ?? (schema.properties || schema.required ? "object" : undefined)) {
      case "object":
        if (!isJsonObject(value)) throw new Error(`${path}: enter a JSON object.`);
        for (const name of schema.required ?? []) {
          const property = schema.properties?.[name];
          if (property && resolveSchema(property).readOnly) continue;
          if (!Object.hasOwn(value, name)) throw new Error(`${path}.${name} is required.`);
        }
        for (const [name, entry] of Object.entries(value)) {
          const property = schema.properties && Object.hasOwn(schema.properties, name) ? schema.properties[name] : undefined;
          if (property) validateValue(entry, property, `${path}.${name}`);
          else if (schema.additionalProperties === false) throw new Error(`${path}.${name} is not allowed.`);
          else if (typeof schema.additionalProperties === "object") validateValue(entry, schema.additionalProperties, `${path}.${name}`);
        }
        break;
      case "array":
        if (!Array.isArray(value)) throw new Error(`${path}: enter a JSON array.`);
        if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path}: at least ${schema.minItems} items are required.`);
        if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path}: at most ${schema.maxItems} items are allowed.`);
        if (schema.items) {
          const items = schema.items;
          value.forEach((item, index) => validateValue(item, items, `${path}[${index}]`));
        }
        break;
      case "integer":
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
          throw new Error(`${path}: enter a valid ${schema.type}.`);
        }
        if (schema.minimum !== undefined && (value < schema.minimum || (schema.exclusiveMinimum === true && value === schema.minimum))) {
          throw new Error(`${path}: minimum is ${schema.minimum}${schema.exclusiveMinimum === true ? " (exclusive)" : ""}.`);
        }
        if (schema.maximum !== undefined && (value > schema.maximum || (schema.exclusiveMaximum === true && value === schema.maximum))) {
          throw new Error(`${path}: maximum is ${schema.maximum}${schema.exclusiveMaximum === true ? " (exclusive)" : ""}.`);
        }
        if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) throw new Error(`${path}: must exceed ${schema.exclusiveMinimum}.`);
        if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) throw new Error(`${path}: must be below ${schema.exclusiveMaximum}.`);
        break;
      case "boolean":
        if (typeof value !== "boolean") throw new Error(`${path}: choose true or false.`);
        break;
      case "string":
        if (typeof value !== "string") throw new Error(`${path}: enter text.`);
        if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${path}: minimum length is ${schema.minLength}.`);
        if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`${path}: maximum length is ${schema.maxLength}.`);
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${path}: must match ${schema.pattern}.`);
        break;
    }
  }

  return { resolveSchema, schemaDocument, schemaTemplate, validateValue };
}
