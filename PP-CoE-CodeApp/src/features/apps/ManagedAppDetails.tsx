import { useMemo, useState } from "react";
import {
  Card, CardHeader, Divider, Field, Input, MessageBar, MessageBarBody, Table, TableBody,
  TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens,
} from "@fluentui/react-components";
import { Meta, useDetailStyles } from "../../components/detail";
import { readRowProperty } from "../../shared/record-properties";
import { appOriginLabel } from "./data";
import { matchesPackage, propertyLabel, readManagedAppProperties } from "./managedAppProperties";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  scroll: { overflowX: "auto" },
  packages: { maxHeight: "360px", overflow: "auto" },
  cell: { overflowWrap: "anywhere", minWidth: "100px" },
});

export function ManagedAppDetails({ raw }: { raw: unknown }) {
  const detail = useDetailStyles(), styles = useStyles();
  const report = useMemo(() => readManagedAppProperties(readRowProperty(raw, "properties")), [raw]);
  const [query, setQuery] = useState("");
  const visible = report.packages.filter((entry) => matchesPackage(entry, query));
  return <>
    <Card className={detail.colFull}>
      <CardHeader header={<Text as="h2" weight="semibold">Managed app properties</Text>}
        description={<Text size={200}>Returned inventory metadata, not effective access or a security assessment.</Text>} />
      <Divider />
      <div className={detail.metaGrid}>
        <Meta label="Origin">{appOriginLabel(report.origin)}</Meta>
        <Meta label="Custom middle tier">{propertyLabel(report.customMiddleTier)}</Meta>
      </div>
      <div className={styles.scroll}>
        <Table size="small" aria-label="Managed app sharing">
          <TableHeader><TableRow>{["Access", "Users", "Groups", "Guests", "Service principals", "Entire tenant"].map((label) =>
            <TableHeaderCell key={label}>{label}</TableHeaderCell>)}</TableRow></TableHeader>
          <TableBody>{(["edit", "run"] as const).map((mode) => <TableRow key={mode}>
            <TableCell>{mode === "edit" ? "Edit" : "Run"}</TableCell>
            {[report[mode].users, report[mode].groups, report[mode].guests, report[mode].servicePrincipals, report[mode].entireTenant]
              .map((value, index) => <TableCell key={index}>{propertyLabel(value)}</TableCell>)}
          </TableRow>)}</TableBody>
        </Table>
      </div>
    </Card>
    <Card className={detail.colFull}>
      <CardHeader header={<Text as="h2" weight="semibold">Packages</Text>}
        description={<Text size={200}>{report.scope.kind === "reported" && report.scope.value === "directProduction"
          ? "Direct production dependencies, not a full transitive inventory."
          : "Package inventory as returned; dependency coverage is not assumed."}</Text>} />
      <Divider />
      <div className={styles.body}>
        <Text>{report.listKind === "reported" ? `${report.packages.length} entries returned` : "Package list not available"}
          {` · Declared count: ${propertyLabel(report.declaredCount)}`}</Text>
        {!!report.warnings.length && <MessageBar intent="warning"><MessageBarBody>{report.warnings.join(" ")}</MessageBarBody></MessageBar>}
        <Text size={200}>{report.complete ? "Reported complete for direct production dependencies."
          : "Completeness is not established; absence from this list does not prove a package is unused."}</Text>
        <Field label="Search packages" hint="Search returned package names and versions. No registry lookup.">
          <Input value={query} disabled={!report.packages.length} placeholder="Package name or version"
            onChange={(_, data) => setQuery(data.value)} />
        </Field>
        {visible.length ? <div className={styles.packages}>
          <Table size="small" aria-label="Returned packages">
            <TableHeader><TableRow><TableHeaderCell>Package</TableHeaderCell><TableHeaderCell>Version</TableHeaderCell></TableRow></TableHeader>
            <TableBody>{visible.map((entry, index) => <TableRow key={index}>
              <TableCell className={styles.cell}>{propertyLabel(entry.name)}</TableCell>
              <TableCell className={styles.cell}>{propertyLabel(entry.version)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div> : <Text>{report.listKind === "unreported" ? "Package names and versions were not reported."
          : report.listKind === "invalid" ? "Package entries cannot be read from this response."
            : report.packages.length ? "No returned packages match this search." : "The returned package list is empty."}</Text>}
        <details><summary>Package inventory coverage</summary>
          <div className={detail.metaGrid}>
            <Meta label="Returned scope">{propertyLabel(report.scope)}</Meta>
            <Meta label="Inventory version">{propertyLabel(report.inventoryVersion)}</Meta>
            <Meta label="Truncated">{propertyLabel(report.truncated)}</Meta>
            <Meta label="Unresolved packages">{propertyLabel(report.unresolved)}</Meta>
          </div>
        </details>
      </div>
    </Card>
  </>;
}
