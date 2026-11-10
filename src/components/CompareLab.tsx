import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useApi } from '../lib/api';
import { useStored } from '../lib/store';
import { useTheme } from '../lib/theme';
import { fmtDate, fmtNum, isNum } from '../lib/format';
import EChart, { chrome } from './EChart';
import { Card, ErrorNote, Loading, Seg } from './ui';

interface CatalogItem {
  id: string;
  name: string;
  short: string;
  unit: 'index' | 'percent' | 'ratio' | 'usd' | 'score';
  group: string;
  source: string;
  note?: string;
}

interface Series {
  id: string;
  name: string;
  short: string;
  unit: CatalogItem['unit'];
  source: string;
  note?: string;
  data: [string, number][];
  error?: string;
}

type Span = '1y' | '3y' | '5y' | '10y' | '20y' | 'max';
type Mode = 'panels' | 'indexed' | 'zscore';

const PRESETS: { label: string; ids: string[] }[] = [
  { label: 'S&P 500 vs Fear & Greed', ids: ['spx', 'fg'] },
  { label: 'S&P 500 vs Buffett Indicator', ids: ['spx', 'buffett'] },
  { label: 'S&P 500 vs VIX', ids: ['spx', 'vix'] },
  { label: 'S&P 500 vs 10-Year yield', ids: ['spx', 't10y'] },
  { label: 'S&P 500 vs yield curve', ids: ['spx', 'curve'] },
  { label: 'Fear & Greed vs Buffett', ids: ['fg', 'buffett'] },
  { label: 'US vs world', ids: ['spx', 'eafe', 'em'] },
];

function startFor(span: Span): string {
  if (span === 'max') return '';
  const years = { '1y': 1, '3y': 3, '5y': 5, '10y': 10, '20y': 20 }[span];
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

const unitFmt = (unit: Series['unit']) => (v: number) => (unit === 'percent' ? `${v.toFixed(2)}%` : unit === 'usd' ? `$${fmtNum(v, 2)}` : unit === 'score' ? v.toFixed(0) : fmtNum(v, 2));

/** Correlation of period-to-period changes on the dates both series share. */
function correlation(a: [string, number][], b: [string, number][]): number | null {
  const m = new Map(b);
  const xs: number[] = [];
  const ys: number[] = [];
  let px: number | null = null;
  let py: number | null = null;
  for (const [d, x] of a) {
    const y = m.get(d);
    if (y == null) continue;
    if (px != null && py != null) {
      xs.push(x - px);
      ys.push(y - py);
    }
    px = x;
    py = y;
  }
  if (xs.length < 20) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export default function CompareLab() {
  const { tokens } = useTheme();
  const [ids, setIds] = useStored<string[]>('lab.ids', ['spx', 'fg']);
  const [span, setSpan] = useStored<Span>('lab.span', '5y');
  const [mode, setMode] = useStored<Mode>('lab.mode', 'panels');
  const [log, setLog] = useStored<boolean>('lab.log', false);
  const [showTable, setShowTable] = useState(false);
  const [ticker, setTicker] = useState('');
  const catalog = useApi<CatalogItem[]>('/api/market/series/catalog');
  const from = startFor(span);
  const { data, error, loading, stale, reload } = useApi<{ series: Series[] }>(ids.length ? `/api/market/series?ids=${encodeURIComponent(ids.join(','))}${from ? `&from=${from}` : ''}&max=2600` : null);

  // Colour follows the series, not its position: each id keeps the slot it was first given.
  const [slots, setSlots] = useStored<Record<string, number>>('lab.slots', {});
  const slotOf = (id: string): number => {
    if (slots[id] != null) return slots[id];
    const used = new Set(ids.filter((x) => x !== id).map((x) => slots[x]).filter((x) => x != null));
    let s = 0;
    while (used.has(s)) s++;
    return s % 8;
  };
  const colorOf = (id: string) => tokens.series[slotOf(id)];
  const remember = (next: string[]) => {
    const map: Record<string, number> = {};
    const used = new Set<number>();
    for (const id of next) {
      if (slots[id] != null && !used.has(slots[id])) {
        map[id] = slots[id];
        used.add(slots[id]);
      }
    }
    for (const id of next) {
      if (map[id] == null) {
        let s = 0;
        while (used.has(s)) s++;
        map[id] = s % 8;
        used.add(map[id]);
      }
    }
    setSlots(map);
    setIds(next);
  };
  const add = (id: string) => {
    if (!id || ids.includes(id) || ids.length >= 6) return;
    remember([...ids, id]);
  };

  const series = (data?.series ?? []).filter((s) => ids.includes(s.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const usable = series.filter((s) => s.data.length > 1);
  const primary = usable[0];

  const overlay = useMemo<EChartsOption | null>(() => {
    if (mode === 'panels' || !usable.length) return null;
    const base = chrome(tokens);
    const lines = usable
      .map((s) => {
        let pts: [string, number][];
        if (mode === 'indexed') {
          const first = s.data.find((p) => p[1] > 0);
          if (!first || s.data.some((p) => p[1] <= 0)) return null;
          pts = s.data.map((p) => [p[0], (p[1] / first[1]) * 100]);
        } else {
          const vals = s.data.map((p) => p[1]);
          const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
          const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1)) || 1;
          pts = s.data.map((p) => [p[0], (p[1] - mean) / sd]);
        }
        return { name: s.short, type: 'line' as const, data: pts, showSymbol: false, lineStyle: { width: 2, color: colorOf(s.id) }, itemStyle: { color: colorOf(s.id) }, sampling: 'lttb' as const, endLabel: { show: usable.length <= 4, formatter: '{a}', color: tokens.text2, fontSize: 11 } };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    return {
      ...base,
      grid: { left: 48, right: usable.length <= 4 ? 92 : 16, top: 34, bottom: 56 },
      legend: { ...base.legendBase },
      tooltip: { ...base.tooltip, valueFormatter: (v) => (isNum(v) ? (mode === 'indexed' ? (v as number).toFixed(1) : `${(v as number) >= 0 ? '+' : ''}${(v as number).toFixed(2)} sd`) : '–') },
      xAxis: { ...base.xAxis, type: 'time' },
      yAxis: { ...base.yAxis, type: mode === 'indexed' && log ? 'log' : 'value', scale: true, axisLabel: { ...base.yAxis.axisLabel, formatter: mode === 'zscore' ? '{value} sd' : '{value}' } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8, borderColor: tokens.grid, textStyle: { color: tokens.muted, fontSize: 10 }, fillerColor: 'rgba(120,120,120,0.15)', dataBackground: { lineStyle: { color: tokens.axis }, areaStyle: { color: tokens.grid } } }],
      series: lines,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, usable, tokens, log, slots]);

  const excluded = mode === 'indexed' ? usable.filter((s) => s.data.some((p) => p[1] <= 0)) : [];

  const panelOption = (s: Series, last: boolean): EChartsOption => {
    const base = chrome(tokens);
    const f = unitFmt(s.unit);
    const canLog = log && s.data.every((p) => p[1] > 0) && (s.unit === 'index' || s.unit === 'usd');
    return {
      ...base,
      grid: { left: 58, right: 16, top: 8, bottom: last ? 52 : 22 },
      tooltip: { ...base.tooltip, formatter: (p: any) => `<b>${f(p[0].value[1])}</b> ${s.short}<br/><span style="color:${tokens.muted}">${fmtDate(p[0].value[0])}</span>` },
      xAxis: { ...base.xAxis, type: 'time', axisLabel: { ...base.xAxis.axisLabel, show: true } },
      yAxis: { ...base.yAxis, type: canLog ? 'log' : 'value', scale: true, splitNumber: 3, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => (s.unit === 'percent' ? `${v}%` : v >= 10000 ? `${(v / 1000).toFixed(0)}K` : String(v)) } },
      dataZoom: [{ type: 'inside' }, ...(last ? [{ type: 'slider' as const, height: 18, bottom: 8, borderColor: tokens.grid, textStyle: { color: tokens.muted, fontSize: 10 }, fillerColor: 'rgba(120,120,120,0.15)', dataBackground: { lineStyle: { color: tokens.axis }, areaStyle: { color: tokens.grid } } }] : [])],
      series: [{ type: 'line', name: s.short, data: s.data, showSymbol: false, lineStyle: { width: 2, color: colorOf(s.id) }, itemStyle: { color: colorOf(s.id) }, areaStyle: s.unit === 'score' ? undefined : { color: colorOf(s.id), opacity: 0.08 }, sampling: 'lttb' }],
    };
  };

  const table = useMemo(() => {
    if (!showTable || !usable.length) return null;
    const dates = usable[0].data.map((p) => p[0]).slice(-120).reverse();
    const maps = usable.map((s) => new Map(s.data));
    return { dates, maps };
  }, [showTable, usable]);

  const groups = useMemo(() => {
    const g = new Map<string, CatalogItem[]>();
    for (const c of catalog.data ?? []) g.set(c.group, [...(g.get(c.group) ?? []), c]);
    return [...g.entries()];
  }, [catalog.data]);
  const nameOf = (id: string) => catalog.data?.find((c) => c.id === id)?.short ?? id.replace(/^sym:/, '');

  return (
    <Card pad={false}>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <div className="row">
          <span className="small dim">Quick picks</span>
          {PRESETS.map((p) => (
            <button key={p.label} className="btn small" onClick={() => remember(p.ids)} aria-pressed={p.ids.join() === ids.join()}>{p.label}</button>
          ))}
        </div>
        <div className="row">
          {ids.map((id) => (
            <span key={id} className="chip">
              <i className="linekey" style={{ background: colorOf(id) }} />
              {nameOf(id)}
              <button aria-label={`Remove ${nameOf(id)}`} onClick={() => remember(ids.filter((x) => x !== id))}>×</button>
            </span>
          ))}
          <select className="select" value="" onChange={(e) => add(e.target.value)} aria-label="Add a series" disabled={ids.length >= 6}>
            <option value="">Add a series…</option>
            {groups.map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map((c) => <option key={c.id} value={c.id} disabled={ids.includes(c.id)}>{c.name}</option>)}
              </optgroup>
            ))}
          </select>
          <form className="row" style={{ gap: 4 }} onSubmit={(e) => { e.preventDefault(); const t = ticker.trim().toUpperCase(); if (t) add(`sym:${t}`); setTicker(''); }}>
            <input className="input" style={{ width: 120 }} placeholder="or a ticker" aria-label="Add any ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} />
            <button className="btn small" type="submit" disabled={!ticker.trim() || ids.length >= 6}>Add</button>
          </form>
        </div>
        <div className="row">
          <Seg value={span} options={(['1y', '3y', '5y', '10y', '20y', 'max'] as Span[]).map((v) => ({ v, label: v.toUpperCase() }))} onChange={setSpan} label="Time range" />
          <Seg value={mode} options={[{ v: 'panels', label: 'Stacked panels' }, { v: 'indexed', label: 'Indexed to 100' }, { v: 'zscore', label: 'Standardized' }]} onChange={setMode} label="How to compare" />
          <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} /> Log scale</label>
          <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={showTable} onChange={(e) => setShowTable(e.target.checked)} /> Show data table</label>
        </div>
        <p className="note">
          {mode === 'panels' && 'Each series keeps its own scale in its own panel; the time axis and crosshair are shared, so turning points line up without forcing two scales onto one chart.'}
          {mode === 'indexed' && 'Every series is rebased to 100 at the start of the range, so the lines show relative change on one honest axis.'}
          {mode === 'zscore' && 'Every series is expressed as standard deviations from its own average over the range — useful when units differ (index points vs percent).'}
        </p>
      </div>
      {error && !data && <div className="card-pad"><ErrorNote message={error} onRetry={reload} /></div>}
      {loading && !data && <Loading text="Loading series…" />}
      {data && (
        <div className={`card-pad ${stale ? 'stale' : ''}`} style={{ paddingTop: 0 }}>
          {series.filter((s) => s.data.length <= 1).map((s) => <div key={s.id} className="banner warn" style={{ marginBottom: 8 }}>No data for {nameOf(s.id)}{s.error ? `: ${s.error}` : ''}.</div>)}
          {excluded.length > 0 && <div className="banner" style={{ marginBottom: 8 }}>{excluded.map((s) => s.short).join(', ')} can be zero or negative, so {excluded.length > 1 ? 'they are' : 'it is'} left out of the indexed view. Use Stacked panels or Standardized instead.</div>}
          {mode !== 'panels' && overlay && <EChart option={overlay} height={380} ariaLabel="Comparison chart" />}
          {mode === 'panels' && usable.map((s, i) => {
            const lastPt = s.data[s.data.length - 1];
            const corr = primary && s.id !== primary.id ? correlation(primary.data, s.data) : null;
            return (
              <div key={s.id} style={{ marginBottom: 4 }}>
                <div className="row between" style={{ margin: '6px 0 2px' }}>
                  <span className="row" style={{ gap: 8 }}>
                    <i className="linekey" style={{ background: colorOf(s.id) }} />
                    <b>{s.name}</b>
                    <span className="num">{unitFmt(s.unit)(lastPt[1])}</span>
                    <span className="muted small">{fmtDate(lastPt[0])}</span>
                  </span>
                  <span className="small dim">
                    {corr != null && <>Correlation of changes with {primary.short}: <b className="num">{corr >= 0 ? '+' : ''}{corr.toFixed(2)}</b> · </>}
                    {s.source}{s.note ? ` · ${s.note}` : ''}
                  </span>
                </div>
                <EChart option={panelOption(s, i === usable.length - 1)} height={i === usable.length - 1 ? 210 : 180} group="compare-lab" ariaLabel={`${s.name} history`} />
              </div>
            );
          })}
          {table && (
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', marginTop: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="data compact">
                <thead><tr><th className="left">Date</th>{usable.map((s) => <th key={s.id}>{s.short}</th>)}</tr></thead>
                <tbody>
                  {table.dates.map((d) => (
                    <tr key={d}><td className="left">{fmtDate(d)}</td>{usable.map((s, i) => { const v = table.maps[i].get(d); return <td key={s.id}>{v == null ? '–' : unitFmt(s.unit)(v)}</td>; })}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
