import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const base = "https://learn.microsoft.com/en-us/rest/api/";
const tocUrl = `${base}toc.json`;
const output = fileURLToPath(new URL("../src/features/power-platform-api/catalog.generated.json", import.meta.url));
const cache = join(tmpdir(), "pp-codeapp-api-reference");
await mkdir(cache, { recursive: true });

async function download(url) {
  const filename = join(cache, createHash("sha256").update(url).digest("hex"));
  if (!process.argv.includes("--fresh")) {
    try { return await readFile(filename, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { Accept: "text/markdown" } });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const text = await response.text();
  await writeFile(filename, text);
  return text;
}

function clean(value = "") {
  return value.replace(/<br\s*\/?>/gi, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\\([_|])/g, "$1").replace(/`/g, "").trim();
}

function tables(text) {
  const groups = text.match(/^\|[^\n]*(?:\n\|[^\n]*)*/gm) ?? [];
  const cells = (line) => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(clean);
  return groups.map((group) => {
    const lines = group.split("\n");
    const headers = cells(lines[0]);
    return lines.slice(2).filter((line) => !cells(line).every((cell) => /^[-:\s]*$/.test(cell))).map((line) => {
      const values = cells(line);
      if (values.length > headers.length) values.splice(headers.length - 1, Infinity, values.slice(headers.length - 1).join(" | "));
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
  });
}

function table(text, column = "Name") {
  return tables(text).find((rows) => rows.length && Object.hasOwn(rows[0], column)) ?? [];
}

function block(text, heading) {
  const start = text.indexOf(`## ${heading}\n`);
  if (start < 0) return "";
  const content = text.slice(start + heading.length + 4);
  const end = content.search(/^## /m);
  return end < 0 ? content : content.slice(0, end);
}

const tocText = await download(tocUrl);
const entries = [];
function walk(nodes, trail = []) {
  for (const node of nodes) {
    if (node.href?.startsWith("power-platform/") && node.href.split("/").filter(Boolean).length === 4) {
      entries.push({
        title: node.toc_title, docUrl: new URL(node.href, base).href,
        section: trail.at(-2), group: trail.at(-1),
      });
    }
    walk(node.children ?? [], [...trail, node.toc_title]);
  }
}
walk(JSON.parse(tocText).items);
if (!entries.length || new Set(entries.map((entry) => entry.docUrl)).size !== entries.length) {
  throw new Error("The published table of contents contains no operations or duplicate URLs.");
}
console.log(`Downloading ${entries.length} operations from the published table of contents.`);
let cursor = 0;
const pages = new Array(entries.length);
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < entries.length) {
    const index = cursor++;
    pages[index] = (await download(`${entries[index].docUrl}?accept=text/markdown`)).replace(/\r\n/g, "\n");
  }
}));

const definitions = {};
const issues = new Set();
const operations = entries.map((entry, index) => {
  const page = pages[index];
  const frontmatter = page.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) throw new Error(`Missing document metadata: ${entry.docUrl}`);
  const metadata = parse(frontmatter[1]);
  if (metadata.page_kind !== "operation") throw new Error(`Not an operation page: ${entry.docUrl}`);
  const id = metadata.uid;
  const chunks = block(page, "Definitions").split(/^### /m).slice(1);
  const models = new Map(chunks.map((chunk) => [clean(chunk.split("\n")[0]), chunk.slice(chunk.indexOf("\n") + 1)]));
  const warnings = new Set();
  function typeSchema(raw) {
    const name = clean(raw);
    if (!name) return {};
    if (name === "file") return { type: "string", format: "binary" };
    if (name.startsWith("enum:")) return { type: "string", enum: name.slice(5).split(/\s*-\s+/).filter(Boolean) };
    const dictionary = name.match(/^<string,\s*(.+)>$/);
    if (dictionary) return { type: "object", additionalProperties: typeSchema(dictionary[1]) };
    const array = name.match(/^(.*?)\[\](?:\s+\(([^)]+)\))?$/);
    if (array) return { type: "array", items: { ...typeSchema(array[1]), ...(array[2] ? { format: array[2] } : {}) } };
    const primitive = name.match(/^(string|integer|number|boolean|object|array)(?:\s+\(([^)]+)\))?(?=\s|$)/i);
    if (primitive) {
      const schema = { type: primitive[1].toLowerCase(), ...(primitive[2] ? { format: primitive[2] } : {}) };
      for (const constraint of name.matchAll(/(minimum|maximum|minLength|maxLength|minItems|maxItems):\s*(-?\d+(?:\.\d+)?)/g)) {
        schema[constraint[1]] = Number(constraint[2]);
      }
      const pattern = name.match(/pattern:\s*\/(.+)\/[a-z]*$/);
      if (pattern) schema.pattern = pattern[1];
      return schema;
    }
    if (!models.has(name)) {
      if (name === id || ["Geo", "Clause", "WebApplicationFirewallStatus", "ActionEvent"].includes(name)) {
        const warning = `Microsoft Learn references "${name}" without defining its schema. No local type restriction is inferred; consult the operation documentation.`;
        warnings.add(warning);
        return { description: warning };
      }
      issues.add(`Undocumented schema type "${name}": ${entry.docUrl}`);
      return {};
    }
    return { $ref: `#/definitions/${`${id}.${name}`.replace(/~/g, "~0").replace(/\//g, "~1")}` };
  }
  function objectSchema(rows) {
    return {
      type: "object",
      properties: Object.fromEntries(rows.map((row) => [row.Name, typeSchema(row.Type)])),
      ...(rows.some((row) => row.Required === "True")
        ? { required: rows.filter((row) => row.Required === "True").map((row) => row.Name) } : {}),
    };
  }
  for (const [name, content] of models) {
    const rows = table(content, "Value").length ? table(content, "Value") : table(content);
    let schema;
    if (rows.length && Object.hasOwn(rows[0], "Value")) {
      schema = { type: "string", enum: rows.map((row) => row.Value) };
    } else if (rows.length && Object.hasOwn(rows[0], "Name") && Object.hasOwn(rows[0], "Type")) {
      schema = objectSchema(rows);
    } else if (rows.length && Object.hasOwn(rows[0], "Name") && Object.hasOwn(rows[0], "Description")) {
      schema = { type: "string", enum: rows.map((row) => row.Name) };
    } else {
      const kind = content.trim().split("\n")[0];
      schema = typeSchema(kind);
    }
    definitions[`${id}.${name}`] = schema;
  }
  const http = page.match(/```http\n([A-Z]+) (https:\/\/api\.powerplatform\.com[^\s]*)/);
  if (!http) throw new Error(`Missing supported HTTP request: ${entry.docUrl}`);
  const [, method, template] = http;
  const path = template.slice("https://api.powerplatform.com".length).split("?")[0];
  const queryDefaults = new URLSearchParams(template.split("?")[1] ?? "");
  const parameters = table(block(page, "URI Parameters")).map((row) => {
    const value = queryDefaults.get(row.Name);
    return {
      name: row.Name, in: row.In, required: row.Required === "True", description: `Documented ${row.In} parameter.`,
      schema: { ...typeSchema(row.Type), ...(value !== null && !value.includes("{") ? { default: value } : {}) },
    };
  });
  for (const row of table(block(page, "Request Header"))) {
    parameters.push({ name: row.Name, in: "header", required: row.Required === "True", description: "Documented request header.", schema: typeSchema(row.Type) });
  }
  const bodyText = block(page, "Request Body");
  const bodyRows = table(bodyText);
  // A sole "body" row describes the payload itself, not an object property.
  const rootBody = bodyRows.length === 1 && bodyRows[0].Name === "body";
  const body = bodyText ? {
    required: true,
    description: "Documented JSON request body. Review the operation documentation for business rules.",
    schema: rootBody ? typeSchema(bodyRows[0].Type) : bodyRows.length ? objectSchema(bodyRows) : {},
  } : undefined;
  const responses = table(block(page, "Responses")).map((row) => ({
    status: row.Name, description: row.Name, ...(row.Type ? { schema: typeSchema(row.Type) } : {}),
  }));
  const description = `Send a ${method} request to ${path}. Open the operation documentation for usage and permission details.`;
  return { ...entry, id, description, method, path, sourceRevision: metadata.git_commit_id, warnings: [...warnings], parameters, ...(body ? { body } : {}), responses };
});

const revisions = [...new Set(operations.map((operation) => operation.sourceRevision))].sort();
if (issues.size) throw new Error([...issues].join("\n"));
const catalog = {
  source: {
    url: tocUrl, revision: revisions.join(","),
    generatedAt: new Date().toISOString(), license: "API interface metadata only; source documentation subject to Microsoft Learn terms.",
    operationCount: entries.length,
    contentHash: createHash("sha256").update(tocText + pages.join("\n")).digest("hex"),
  },
  operations, definitions,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated ${operations.length} operations, ${new Set(operations.map((operation) => operation.section)).size} sections, ${Object.keys(definitions).length} schemas.`);
