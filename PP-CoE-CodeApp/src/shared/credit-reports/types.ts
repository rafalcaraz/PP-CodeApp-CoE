export const REPORT_NAMES = ["BillingDetailsPerEnvironment", "FeatureDetailsPerResource"] as const;
export type ReportName = typeof REPORT_NAMES[number];
export interface ReportRange { startDate: string; endDate: string }

export const REPORT_SCHEMAS = {
  FeatureDetailsPerResource: {
    label: "Resources & features", date: "ConsumptionDate",
    first: "BilledCredits", second: "NonBilledCredits",
    firstLabel: "Billed credits", secondLabel: "Nonbilled credits",
  },
  BillingDetailsPerEnvironment: {
    label: "Environment billing", date: "BilledDate",
    first: "CapacityPackCreditsConsumed", second: "PayGoConsumedQuantity",
    firstLabel: "Capacity-pack credits consumed", secondLabel: "Pay-as-you-go credits consumed",
  },
} as const;

export interface CreditReportRow {
  readonly date: string;
  readonly environmentId: string | null;
  readonly environmentName: string | null;
  readonly first: number;
  readonly second: number;
  readonly cells: Readonly<Record<string, string>>;
}

export interface CreditReport {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly name: ReportName;
  readonly granularity: "Daily";
  readonly source: "power-platform-api" | "connector" | "upload";
  readonly loadedAt: string;
  readonly requestedRange?: ReportRange;
  readonly tenantAssignment?: { readonly tenantId: string; readonly assignedAt: string };
  readonly observedRange: ReportRange | null;
  readonly columns: readonly string[];
  readonly rows: readonly CreditReportRow[];
  readonly fileName: string;
  readonly original: Blob;
}

export interface ReconciledCreditReport extends Omit<CreditReport, "source" | "original" | "fileName"> {
  readonly source: "reconciled";
  readonly captureIds: readonly string[];
  readonly daySources: Readonly<Record<string, string>>;
  readonly scopeKey: string;
}

export interface ReportJob {
  name: ReportName;
  range: ReportRange;
  operationId?: string;
  fileName?: string;
  nextPollAt?: number;
  phase: "submitting" | "waiting" | "polling" | "downloading" | "ready" | "failed";
}

export type ReportResult<T> = { ok: true; data: T } | {
  ok: false; error: string; cancelled?: boolean; job?: ReportJob; diagnostic?: unknown;
};
