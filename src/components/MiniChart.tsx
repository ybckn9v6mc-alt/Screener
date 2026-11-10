import { useMemo, useRef, useState } from 'react';

export interface MiniPoint {
  t: number | string;
  v: number;
}

interface Props {
  points: MiniPoint[];
  baseline?: number | null;
  height?: number;
  color: string;
  formatValue: (v: number) => string;
  formatTime: (t: number | string) => string;
  ariaLabel: string;
}

/**
 * Small line chart for a single series: 2px line, a light wash under it, a
 * hairline at the reference level, and a crosshair readout on hover or touch.
 */
export default function MiniChart({ points, baseline, height = 64, color, formatValue, formatTime, ariaLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const H = height;
  const pad = 3;

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.v);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (baseline != null && Number.isFinite(baseline)) {
      lo = Math.min(lo, baseline);
      hi = Math.max(hi, baseline);
    }
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const x = (i: number) => (i / (points.length - 1)) * W;
    const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    return { x, y, line, area: `${line}L${W},${H}L0,${H}Z`, base: baseline != null ? y(baseline) : null };
  }, [points, baseline, H]);

  if (!geo) return <div style={{ height: H }} className="muted small" aria-label={ariaLabel}>No chart data</div>;

  const onMove = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setHover(Math.round(f * (points.length - 1)));
  };
  const h = hover != null ? points[hover] : null;
  const leftPct = hover != null ? (hover / (points.length - 1)) * 100 : 0;

  return (
    <div
      ref={wrap}
      style={{ position: 'relative', height: H, touchAction: 'pan-y' }}
      onPointerMove={(e) => onMove(e.clientX)}
      onPointerDown={(e) => onMove(e.clientX)}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={ariaLabel} style={{ display: 'block' }}>
        <path d={geo.area} fill={color} opacity={0.1} />
        {geo.base != null && <line x1={0} x2={W} y1={geo.base} y2={geo.base} stroke="var(--axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        <path d={geo.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover != null && <line x1={geo.x(hover)} x2={geo.x(hover)} y1={0} y2={H} stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <>
          <span style={{ position: 'absolute', left: `${leftPct}%`, top: geo.y(h.v), width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: '0 0 0 2px var(--surface)', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }} />
          <div className="tip" style={{ top: -6, left: leftPct < 50 ? `calc(${leftPct}% + 8px)` : undefined, right: leftPct >= 50 ? `calc(${100 - leftPct}% + 8px)` : undefined }}>
            <b className="num">{formatValue(h.v)}</b> <span className="muted">{formatTime(h.t)}</span>
          </div>
        </>
      )}
    </div>
  );
}
