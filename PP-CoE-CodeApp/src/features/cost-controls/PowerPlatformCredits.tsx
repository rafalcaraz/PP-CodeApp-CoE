import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Field, Input, Select, Tab, TabList, Text,
} from "@fluentui/react-components";
import { ArrowDownloadRegular, ArrowUploadRegular } from "@fluentui/react-icons";
import { ErrorPane, LoadingPane } from "../../components/Status";
import {
  acquireCreditReport, clearCreditReports, creditReportScopes, defaultReportRange, exportCreditReportArchive,
  findCoveringCreditReport, orderCreditReportCaptures, readCreditReport, reconcileCreditReports,
  removeCreditReportCapture, reportRangePreset, retainCreditReport,
  REPORT_NAMES, REPORT_SCHEMAS, saveReportJob, useCreditReportCaptures, useCreditReports, useReportJobs, validateReportRange,
  type CreditReport, type ReportJob, type ReportName, type ReportRange,
} from "../../shared/credit-reports";
import { formatApiError } from "../../shared/api-explorer/schema";
import { CreditReportAnalysis } from "./CreditReportAnalysis";
import { Diagnostics } from "./Diagnostics";
import { useCostStyles } from "./styles";

const REQUEST_PRESETS = [
  { value: "30", label: "Last 30 complete UTC days", days: 30 },
  { value: "7", label: "Last 7 complete UTC days", days: 7 },
  { value: "1", label: "Last 24 hours (last complete UTC day)", days: 1 },
] as const;

function downloadFile(file: Blob, fileName: string) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function PowerPlatformCredits() {
  const styles = useCostStyles();
  const reports = useCreditReports();
  const captures = useCreditReportCaptures();
  const jobs = useReportJobs();
  const [acquisitionOpen, setAcquisitionOpen] = useState(!reports.length);
  const [range, setRange] = useState(defaultReportRange);
  const [preset, setPreset] = useState("30");
  const [selection, setSelection] = useState<"both" | ReportName>("both");
  const [active, setActive] = useState<ReportName>(() =>
    reports.find((report) => report.name === "BillingDetailsPerEnvironment")?.name ?? reports[0]?.name ?? "BillingDetailsPerEnvironment");
  const [analysisMode, setAnalysisMode] = useState<"capture" | "holistic">("capture");
  const [captureId, setCaptureId] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const [exporting, setExporting] = useState(false);
  const [review, setReview] = useState<{ names: ReportName[]; range: ReportRange }>();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resumeName, setResumeName] = useState<ReportName>("BillingDetailsPerEnvironment");
  const [knownOperation, setKnownOperation] = useState("");
  const [knownFile, setKnownFile] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const upload = useRef<HTMLInputElement>(null);
  const captureChoices = useMemo(() =>
    orderCreditReportCaptures(captures.filter((capture) => capture.name === active)).reverse(), [captures, active]);
  const selectedCapture = captureChoices.find((capture) => capture.id === captureId) ?? captureChoices[0];
  const scopes = useMemo(() => creditReportScopes(captures, active), [captures, active]);
  const selectedScope = scopes.find((scope) => scope.key === scopeKey) ?? scopes[0];
  const reconciled = useMemo(() => analysisMode === "holistic" && selectedScope
    ? reconcileCreditReports(captures, active, selectedScope.key) : undefined, [captures, active, analysisMode, selectedScope]);
  const current = analysisMode === "holistic" ? reconciled : selectedCapture;
  const requestedNames = selection === "both" ? REPORT_NAMES : [selection];
  const cachedRequests = requestedNames.flatMap((name) => {
    const cached = findCoveringCreditReport(captures, name, range);
    return cached ? [cached] : [];
  });

  function showCapture(report: CreditReport) {
    setActive(report.name); setCaptureId(report.id); setAnalysisMode("capture");
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort(new Error("Report acquisition stopped when leaving this view. The server job was not cancelled."));
    };
  }, []);

  function startWork() {
    if (controller.current) return null;
    const next = new AbortController();
    controller.current = next;
    setBusy(true); setError(""); setNotice("");
    return next;
  }
  function finishWork(next: AbortController) {
    if (controller.current !== next) return;
    controller.current = null;
    if (mounted.current) {
      setBusy(false);
      if (next.signal.aborted) setNotice("Stopped locally. Server report generation is not cancelled; resume the existing operation.");
    }
  }

  async function acquire(names: ReportName[], requestRange: ReportRange, resume?: ReportJob) {
    const next = startWork();
    if (!next) return;
    try {
      for (const [index, name] of names.entries()) {
        const result = await acquireCreditReport({
          name, range: requestRange, signal: next.signal, onJob: saveReportJob, resume,
        });
        if (!result.ok) {
          if (result.job) saveReportJob(result.job, result.error, result.diagnostic);
          if (!next.signal.aborted) setError(`${result.error}${index < names.length - 1 ? " The remaining report was not requested." : ""}`);
          break;
        }
        if (next.signal.aborted) break;
        retainCreditReport(result.data);
        if (index === 0) showCapture(result.data);
        setAcquisitionOpen(false);
        setNotice("Capture retained. View it on its own or select Holistic to reconcile reported days without counting overlapping captures twice.");
      }
    } finally { finishWork(next); }
  }

  async function importFile(file: File) {
    const next = startWork();
    if (!next) return;
    try {
      const report = await readCreditReport(file, file.name, { source: "upload" });
      if (next.signal.aborted) return;
      retainCreditReport(report); showCapture(report);
      setAcquisitionOpen(false);
      setNotice("Capture imported and retained. Holistic analysis only combines captures with the same reported tenant; unknown or mixed tenant captures stay separate.");
    } catch (reason) {
      if (!next.signal.aborted) setError(formatApiError(reason));
    } finally { finishWork(next); }
  }

  async function exportCollection() {
    setExporting(true); setError("");
    try {
      const archive = await exportCreditReportArchive(captures);
      if (mounted.current) downloadFile(archive, `power-platform-credit-captures-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (reason) {
      if (mounted.current) setError(formatApiError(reason));
    } finally { if (mounted.current) setExporting(false); }
  }

  return <div className={styles.root}>
    <section className={styles.panel} aria-labelledby="pp-credits-title">
      <div className={styles.spread}>
        <Text as="h2" id="pp-credits-title" size={500} weight="semibold">Power Platform credit usage</Text>
        <Badge appearance="outline">Admins V2 + Power Automate</Badge>
      </div>
      <Text className={styles.coverage}>Explore daily Copilot Credit usage by resource, feature and environment. These Power Platform reports are separate from MAC/Graph reporting and are never added to it. Credits are not currency spend.</Text>
      <details open={acquisitionOpen} onToggle={(event) => setAcquisitionOpen(event.currentTarget.open)}>
      <summary>Request or upload Daily reports</summary>
      <div className={styles.form}>
      <form className={styles.form} onSubmit={(event) => {
        event.preventDefault();
        try {
          validateReportRange(range);
          setError(""); setConfirmation("");
          setReview({ names: selection === "both" ? [...REPORT_NAMES] : [selection], range: { ...range } });
        } catch (reason) { setError(formatApiError(reason)); }
      }}>
        <div className={styles.fields}>
          <Field label="Reports"><Select disabled={busy} value={selection} onChange={(_, data) => {
            if (data.value === "both" || REPORT_NAMES.some((name) => name === data.value)) setSelection(data.value as typeof selection);
          }}>
            <option value="both">Both Daily reports</option>
            {REPORT_NAMES.map((name) => <option key={name} value={name}>{REPORT_SCHEMAS[name].label}</option>)}
          </Select></Field>
          <Field label="Request date preset"><Select disabled={busy} value={preset} onChange={(_, data) => {
            setPreset(data.value);
            const selected = REQUEST_PRESETS.find((entry) => entry.value === data.value);
            if (selected) setRange(reportRangePreset(selected.days));
          }}>
            {REQUEST_PRESETS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            <option value="custom">Custom dates</option>
          </Select></Field>
          <Field label="UTC start date"><Input required disabled={busy} type="date" value={range.startDate}
            onChange={(_, data) => { setPreset("custom"); setRange({ ...range, startDate: data.value }); }} /></Field>
          <Field label="UTC end date"><Input required disabled={busy} type="date" value={range.endDate}
            onChange={(_, data) => { setPreset("custom"); setRange({ ...range, endDate: data.value }); }} /></Field>
        </div>
        <Text size={200} className={styles.muted}>Daily only. New requests must use the last 30 complete UTC days; dates are inclusive. Generation can take several minutes. Both reports run sequentially and stop on a failure.</Text>
        {cachedRequests.length > 0 && <div className={styles.list} role="status">
          <Text className={styles.warning}>A retained download was requested for these dates. Reports can lag by about a day; this is not a guarantee of the latest service data. View the loaded capture or review a fresh request anyway.</Text>
          {cachedRequests.map((capture) => <div key={capture.id} className={styles.row}>
            <Text size={200}>{REPORT_SCHEMAS[capture.name].label} / loaded {capture.loadedAt}</Text>
            <Button disabled={busy} onClick={() => { showCapture(capture); setAcquisitionOpen(false); }}>View loaded {REPORT_SCHEMAS[capture.name].label.toLowerCase()}</Button>
          </div>)}
        </div>}
        <div className={styles.row}>
          <Button appearance="primary" type="submit" disabled={busy}>Review report request</Button>
          <Button disabled={busy} icon={<ArrowUploadRegular />} onClick={() => upload.current?.click()}>Upload report</Button>
          <input ref={upload} className={styles.fileInput} type="file" accept=".csv,.gz,text/csv,application/gzip"
            aria-label="Upload Daily credit report" disabled={busy} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importFile(file);
            }} />
          {busy && <Button onClick={() => {
            controller.current?.abort(new Error("Stopped locally. Server report generation is not cancelled; resume the existing operation."));
            // Keep the lock until the pending task observes cancellation.
            setNotice("Stopping locally. Server report generation is not cancelled.");
          }}>Stop waiting</Button>}
        </div>
      </form>
      <Text size={200} className={styles.muted}>Upload CSV or gzip-compressed CSV, including historical files. Limit: 25 MiB compressed and expanded, 200,000 rows. Files and parsed data stay in this app session's memory, survive navigation, and are lost on reload. Nothing is stored in Dataverse or browser storage.</Text>
      </div>
      </details>
      {busy && <LoadingPane label="Acquiring Daily credit reports. You can stop waiting without cancelling the server job." />}
      {busy && !acquisitionOpen && <Button className={styles.resumeButton} onClick={() =>
        controller.current?.abort(new Error("Stopped locally. Server report generation is not cancelled; resume the existing operation."))}>Stop waiting</Button>}
      {error && <ErrorPane title="Credit report action failed" message={`${error} Any previously loaded report remains available below.`} />}
      {notice && <Text role="status">{notice}</Text>}
    </section>

    {jobs.length > 0 && <section className={styles.panel} aria-label="Report acquisition status">
      <Text as="h2" size={400} weight="semibold">Report requests</Text>
      {jobs.map(({ job, error: jobError, diagnostic }) => <div key={job.name} className={styles.list}>
        <div className={styles.spread}>
          <Text weight="semibold">{REPORT_SCHEMAS[job.name].label} / {job.range.startDate} through {job.range.endDate} UTC</Text>
          <Badge appearance="tint">{jobError ? "Stopped" : job.phase}</Badge>
        </div>
        {job.operationId && <Text size={200}>Operation ID: {job.operationId}</Text>}
        {job.nextPollAt && !jobError && job.phase !== "ready" && <Text role="status">Next status check no earlier than {new Date(job.nextPollAt).toISOString()}.</Text>}
        {jobError && <Text className={styles.warning}>{jobError}</Text>}
        {!busy && job.phase !== "ready" && job.phase !== "failed" && (job.operationId || job.fileName) &&
          <Button className={styles.resumeButton} onClick={() => void acquire([job.name], job.range, job)}>Resume existing report</Button>}
        {diagnostic !== undefined && <Diagnostics label={`Inspect ${REPORT_SCHEMAS[job.name].label} response`} data={diagnostic} />}
      </div>)}
    </section>}

    <details className={styles.panel}>
      <summary>Resume a known report operation or download a generated file</summary>
      <Text>Use the exact report type and original dates above. Enter an operation ID to poll it, or a file name to download a completed Daily report. This never generates a new report and may use dates older than the current reporting window.</Text>
      <div className={styles.fields}>
        <Field label="Existing report type"><Select disabled={busy} value={resumeName}
          onChange={(_, data) => { if (REPORT_NAMES.some((name) => name === data.value)) setResumeName(data.value as ReportName); }}>
          {REPORT_NAMES.map((name) => <option key={name} value={name}>{REPORT_SCHEMAS[name].label}</option>)}
        </Select></Field>
        <Field label="Operation ID"><Input disabled={busy} value={knownOperation} onChange={(_, data) => setKnownOperation(data.value)} /></Field>
        <Field label="Generated file name" hint="Use only after generation succeeds; do not enter a URL."><Input disabled={busy} value={knownFile} onChange={(_, data) => setKnownFile(data.value)} /></Field>
      </div>
      <Button disabled={busy || (!knownOperation.trim() && !knownFile.trim()) || Boolean(knownOperation.trim() && knownFile.trim())}
        onClick={() => void acquire([resumeName], { ...range }, {
          name: resumeName, range: { ...range }, phase: knownFile.trim() ? "downloading" : "polling",
          operationId: knownOperation.trim() || undefined, fileName: knownFile.trim() || undefined,
        })}>Resume without generating</Button>
    </details>

    <section className={styles.panel} aria-label="Loaded Power Platform reports">
      <div className={styles.spread}>
        <TabList aria-label="Power Platform report datasets" className={styles.tabs} selectedValue={active}
          onTabSelect={(_, data) => { if (REPORT_NAMES.some((name) => name === data.value)) setActive(data.value as ReportName); }}>
          {REPORT_NAMES.map((name) => <Tab key={name} value={name}>{REPORT_SCHEMAS[name].label}{reports.some((report) => report.name === name) ? " (loaded)" : ""}</Tab>)}
        </TabList>
        {captures.length > 0 && <Button disabled={exporting} icon={<ArrowDownloadRegular />}
          onClick={() => void exportCollection()}>{exporting ? "Preparing ZIP..." : "Export all captures (ZIP)"}</Button>}
      </div>
      {captures.length > 0 && <Text size={200} className={styles.muted}>
        {captures.length} retained captures / {(captures.reduce((sum, capture) => sum + capture.original.size, 0) / 1024 / 1024).toFixed(2)} MiB of originals.
        ZIP includes every retained original, separate reconciled CSVs, and a provenance manifest, regardless of analysis filters. Reloading loses this session-only collection.
      </Text>}
      {captureChoices.length > 0 && <>
        <div className={styles.fields}>
          <Field label="Analysis mode"><Select value={analysisMode} onChange={(_, data) => {
            if (data.value === "capture" || data.value === "holistic") setAnalysisMode(data.value);
          }}>
            <option value="capture">Individual capture</option><option value="holistic">Holistic / reconciled captures</option>
          </Select></Field>
          {analysisMode === "capture" ? <Field className={styles.reportPicker} label="Report capture"><Select className={styles.reportPicker} value={selectedCapture.id}
            onChange={(_, data) => setCaptureId(data.value)}>
            {captureChoices.map((capture, index) => <option key={capture.id} value={capture.id}>
              {captureChoices.length - index}. {capture.loadedAt} / {capture.source} / {capture.fileName}
            </option>)}
          </Select></Field> : <Field className={styles.reportPicker} label="Reported tenant scope"><Select className={styles.reportPicker} value={selectedScope.key}
            onChange={(_, data) => setScopeKey(data.value)}>
            {scopes.map((scope) => <option key={scope.key} value={scope.key}>{scope.label}</option>)}
          </Select></Field>}
        </div>
        {analysisMode === "holistic" && <div className={styles.list}>
          <Text>Each reported UTC day comes entirely from its newest loaded capture in this report type and tenant scope. Overlapping captures are not added together; dates absent from a newer capture keep their older rows.</Text>
          <Text size={200} className={styles.muted}>
            {reconciled ? Object.keys(reconciled.daySources).length : 0} reported days; gaps are unknown, not zero.
            Import time does not prove newer service data. Tenant IDs are file claims, not verified identities. Unknown or mixed tenant files stay separate.
          </Text>
        </div>}
        <div className={styles.row}>
          {analysisMode === "capture" && <Button icon={<ArrowDownloadRegular />} onClick={() => {
            try { downloadFile(selectedCapture.original, selectedCapture.fileName); } catch (reason) { setError(formatApiError(reason)); }
          }}>Download original file</Button>}
          {analysisMode === "capture" && <Button disabled={busy || exporting}
            onClick={() => removeCreditReportCapture(selectedCapture.id)}>Remove selected capture</Button>}
          <Button disabled={busy || exporting} onClick={() => clearCreditReports(active)}>Clear all captures for this report type</Button>
        </div>
      </>}
      {current ? <CreditReportAnalysis key={current.id} report={current} /> : <div className={styles.emptyReport}>
        <Text as="h3" size={500} weight="semibold">Start with a report, not an estimate</Text>
        <Text>Request the last 30 complete days or upload a Daily report you already have. {active === "FeatureDetailsPerResource"
          ? "Resources & features reveals which agents and other resources consume credits, and where."
          : "Environment billing separates capacity-pack and pay-as-you-go consumption."}</Text>
        <Text className={styles.muted}>This report is not loaded. Missing data is not zero usage.</Text>
      </div>}
    </section>
    <Dialog open={Boolean(review)} onOpenChange={(_, data) => { if (!data.open) setReview(undefined); }}>
      <DialogSurface><DialogBody>
        <DialogTitle>Generate Daily credit reports</DialogTitle>
        <DialogContent className={styles.form}>
          <Text>This submits {review?.names.length} report-generation request(s) through PP-Request-Credit-Licensing-Report. The Admins V2 connector checks status every 30 seconds, or later if the service requests it. PP-Download-Credit-Licensing-Report returns the completed CSV. It does not change billing policies or allocations. Stopping locally does not cancel server jobs. Successful files are retained alongside earlier captures.</Text>
          {cachedRequests.length > 0 && <Text className={styles.warning}>A download requested for this period is already retained. Continuing requests fresh reports anyway; it does not prove the service has newer data.</Text>}
          <pre className={styles.code}>{JSON.stringify({ reports: review?.names, ...review?.range, granularity: "Daily" }, null, 2)}</pre>
          <Field label="Type GenerateLicensingReport to confirm"><Input value={confirmation}
            onChange={(_, data) => setConfirmation(data.value)} /></Field>
        </DialogContent>
        <DialogActions><Button onClick={() => setReview(undefined)}>Cancel</Button>
          <Button appearance="primary" disabled={confirmation !== "GenerateLicensingReport"} onClick={() => {
            if (!review) return;
            const snapshot = review; setReview(undefined);
            void acquire(snapshot.names, snapshot.range);
          }}>Generate reports</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </div>;
}
