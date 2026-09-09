"use client";

/** A toggle, because this is a setting rather than a form field to tick. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden>
        <span className="switch-dot" />
      </span>
      <span className="switch-text">
        <strong>{label}</strong>
        {hint && <small className="muted">{hint}</small>}
      </span>
    </label>
  );
}
