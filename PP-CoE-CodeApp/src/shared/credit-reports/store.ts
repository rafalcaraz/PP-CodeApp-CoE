import { useSyncExternalStore } from "react";
import type { CreditReport, ReportJob, ReportName } from "./types";
import { orderCreditReportCaptures } from "./collection";

let captures: readonly CreditReport[] = [];
let reports: readonly CreditReport[] = [];
export interface SavedReportJob { job: ReportJob; error?: string; diagnostic?: unknown }
let jobs: readonly SavedReportJob[] = [];
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }

export function getCreditReports(): readonly CreditReport[] { return reports; }
export function getCreditReportCaptures(): readonly CreditReport[] { return captures; }
function refreshSnapshots() {
  const latest = new Map<ReportName, CreditReport>();
  for (const capture of orderCreditReportCaptures(captures)) latest.set(capture.name, capture);
  reports = [...latest.values()];
  notify();
}
export function retainCreditReport(report: CreditReport) {
  captures = captures.some((entry) => entry.id === report.id)
    ? captures.map((entry) => entry.id === report.id ? report : entry)
    : [...captures, report];
  refreshSnapshots();
}
export function hydrateCreditReportCaptures(restored: readonly CreditReport[]) {
  const currentIds = new Set(captures.map((capture) => capture.id));
  captures = [...restored.filter((capture) => !currentIds.has(capture.id)), ...captures];
  refreshSnapshots();
}
export const replaceCreditReport = retainCreditReport;
export function removeCreditReportCapture(id: string) {
  captures = captures.filter((capture) => capture.id !== id);
  refreshSnapshots();
}
export function clearCreditReports(name?: ReportName) {
  captures = name ? captures.filter((capture) => capture.name !== name) : [];
  refreshSnapshots();
}
export function subscribeCreditReportCaptures(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useCreditReports() {
  return useSyncExternalStore(subscribeCreditReportCaptures, getCreditReports);
}
export function useCreditReportCaptures() {
  return useSyncExternalStore(subscribeCreditReportCaptures, getCreditReportCaptures);
}
export function saveReportJob(job: ReportJob, error?: string, diagnostic?: unknown) {
  jobs = [...jobs.filter((entry) => entry.job.name !== job.name), { job, error, diagnostic }];
  notify();
}
export function getReportJobs() { return jobs; }
export function useReportJobs() {
  return useSyncExternalStore(subscribeCreditReportCaptures, getReportJobs);
}
