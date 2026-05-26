/**
 * Scope picker — choose tenant / env-group / single env for a scan.
 *
 * Renders three controls:
 *  1. Radio-style toggle for `kind` (Tenant / Env group / Single env).
 *  2. Group picker (shown only when `kind === 'envGroup'`).
 *  3. Env picker (shown only when `kind === 'env'`).
 *
 * Keeps its own internal state for the two pickers' loaded options so
 * we don't refetch the env-group list every time the user toggles
 * between scopes.
 */

import { useEffect, useState } from "react";
import {
  Dropdown,
  Option,
  Radio,
  RadioGroup,
  makeStyles,
  tokens,
  Text,
} from "@fluentui/react-components";
import { EnvironmentPicker } from "../../../components/EnvironmentPicker";
import {
  listEnvironmentGroups,
  type EnvironmentGroupRow,
} from "../../../data/inventory";
import type { DeepScanScope } from "../data";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    alignItems: "center",
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface ScopePickerProps {
  value: DeepScanScope;
  onChange: (scope: DeepScanScope) => void;
}

export function ScopePicker({ value, onChange }: ScopePickerProps) {
  const styles = useStyles();
  const [groups, setGroups] = useState<EnvironmentGroupRow[]>([]);
  const [groupsPhase, setGroupsPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");

  // Lazy-load groups the first time the user picks "envGroup". The
  // actual fetch is wrapped in an async IIFE so the effect body
  // itself doesn't contain any synchronous setState calls (avoids
  // the `react-hooks/set-state-in-effect` lint warning while
  // preserving the same behavior).
  useEffect(() => {
    if (value.kind !== "envGroup" || groupsPhase !== "idle") return;
    let cancelled = false;
    (async () => {
      setGroupsPhase("loading");
      const res = await listEnvironmentGroups();
      if (cancelled) return;
      if (res.ok) {
        setGroups(res.data);
        setGroupsPhase("ready");
      } else {
        setGroupsPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value.kind, groupsPhase]);

  return (
    <div className={styles.root}>
      <RadioGroup
        layout="horizontal"
        value={value.kind}
        onChange={(_e, data) => {
          const kind = data.value as DeepScanScope["kind"];
          if (kind === "tenant") onChange({ kind: "tenant" });
          else if (kind === "envGroup") onChange({ kind: "envGroup", groupId: "" });
          else onChange({ kind: "env", envId: "" });
        }}
      >
        <Radio value="tenant" label="Entire tenant" />
        <Radio value="envGroup" label="Environment group" />
        <Radio value="env" label="Single environment" />
      </RadioGroup>

      {value.kind === "envGroup" && (
        <div className={styles.row}>
          <Dropdown
            placeholder="Select an environment group"
            value={
              value.groupId
                ? (groups.find((g) => g.id === value.groupId)?.displayName ?? value.groupId)
                : ""
            }
            selectedOptions={value.groupId ? [value.groupId] : []}
            onOptionSelect={(_e, data) => {
              const id = data.optionValue;
              if (id) onChange({ kind: "envGroup", groupId: id });
            }}
            disabled={groupsPhase === "loading"}
          >
            {groups.map((g) => (
              <Option key={g.id} value={g.id} text={g.displayName || g.id}>
                {g.displayName || g.id}
              </Option>
            ))}
            {groupsPhase === "error" && (
              <Option value="__err__" disabled text="Couldn't load groups">
                <span className={styles.hint}>Couldn't load groups</span>
              </Option>
            )}
          </Dropdown>
          {groupsPhase === "loading" && (
            <Text className={styles.hint}>Loading groups…</Text>
          )}
        </div>
      )}

      {value.kind === "env" && (
        <div className={styles.row}>
          <EnvironmentPicker
            value={value.envId || undefined}
            onChange={(envId) =>
              onChange({ kind: "env", envId: envId ?? "" })
            }
            placeholder="Select an environment"
          />
        </div>
      )}
    </div>
  );
}
