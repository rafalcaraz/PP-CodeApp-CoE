import { useEffect, useState } from "react";
import {
  Dropdown,
  Option,
  makeStyles,
  tokens,
  type DropdownProps,
} from "@fluentui/react-components";
import { listEnvironmentsPage, type EnvironmentRow } from "../data/inventory";

const useStyles = makeStyles({
  root: {
    minWidth: "240px",
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface EnvironmentPickerProps {
  /** Selected environment id, or `undefined` for "All environments". */
  value: string | undefined;
  onChange: (envId: string | undefined) => void;
  placeholder?: string;
  /** Forwarded to the underlying Dropdown. */
  dropdownProps?: Partial<DropdownProps>;
}

const ALL_OPTION = "__all__";

/** Loads the first page of environments and lets the user pick one (or All).
 *  Tenants with more than ~500 envs will see the first page only; future
 *  upgrade: switch to a Combobox with server-side type-ahead. */
export function EnvironmentPicker({
  value,
  onChange,
  placeholder = "All environments",
  dropdownProps,
}: EnvironmentPickerProps) {
  const styles = useStyles();
  const [envs, setEnvs] = useState<EnvironmentRow[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listEnvironmentsPage();
      if (cancelled) return;
      if (res.ok) {
        setEnvs(res.data.rows);
        setPhase("ready");
      } else {
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedValue = value ?? ALL_OPTION;
  const selectedText =
    !value
      ? placeholder
      : envs.find((e) => e.id === value)?.displayName || value;

  return (
    <Dropdown
      className={styles.root}
      placeholder={placeholder}
      value={selectedText}
      selectedOptions={[selectedValue]}
      onOptionSelect={(_e, data) => {
        const opt = data.optionValue;
        if (!opt || opt === ALL_OPTION) onChange(undefined);
        else onChange(opt);
      }}
      disabled={phase === "loading"}
      {...dropdownProps}
    >
      <Option value={ALL_OPTION} text={placeholder}>
        {placeholder}
      </Option>
      {envs.map((env) => (
        <Option key={env.id} value={env.id} text={env.displayName || env.id}>
          {env.displayName || env.id}
        </Option>
      ))}
      {phase === "error" && (
        <Option value="__err__" disabled text="Couldn't load environments">
          <span className={styles.hint}>Couldn't load environments</span>
        </Option>
      )}
    </Dropdown>
  );
}
