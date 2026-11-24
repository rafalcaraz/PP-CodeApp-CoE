import { Badge, Tab, TabList, Text, Title2 } from "@fluentui/react-components";
import { useLocation, useNavigate } from "react-router-dom";
import { Management } from "./Management";
import { Reporting } from "./Reporting";
import { PowerPlatformCredits } from "./PowerPlatformCredits";
import { useCostStyles } from "./styles";

export function CostControls() {
  const styles = useCostStyles();
  const location = useLocation();
  const navigate = useNavigate();
  const management = location.pathname.endsWith("/management");
  const powerPlatform = location.pathname.endsWith("/power-platform");
  return <div className={styles.root}>
    <header className={styles.header}>
      <div className={styles.row}><Title2 as="h1">Cost Controls</Title2><Badge color="warning">{powerPlatform ? "Power Platform preview" : "Graph beta"}</Badge></div>
      <Text>Understand Copilot Credit consumption, then govern who can use which services.</Text>
      <Text size={200} className={styles.muted}>{powerPlatform
        ? "Power Platform API through PP-API-Wrapper-Flow. Preview reporting; no Graph calls."
        : "Direct custom connector connection. Beta APIs are not supported for production. Credits, not currency costs."}</Text>
    </header>
    <TabList aria-label="Cost Controls areas" className={styles.tabs} selectedValue={powerPlatform ? "power-platform" : management ? "management" : "reporting"}
      onTabSelect={(_, data) => navigate(`/cost-controls/${String(data.value)}`)}>
      <Tab value="reporting">Reporting</Tab><Tab value="power-platform">Power Platform credit usage</Tab><Tab value="management">Management</Tab>
    </TabList>
    {powerPlatform ? <PowerPlatformCredits /> : management ? <Management /> : <Reporting />}
  </div>;
}
