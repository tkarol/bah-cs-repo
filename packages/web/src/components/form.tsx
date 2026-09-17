import { useState, type ReactNode } from 'react';

/** A labelled field. Every edit control on the site uses this so the spacing and
 *  help-text treatment stay identical across pages. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/**
 * Click-to-edit text. Reading is the common case, so a value renders as plain
 * text until you click it — no form to open, no save button hunting.
 */
export function InlineEdit({
  value,
  onSave,
  type = 'text',
  display,
  suffix,
  disabled,
  placeholder = 'Not set',
}: {
  value: string;
  onSave: (next: string) => Promise<unknown>;
  type?: 'text' | 'number' | 'date';
  /** How to render the value when not editing; the raw value is still edited. */
  display?: (value: string) => string;
  suffix?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  const shown = value ? (display ? display(value) : value) : '';

  if (disabled) {
    return <span className="inline-value muted">{shown || placeholder}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="inline-value editable"
        title="Click to edit"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {shown || <span className="muted">{placeholder}</span>}
        {suffix && value ? <span className="muted"> {suffix}</span> : null}
      </button>
    );
  }

  const commit = async () => {
    if (draft === value) return setEditing(false);
    setBusy(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-edit">
      <input
        autoFocus
        type={type}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => void commit()}
      />
    </span>
  );
}

/** A form that only appears once you ask for it, so pages stay readable. */
export function Disclosure({
  label,
  children,
  open: initial = false,
}: {
  label: string;
  children: ReactNode;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  if (!open) {
    return (
      <button type="button" className="disclosure-trigger" onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }
  return (
    <div className="disclosure">
      <div className="disclosure-head">
        <strong>{label}</strong>
        <button type="button" className="linklike" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {children}
    </div>
  );
}
