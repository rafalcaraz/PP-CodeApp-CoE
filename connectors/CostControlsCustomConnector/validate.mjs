import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const definitionText = read("apiDefinition.swagger.json");
const propertiesText = read("apiProperties.json");
const definition = JSON.parse(definitionText);
const properties = JSON.parse(propertiesText);
const root = "/beta/copilot/costManagement";
const policy = "/spendingPolicies/{id}";
const groups = `${policy}/microsoft.graph.selectedGroupsSpendingPolicy/assignedGroups`;
const alerts = `${policy}/emailThresholdSettings`;
const users = "/userBalances/{userId}";
const requests = "/creditRequests";
const reports = "/usageReports";
const dailyQueries = ["startDate", "endDate", "$select", "$count", "$top", "$orderby", "$filter"];
const keyedDailyQueries = ["startDate", "endDate", "$select"];
const methods = new Set(["get", "post", "patch", "delete"]);
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const same = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const sorted = (values) => [...values].sort();
const resolve = (value) => {
  if (!value.$ref) return value;
  const parts = value.$ref.split("/");
  check(parts.length === 3 && parts[0] === "#", `Only local direct references: ${value.$ref}`);
  const target = definition[parts[1]]?.[parts[2]];
  check(target !== undefined, `Unresolved reference: ${value.$ref}`);
  return target;
};
const expected = [
  ["get", "/getTenantCreditBalance", "GetTenantCreditBalance", []],
  ["get", "/spendingPolicies", "ListSpendingPolicies", ["$select", "$top", "$count", "$filter", "$orderby"]],
  ["post", "/spendingPolicies", "CreateSpendingPolicy", []],
  ["get", policy, "GetSpendingPolicy", ["$select"]],
  ["patch", policy, "UpdateSpendingPolicy", []],
  ["delete", policy, "DeleteSpendingPolicy", []],
  ["get", groups, "ListAssignedGroups", []],
  ["get", `${groups}/$ref`, "ListAssignedGroupReferences", []],
  ["post", `${groups}/$ref`, "AddAssignedGroup", []],
  ["delete", `${groups}/{groupId}/$ref`, "RemoveAssignedGroup", []],
  ["get", `${policy}/serviceSettings`, "ListServiceSettings", ["$select"]],
  ["post", `${policy}/serviceSettings`, "CreateServiceSetting", []],
  ["get", `${policy}/serviceSettings/{serviceId}`, "GetServiceSetting", ["$select"]],
  ["patch", `${policy}/serviceSettings/{serviceId}`, "UpdateServiceSetting", []],
  ["get", alerts, "GetAlertSetting", ["$select"]],
  ["patch", alerts, "UpdateAlertSetting", []],
  ["delete", alerts, "DeleteAlertSetting", []],
  ["get", `${alerts}/recipients`, "ListRecipients", []],
  ["get", `${alerts}/recipients/$ref`, "ListRecipientReferences", []],
  ["post", `${alerts}/recipients/$ref`, "AddRecipient", []],
  ["delete", `${alerts}/recipients/{userId}/$ref`, "RemoveRecipient", []],
  ["get", users, "GetUserBalance", ["$select", "$expand"]],
  ["get", `${users}/serviceBalances`, "ListUserServiceBalances", ["$select", "$top", "$count", "$filter", "$orderby"]],
  ["get", `${users}/serviceBalances/{serviceId}`, "GetUserServiceBalance", ["$select"]],
  ["get", requests, "ListCreditRequests", ["$select", "$count", "$top", "$filter"]],
  ["get", `${requests}/{id}`, "GetCreditRequest", ["$select"]],
  ["patch", `${requests}/{id}`, "UpdateCreditRequest", []],
  ["post", `${requests}/batchRecordDecisions`, "BatchRecordCreditRequestDecisions", []],
  ["get", `${reports}/userUsageRecords`, "ListUserUsageRecords", dailyQueries],
  ["get", `${reports}/userUsageRecords/{userId}`, "GetUserUsageRecord", keyedDailyQueries],
  ["get", `${reports}/groupUsageRecords`, "ListGroupUsageRecords", dailyQueries],
  ["get", `${reports}/groupUsageRecords/{groupId}`, "GetGroupUsageRecord", keyedDailyQueries],
  ["get", `${reports}/serviceUsageRecords`, "ListServiceUsageRecords", dailyQueries],
  ["get", `${reports}/serviceUsageRecords/{serviceId}`, "GetServiceUsageRecord", keyedDailyQueries],
  ["get", `${reports}/fundingUsageRecords`, "ListFundingUsageRecords", ["month", "$select", "$count", "$orderby"]],
  ["get", `${reports}/userUsageDetails/{userId}`, "GetUserUsageDetail", ["startDateTime", "endDateTime", "$select", "$expand"]],
  ["get", `${reports}/userUsageDetails/{userId}/services`, "ListUserUsageServiceDetails", ["startDateTime", "endDateTime", "$select"]],
  ["get", `${reports}/userUsageDetails/{userId}/sessions`, "ListUserUsageSessionDetails", ["startDateTime", "endDateTime", "$select", "$top"]],
];
const actual = Object.entries(definition.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, operation]) => {
    check(methods.has(method), `Unexpected method/path-item member: ${method} ${path}`);
    return [method, path, operation];
  }),
);
same(definition.swagger, "2.0", "Power Platform requires Swagger 2.0");
check(Buffer.byteLength(definitionText, "utf8") < 1_000_000, "Power Platform definition must be smaller than 1 MB");
same(definition.info.title, "CostControlsCustomConnector", "Exact connector name");
check(definition.info.title.length <= 200, "Connector display name must fit Dataverse's documented 200-character limit");
check(typeof definition.info.description === "string" && definition.info.description.length > 0 && definition.info.description.length <= 255,
  "Connector description must fit the conservative 255-character repository import budget; keep extended guidance in README.md");
same(definition.host, "graph.microsoft.com", "Fixed Graph host");
same(definition.basePath, root, "Fixed beta cost root");
same(definition.schemes, ["https"], "HTTPS only");
same(definition.consumes, ["application/json"], "JSON request content type");
same(definition.produces, ["application/json"], "JSON response content type");
same(definition.security, [{ oauth2: [] }], "Delegated OAuth applies to every action");
same(definition.securityDefinitions.oauth2.flow, "accessCode", "Authorization code, not app-only auth");
same(definition.securityDefinitions.oauth2.authorizationUrl, "https://login.microsoftonline.com/common/oauth2/authorize", "v1 authorization endpoint");
same(definition.securityDefinitions.oauth2.tokenUrl, "https://login.microsoftonline.com/common/oauth2/token", "v1 token endpoint");
same(definition.securityDefinitions.oauth2.scopes, {}, "Resource-based AAD metadata supplies consent configuration");
same(actual.length, 38, "36 documented actions plus two documented reference-list variants");
same(new Set(actual.map(([, , op]) => op.operationId)).size, 38, "Unique operation IDs");
same(
  sorted(actual.map(([method, path, op]) => `${method} ${path} ${op.operationId}`)),
  sorted(expected.map(([method, path, id]) => `${method} ${path} ${id}`)),
  "Exact method/path/operation coverage",
);
same(new Set(actual.map(([, , op]) => op.externalDocs.url)).size, 36, "All 36 authoritative operation pages are linked");

let mutationsWithParentEtag = 0;
for (const [method, path, id, queries] of expected) {
  const operation = definition.paths[path][method];
  check(!Object.keys(operation).some((key) => key.startsWith("/")), `${id}: routes cannot be nested inside operations`);
  const parameters = (operation.parameters ?? []).map(resolve);
  same(sorted(parameters.filter((p) => p.in === "query").map((p) => p.name)), sorted(queries), `${id}: documented query surface only`);
  const pathNames = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  same(sorted(parameters.filter((p) => p.in === "path").map((p) => p.name)), sorted(pathNames), `${id}: all path variables declared exactly once`);
  check(parameters.filter((p) => p.in === "path").every((p) => p.required === true), `${id}: required path variables`);
  same(new Set(parameters.map((p) => `${p.in}:${p.name}`)).size, parameters.length, `${id}: unique parameters`);
  check(!Object.hasOwn(operation, "security"), `${id}: no authentication override`);
  check(operation.externalDocs.url.startsWith("https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/admin-settings/cost-management/"), `${id}: official operation source`);
  check(!Object.hasOwn(operation, "x-ms-pageable"), `${id}: no unverified automatic paging`);
  const requiresEtag = method !== "get" && path.startsWith(`${policy}`);
  const etags = parameters.filter((p) => p.in === "header" && p.name === "If-Match");
  const isCreditRequestUpdate = method === "patch" && path === `${requests}/{id}`;
  same(etags.length, requiresEtag || isCreditRequestUpdate ? 1 : 0, `${id}: correct If-Match presence`);
  if (requiresEtag) {
    same(etags[0].required, true, `${id}: parent ETag is required`);
    check(!Object.hasOwn(etags[0], "default"), `${id}: no fabricated ETag default`);
    mutationsWithParentEtag++;
  }
  if (isCreditRequestUpdate) {
    same(etags[0], definition.parameters.CreditRequestIfMatch, `${id}: request token, not policy token`);
    same(etags[0].required, true, `${id}: strong request ETag required`);
    check(!Object.hasOwn(etags[0], "default"), `${id}: no fabricated request ETag`);
  }
  const bodies = parameters.filter((p) => p.in === "body");
  same(bodies.length, ["post", "patch"].includes(method) ? 1 : 0, `${id}: correct body presence`);
  if (bodies.length) same(bodies[0].required, true, `${id}: body required`);
  same(operation.responses.default, { $ref: "#/responses/GraphError" }, `${id}: errors not disguised as success`);
  const successCodes = Object.keys(operation.responses).filter((code) => /^2\d\d$/.test(code));
  const success = isCreditRequestUpdate || method === "delete" || (method === "post" && path.endsWith("/$ref"))
    ? "204" : path === `${requests}/batchRecordDecisions` ? "200" : method === "post" ? "201" : "200";
  same(successCodes, [success], `${id}: documented success code`);
  if (success === "204") check(!operation.responses[success].schema, `${id}: 204 has no body`);
}
same(mutationsWithParentEtag, 10, "All ten existing-policy mutations require parent concurrency");
check(!definition.paths[`${policy}/serviceSettings/{serviceId}`].delete, "Service settings have no DELETE");
check(!definition.paths["/userBalances"], "No invented userBalances list operation");
check(!definition.paths[reports], "No invented readable usageReports root");
check(!definition.paths[`${reports}/userUsageDetails`], "No invented raw user detail list");
check(!definition.paths[requests].post && !definition.paths[`${requests}/{id}`].delete, "Credit requests cannot be created or deleted");
check(!definition.paths[`${reports}/userUsageDetails/{userId}/sessions/{id}`], "No invented session-key read");

for (const [method, path, code] of [
  ["post", "/spendingPolicies", "201"],
  ["get", policy, "200"],
  ["patch", policy, "200"],
  ["post", `${groups}/$ref`, "204"],
  ["post", `${policy}/serviceSettings`, "201"],
  ["patch", `${policy}/serviceSettings/{serviceId}`, "200"],
  ["patch", alerts, "200"],
  ["post", `${alerts}/recipients/$ref`, "204"],
  ["get", `${requests}/{id}`, "200"],
  ["patch", `${requests}/{id}`, "204"],
]) {
  same(definition.paths[path][method].responses[code].headers.ETag.type, "string", `${method} ${path}: preserve ETag header`);
}
for (const path of ["/spendingPolicies", `${policy}/serviceSettings`]) {
  same(definition.paths[path].post.responses["201"].headers.Location.type, "string", `${path}: preserve Location`);
}
for (const name of ["SpendingPolicyCollection", "GroupCollection", "ReferenceCollection", "ServiceSettingCollection", "UserCollection", "UserServiceBalanceCollection", "CreditRequestCollection", "UserUsageRecordCollection", "GroupUsageRecordCollection", "ServiceUsageRecordCollection", "UserUsageSessionDetailCollection"]) {
  const schema = definition.definitions[name];
  same(schema.properties.value.type, "array", `${name}: OData value array`);
  same(schema.properties["@odata.nextLink"].type, "string", `${name}: continuation preserved`);
}
for (const name of ["SpendingPolicyCollection", "UserServiceBalanceCollection", "CreditRequestCollection", "UserUsageRecordCollection", "GroupUsageRecordCollection", "ServiceUsageRecordCollection", "FundingUsageRecordCollection"]) {
  same(definition.definitions[name].properties["@odata.count"].type, "integer", `${name}: count retained`);
}

const defs = definition.definitions;
same(sorted(defs.CreateSpendingPolicy.required), sorted(["@odata.type", "displayName", "periodLimit", "perUserLimit", "serviceSettings"]), "Documented create requirements");
same(sorted(Object.keys(defs.UpdateSpendingPolicy.properties)), sorted(["displayName", "periodLimit", "perUserLimit", "billingMethods"]), "Only documented mutable policy fields");
same(Object.keys(defs.UpdateServiceSetting.properties), ["state"], "Only service state can change");
same(sorted(defs.CreateServiceSetting.required), ["serviceId", "state"], "Service create requirements");
same(sorted(Object.keys(defs.UpdateAlertSetting.properties)), ["isEnabled", "thresholds"], "No inline recipients");
same(defs.UpdateAlertSetting.properties.thresholds.items.$ref, "#/definitions/AlertThreshold", "Alert thresholds use documented concrete types");
check(!defs.UpdateAlertSetting.required, "Alert PATCH permits empty merge object");
same(defs.CreateSpendingPolicy.properties.displayName.minLength, 10, "Minimum display name length");
same(defs.CreateSpendingPolicy.properties.displayName.maxLength, 64, "Maximum display name length");
same(defs.Quantity.required, ["@odata.type", "unit"], "Unlimited quantity must not require value");
same(defs.Quantity.properties.value.type, "number", "Limited quantity value is numeric");
check(!defs.CreateSpendingPolicy.properties.billingMethods.enum, "Billing flags must support combined values");
same(defs.AlertThreshold.required, ["@odata.type", "value"], "Percentage threshold must not require unit");
same(defs.AlertThreshold.properties["@odata.type"].enum, ["#microsoft.graph.percentageCostManagementAlertThreshold", "#microsoft.graph.absoluteCostManagementAlertThreshold"], "Both documented threshold types");
same(defs.Quantity.properties["@odata.type"].enum, ["#microsoft.graph.limitedCostManagementQuantity", "#microsoft.graph.unlimitedCostManagementQuantity"], "Both documented quantity types");
same(defs.ServiceSetting.properties.parentEtag.type, "string", "Child exposes parent token");
same(defs.ServiceSetting.properties.parentStatus.type, "string", "Child exposes parent lifecycle");
same(defs.UserBalance.properties.unevaluatedServices.type, "array", "Partial evaluation retained");
same(defs.UserBalance.properties.selectionDataStatus.$ref, "#/definitions/SelectionDataStatus", "Source freshness retained");
same(defs.GraphErrorEnvelope.properties.error.properties.innerError.$ref, "#/definitions/GraphInnerError", "OData inner error retained");
same(definition.responses.GraphError.headers["Retry-After"].type, "string", "Retry guidance retained");
for (const name of ["GroupReference", "UserReference"]) same(defs[name].required, ["@odata.id"], `${name}: reference URL required`);

const params = (path) => definition.paths[path].get.parameters.map(resolve);
for (const family of ["user", "group", "service"]) {
  const path = `${reports}/${family}UsageRecords`;
  const key = `${family}Id`;
  for (const target of [path, `${path}/{${key}}`]) {
    const selectors = params(target).filter((p) => ["startDate", "endDate"].includes(p.name));
    same(selectors.length, 2, `${target}: both day selectors`);
    check(selectors.every((p) => p.required === true && p.type === "string" && p.format === "date"), `${target}: required dates, not timestamp windows`);
  }
  const top = params(path).find((p) => p.name === "$top");
  same([top.minimum, top.maximum, top.default], [1, 100, 10], `${family}: exact daily top bounds/default`);
  check(params(path).find((p) => p.name === "$filter").description.includes(`${key} eq`), `${family}: correct dimension filter`);
}
for (const suffix of ["", "/services", "/sessions"]) {
  const selectors = params(`${reports}/userUsageDetails/{userId}${suffix}`)
    .filter((p) => ["startDateTime", "endDateTime"].includes(p.name));
  same(selectors.length, 2, `Raw detail ${suffix}: both timestamp selectors`);
  check(selectors.every((p) => p.required === true && p.type === "string" && p.format === "date-time"), `Raw detail ${suffix}: required timestamp window`);
}
const requestTop = params(requests).find((p) => p.name === "$top");
same([requestTop.minimum, requestTop.maximum, requestTop.default], [1, 200, 50], "Credit request page bounds/default differ from reports");
const sessionTop = params(`${reports}/userUsageDetails/{userId}/sessions`).find((p) => p.name === "$top");
same([sessionTop.minimum, sessionTop.maximum, sessionTop.default], [undefined, 100, 20], "Session default/max without an undocumented minimum");
const month = params(`${reports}/fundingUsageRecords`).find((p) => p.name === "month");
same(month.required, true, "Funding month required");
check(new RegExp(month.pattern).test("2026-07"), "Funding month accepts YYYY-MM");
for (const invalid of ["2026-00", "2026-13", "2026-7", "2026-07-01"]) {
  check(!new RegExp(month.pattern).test(invalid), `Funding month rejects ${invalid}`);
}
for (const name of ["FundingUsageRecordCollection", "UserUsageServiceDetailCollection"]) {
  same(defs[name].properties.value.type, "array", `${name}: collection value preserved`);
  check(!defs[name].properties["@odata.nextLink"], `${name}: unpaged contract`);
}
same(defs.CreditRequest.properties["@odata.etag"].type, "string", "Strong request ETag is accessible in body");
check(!defs.CreditRequest.properties.serviceId.enum, "Request service IDs remain extensible");
same(defs.CreditRequestDecisionIdentity["x-nullable"], true, "Pending decision identity can be null");
same(defs.CreditRequest.properties.expirationDateTime["x-nullable"], true, "Request expiration can be null");
same(defs.UpdateCreditRequest.required, ["state"], "Only request state is writable");
same(Object.keys(defs.UpdateCreditRequest.properties), ["state"], "No writable requested amount or audit fields");
same(defs.UpdateCreditRequest.properties.state.enum, ["pending", "approved", "rejected", "cancelled"], "Recognized same-state no-ops supported; transition validation remains authoritative");
same(defs.BatchCreditRequestDecisions.required, ["requests"], "Batch payload required");
const batchItems = defs.BatchCreditRequestDecisions.properties.requests;
same([batchItems.minItems, batchItems.maxItems], [1, 100], "Batch accepts 1-100 items");
same(batchItems.items.$ref, "#/definitions/CreditRequestUpdateItem", "Typed decision items");
same(sorted(defs.CreditRequestUpdateItem.required), ["etag", "requestId", "state"], "Every valid decision supplies its own token");
same(sorted(Object.keys(defs.CreditRequestUpdateItem.properties)), ["etag", "requestId", "state"], "No amount or policy ID in decisions");
same(defs.CreditRequestUpdateItem.properties.state.enum, defs.UpdateCreditRequest.properties.state.enum, "Batch and individual state contracts agree");
same(defs.CreditRequestUpdateItem.properties.etag.pattern, definition.parameters.CreditRequestIfMatch.pattern, "Same strong ETag shape for PATCH and batch");
const strongEtag = new RegExp(definition.parameters.CreditRequestIfMatch.pattern);
check(strongEtag.test('"current-token"'), "Quoted strong ETag accepted");
check(strongEtag.test('""'), "Quoted empty opaque tag is structurally strong; the server still checks the current token");
for (const invalid of ['W/"weak"', "*", "unquoted", '"line\nbreak"', '"token"\n', '"token"\r\n']) {
  check(!strongEtag.test(invalid), `Invalid request ETag rejected: ${JSON.stringify(invalid)}`);
}
same(defs.CreditRequestUpdateResponse.properties.responses.items.$ref, "#/definitions/CreditRequestUpdateResponseItem", "Per-item HTTP-200 results retained");
same(sorted(Object.keys(defs.CreditRequestUpdateResponse.properties)), ["failedCount", "responses", "succeededCount"], "Batch result counts and ordered responses");
check(!defs.CreditRequestUpdateResponseItem.properties.status.enum, "Unknown future batch statuses preserved, not mistaken for success");
for (const name of ["UserUsageRecord", "GroupUsageRecord"]) {
  same(defs[name].properties.sessionCount.format, "int64", `${name}: session count retained`);
  check(!defs[name].properties.id && !defs[name].properties.dataStatus, `${name}: no invented ID or freshness`);
}
check(!defs.ServiceUsageRecord.properties.sessionCount && !defs.ServiceUsageRecord.properties.id, "Service report has no invented session count or ID");
same(defs.UserUsageServiceDetail.properties.id.type, "string", "Raw service key is id");
check(!defs.UserUsageServiceDetail.properties.serviceId, "No renamed raw serviceId");
same(defs.UserUsageDetail.properties["sessions@odata.nextLink"].type, "string", "Expanded session continuation preserved");
same(defs.UsageDataStatus["x-nullable"], true, "Raw source freshness can be null");
same(defs.UsageDataStatus.properties.latestSourceDateTime.format, "date-time", "Source watermark preserved");
for (const field of ["sourceSessionId", "firstActivityDateTime", "lastActivityDateTime"]) {
  same(defs.UserUsageSessionDetail.properties[field]["x-nullable"], true, `Session ${field}: null preserved`);
}
check(!defs.FundingUsageRecord.properties.fundingClass.enum, "Future funding classes preserved");

const auth = properties.properties.connectionParameters.token;
same(auth.type, "oauthSetting", "Power Platform OAuth token metadata");
same(auth.oAuthSettings.identityProvider, "aad", "Delegated Entra provider");
same(auth.oAuthSettings.clientId, "REPLACE_ME_CLIENT_ID", "No embedded client ID");
same(auth.oAuthSettings.customParameters.tenantId.value, "REPLACE_ME_TENANT_ID", "No embedded tenant ID");
same(auth.oAuthSettings.customParameters.resourceUri.value, "https://graph.microsoft.com", "Correct Graph audience");
same(auth.oAuthSettings.customParameters.loginUri.value, "https://login.microsoftonline.com", "Commercial Entra authority");
same(auth.oAuthSettings.scopes, [], "Legacy resource-based OAuth uses registration consent");
same(auth.oAuthSettings.properties, { IsFirstParty: "False" }, "No first-party or app-only claim");
same(sorted(Object.keys(auth.oAuthSettings.customParameters)), ["loginUri", "resourceUri", "tenantId"], "Only schema-supported AAD custom parameters");
same(auth.oAuthSettings.redirectMode, "Global", "Official companion redirect template default");
same(auth.oAuthSettings.redirectUrl, "https://global.consent.azure-apim.net/redirect", "Template redirect only; setup requires actual connector URI");
same(properties.properties.connectionParameters["token:TenantId"].metadata.sourceType, "AzureActiveDirectoryTenant", "Official hidden tenant-claim shape");
same(properties.properties.capabilities, [], "No flow or trigger capabilities");
check(!properties.properties.policyTemplateInstances, "No hidden rewrite/proxy policy");

const walk = (node) => {
  if (node === null || typeof node !== "object") return;
  if (node.$ref) resolve(node);
  for (const [key, value] of Object.entries(node)) {
    check(!["oneOf", "anyOf", "const", "nullable", "openapi"].includes(key), `No unsupported OpenAPI 3 / conditional keyword: ${key}`);
    check(!/^(clientSecret|client_secret|password|access_token|refresh_token|Authorization|apiKey)$/i.test(key), `No embedded credential field: ${key}`);
    walk(value);
  }
};
walk(definition);
walk(properties);
for (const text of [definitionText, propertiesText]) {
  check(!/Bearer\s+[A-Za-z0-9._~-]+/i.test(text), "No bearer token");
  check(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text), "No JWT");
  check(!/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i.test(text), "No real tenant, client, environment or connection GUID");
}

console.log(`PASS: ${checks} offline checks; 38 actions covering 36 documented operations and two GET /$ref variants.`);
console.log("PASS: parent versus strong request ETags, report selectors/query surfaces, batch per-item results, nullable raw detail, OData envelopes and credential-free AAD metadata.");
console.log("This validates the standalone definition only, not tenant consent/rollout/runtime roles, SDK response-header exposure or continuation transport. Verify registered app and exported solution metadata separately using the documented upgrade.");
