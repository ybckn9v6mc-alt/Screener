import type { ReactNode } from 'react';

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" className={o.v === value ? 'on' : ''} aria-pressed={o.v === value} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden /> {text}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner warn" role="alert">
      {message} {onRetry && <button className="btn small" onClick={onRetry} style={{ marginLeft: 8 }}>Try again</button>}
    </div>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <span className="hint" title={text} aria-label={text} tabIndex={0}>
      ?
    </span>
  );
}

export function Card({ title, right, children, pad = true, sub }: { title?: ReactNode; right?: ReactNode; children: ReactNode; pad?: boolean; sub?: ReactNode }) {
  return (
    <section className="card">
      {(title || right) && (
        <div className="card-head">
          <div>
            <h3>{title}</h3>
            {sub && <div className="note">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.line === false ? 'swatch' : 'linekey'} style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
