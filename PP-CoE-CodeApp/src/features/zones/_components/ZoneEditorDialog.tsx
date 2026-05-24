/**
 * Create / edit dialog for a Zone — name, description, color, icon.
 *
 * Kept opinion-light in v1 (no shape presets, no tier selection) — the
 * point is to ship the drag-and-drop layer first and see how users
 * organize before opinionating further. See `docs/roadmap.md` →
 * "Zone-based governance experiments" for the planned v2 knobs.
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
import type { Zone } from "../../../data/zones";

// Small curated palette. Picked for accessibility against both light and
// dark Fluent backgrounds without needing per-token math.
const COLOR_PALETTE = [
  "#0078d4", // blue
  "#107c10", // green
  "#ca5010", // pumpkin
  "#a4262c", // red
  "#5c2d91", // purple
  "#038387", // teal
  "#ffaa44", // amber
  "#498205", // forest
  "#8378de", // lavender
  "#525252", // graphite
];

// Tiny default icon list. Users can type any single character/emoji into
// the field — these are just the one-click presets.
const ICON_PRESETS = ["✨", "🏢", "🌎", "🏭", "🧪", "🚀", "🛡️", "💼", "🧠", "📊"];

interface Props {
  open: boolean;
  zone: Zone | null;
  onDismiss: () => void;
  onSubmit: (
    input: { name: string; description: string; color: string; icon: string },
    zone: Zone | null,
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
});

export function ZoneEditorDialog({ open, zone, onDismiss, onSubmit }: Props) {
  const styles = useStyles();
  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) onDismiss();
      }}
    >
      <DialogSurface className={styles.surface}>
        {/* Mounting the form lazily (and keying it on the zone identity)
            avoids the useEffect-driven reset pattern that the eslint rule
            `react-hooks/set-state-in-effect` flags. Every time the dialog
            opens — or the user switches between "edit zone A" and "edit
            zone B" without closing — the form re-mounts with fresh
            initial state derived from props. */}
        {open && (
          <ZoneEditorForm
            key={zone?.id ?? "new"}
            zone={zone}
            onDismiss={onDismiss}
            onSubmit={onSubmit}
          />
        )}
      </DialogSurface>
    </Dialog>
  );
}

interface ZoneEditorFormProps {
  zone: Zone | null;
  onDismiss: () => void;
  onSubmit: Props["onSubmit"];
}

function ZoneEditorForm({ zone, onDismiss, onSubmit }: ZoneEditorFormProps) {
  const styles = useStyles();
  const [name, setName] = useState(zone?.name ?? "");
  const [description, setDescription] = useState(zone?.description ?? "");
  const [color, setColor] = useState(zone?.color ?? COLOR_PALETTE[0]);
  const [icon, setIcon] = useState(zone?.icon ?? ICON_PRESETS[0]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(
      { name: trimmedName, description: description.trim(), color, icon },
      zone,
    );
  };

  return (
    <DialogBody>
      <DialogTitle>{zone ? "Edit zone" : "New zone"}</DialogTitle>
      <DialogContent>
        <div className={styles.body}>
          <Field label="Name" required>
            <Input
              value={name}
              autoFocus
              onChange={(_, d: InputOnChangeData) => setName(d.value)}
              placeholder="e.g. Finance BU, APAC, Customer-Facing Apps"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) submit();
              }}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional — short context shown under the zone title"
          >
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
              <Label htmlFor="custom-icon">or</Label>
              <Input
                id="custom-icon"
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
          {zone ? "Save" : "Create zone"}
        </Button>
      </DialogActions>
    </DialogBody>
  );
}
