import { useSyncExternalStore } from "react";
import type { CreditReport, ReportJob, ReportName } from "./types";

// One complete snapshot per report type. Replacing, never appending, prevents
// overlapping downloads/imports from counting the same consumption twice.
let reports: readonly CreditReport[] = [];
export interface SavedReportJob { job: ReportJob; error?: string; diagnostic?: unknown }
let jobs: readonly SavedReportJob[] = [];
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }

export function getCreditReports(): readonly CreditReport[] { return reports; }
export function replaceCreditReport(report: CreditReport) {
  reports = [...reports.filter((entry) => entry.name !== report.name), report];
  notify();
}
export function clearCreditReports(name?: ReportName) {
  reports = name ? reports.filter((report) => report.name !== name) : [];
  notify();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useCreditReports() {
  return useSyncExternalStore(subscribe, getCreditReports);
}
export function saveReportJob(job: ReportJob, error?: string, diagnostic?: unknown) {
  jobs = [...jobs.filter((entry) => entry.job.name !== job.name), { job, error, diagnostic }];
  notify();
}
export function getReportJobs() { return jobs; }
export function useReportJobs() {
  return useSyncExternalStore(subscribe, getReportJobs);
}
