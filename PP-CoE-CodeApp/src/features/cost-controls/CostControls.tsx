import { Badge, Tab, TabList, Text, Title2 } from "@fluentui/react-components";
import { useLocation, useNavigate } from "react-router-dom";
import { Management } from "./Management";
import { Reporting } from "./Reporting";
import { useCostStyles } from "./styles";

export function CostControls() {
  const styles = useCostStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const management = location.pathname.endsWith("/management");
  return <div className={styles.root}>
    <header className={styles.header}>
      <div className={styles.row}><Title2 as="h1">Cost Controls</Title2><Badge color="warning">Graph beta</Badge></div>
      <Text>Understand Copilot Credit consumption, then govern who can use which services.</Text>
      <Text size={200} className={styles.muted}>Direct custom connector connection. Beta APIs are not supported for production. Credits, not currency costs.</Text>
    </header>
    <TabList aria-label="Cost Controls areas" selectedValue={management ? "management" : "reporting"}
      onTabSelect={(_, data) => navigate(`/cost-controls/${String(data.value)}`)}>
      <Tab value="reporting">Reporting</Tab><Tab value="management">Management</Tab>
    </TabList>
    {management ? <Management /> : <Reporting />}
  </div>;
}
