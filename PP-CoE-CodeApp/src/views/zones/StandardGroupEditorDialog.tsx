/**
 * Create / edit dialog for a Standard custom group — name, description,
 * color, icon. Structurally parallel to `ZoneEditorDialog`; the two
 * stay separate (rather than sharing one generic dialog) because we
 * expect them to diverge once Standard custom groups grow features
 * like env-membership editing.
 */

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Label,
  Textarea,
  makeStyles,
  tokens,
  type InputOnChangeData,
} from "@fluentui/react-components";
import type { StandardCustomGroup } from "../../data/standardGroups";

// Slightly different palette from ZoneEditorDialog so custom groups
// can have visually distinct accent colors from their parent zones.
const COLOR_PALETTE = [
  "#0078d4",
  "#107c10",
  "#ca5010",
  "#a4262c",
  "#5c2d91",
  "#038387",
  "#ffaa44",
  "#498205",
  "#8378de",
  "#525252",
];

const ICON_PRESETS = ["📦", "🧰", "🗂️", "🛠️", "🧪", "💡", "📁", "🎯", "🔧", "📐"];

interface Props {
  open: boolean;
  group: StandardCustomGroup | null;
  onDismiss: () => void;
  onSubmit: (
    input: { displayName: string; description: string; color: string; icon: string },
    group: StandardCustomGroup | null,
  ) => void;
}

const useStyles = makeStyles({
  surface: {
    maxWidth: "520px",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  paletteRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXS,
  },
  swatch: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    border: `2px solid transparent`,
    cursor: "pointer",
    padding: 0,
    transition: "transform 80ms ease, border-color 80ms ease",
    ":hover": {
      transform: "scale(1.1)",
    },
  },
  swatchSelected: {
    border: `2px solid ${tokens.colorNeutralForeground1}`,
  },
  iconRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  iconButton: {
    width: "32px",
    height: "32px",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    fontSize: "18px",
    lineHeight: 1,
    padding: 0,
    ":hover": {
      border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
  },
  iconButtonSelected: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
  customIconInput: {
    width: "60px",
  },
  helpText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

export function StandardGroupEditorDialog({
  open,
  group,
  onDismiss,
  onSubmit,
}: Props) {
  const styles = useStyles();
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onDismiss();
      }}
    >
      <DialogSurface className={styles.surface}>
        {open && (
          <StandardGroupEditorForm
            key={group?.id ?? "new"}
            group={group}
            onDismiss={onDismiss}
            onSubmit={onSubmit}
          />
        )}
      </DialogSurface>
    </Dialog>
  );
}

interface FormProps {
  group: StandardCustomGroup | null;
  onDismiss: () => void;
  onSubmit: Props["onSubmit"];
}

function StandardGroupEditorForm({ group, onDismiss, onSubmit }: FormProps) {
  const styles = useStyles();
  const [displayName, setDisplayName] = useState(group?.displayName ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [color, setColor] = useState(group?.color ?? COLOR_PALETTE[0]);
  const [icon, setIcon] = useState(group?.icon ?? ICON_PRESETS[0]);

  const trimmed = displayName.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(
      { displayName: trimmed, description: description.trim(), color, icon },
      group,
    );
  };

  return (
    <DialogBody>
      <DialogTitle>
        {group ? "Edit Standard custom group" : "New Standard custom group"}
      </DialogTitle>
      <DialogContent>
        <div className={styles.body}>
          <div className={styles.helpText}>
            Standard custom groups are user-managed containers for Standard
            environments. Microsoft does not allow Standard envs to live in
            real environment groups, so this is the workaround.
          </div>
          <Field label="Name" required>
            <Input
              value={displayName}
              autoFocus
              onChange={(_, d: InputOnChangeData) => setDisplayName(d.value)}
              placeholder="e.g. Sales (Dev/Test/Prod), SharePoint apps"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) submit();
              }}
            />
          </Field>
          <Field label="Description" hint="Optional">
            <Textarea
              value={description}
              onChange={(_, d) => setDescription(d.value)}
              rows={2}
            />
          </Field>
          <Field label="Color">
            <div className={styles.paletteRow} role="radiogroup">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={c === color}
                  aria-label={`Color ${c}`}
                  className={`${styles.swatch}${c === color ? ` ${styles.swatchSelected}` : ""}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </Field>
          <Field label="Icon">
            <div className={styles.iconRow}>
              {ICON_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-label={`Icon ${preset}`}
                  aria-pressed={preset === icon}
                  className={`${styles.iconButton}${preset === icon ? ` ${styles.iconButtonSelected}` : ""}`}
                  onClick={() => setIcon(preset)}
                >
                  {preset}
                </button>
              ))}
              <Label htmlFor="custom-group-icon">or</Label>
              <Input
                id="custom-group-icon"
                className={styles.customIconInput}
                value={icon}
                maxLength={4}
                onChange={(_, d: InputOnChangeData) => setIcon(d.value)}
                placeholder="🎯"
              />
            </div>
          </Field>
        </div>
      </DialogContent>
      <DialogActions>
        <Button appearance="secondary" onClick={onDismiss}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={submit} disabled={!canSubmit}>
          {group ? "Save" : "Create custom group"}
        </Button>
      </DialogActions>
    </DialogBody>
  );
}
