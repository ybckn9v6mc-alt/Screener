import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { useStored } from '../lib/store';
import { useTheme } from '../lib/theme';
import { fmtAxis, fmtCompact, fmtNum, fmtPct, isNum } from '../lib/format';
import EChart, { chrome } from '../components/EChart';
import { Card, Seg } from '../components/ui';
import type { Financials, LineItem, StatementSet } from '../../shared/financials';

const PRESETS: { id: string; label: string; keys: string[] }[] = [
  { id: 'growth', label: 'Revenue, profit & cash', keys: ['revenue', 'netIncome', 'fcf'] },
  { id: 'margins', label: 'Margins', keys: ['grossMargin', 'operMargin', 'netMargin', 'fcfMargin'] },
  { id: 'returns', label: 'Returns on capital', keys: ['roic', 'roe', 'roa'] },
  { id: 'pershare', label: 'Per share', keys: ['eps', 'fcfPerShare', 'dps'] },
  { id: 'balance', label: 'Cash, debt & equity', keys: ['cash', 'totalDebt', 'equity'] },
  { id: 'allocation', label: 'Capital allocation', keys: ['capex', 'dividendsPaid', 'buybacks', 'acquisitions'] },
  { id: 'health', label: 'Leverage', keys: ['debtEq', 'netDebtEbitda', 'currentRatio'] },
  { id: 'growthrate', label: 'Growth rates', keys: ['revenueGrowth', 'epsGrowth'] },
];

const SECTIONS: { id: LineItem['section']; label: string }[] = [
  { id: 'income', label: 'Income statement' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'balance', label: 'Balance sheet' },
  { id: 'pershare', label: 'Per share' },
  { id: 'ratios', label: 'Ratios' },
];

const UNIT_LABEL: Record<LineItem['fmt'], string> = { money: 'US dollars', pct: 'Percent', x: 'Multiple (x)', pershare: 'Dollars per share', shares: 'Shares' };

function cell(v: number | null | undefined, fmt: LineItem['fmt']): string {
  if (!isNum(v)) return '–';
  if (fmt === 'money') return fmtCompact(v, '$');
  if (fmt === 'pct') return fmtPct(v, 1);
  if (fmt === 'x') return `${fmtNum(v, 2)}x`;
  if (fmt === 'pershare') return `$${fmtNum(v, 2)}`;
  return fmtCompact(v);
}

interface Prefs {
  freq: 'annual' | 'quarterly';
  keys: string[];
  type: 'bar' | 'line';
  section: LineItem['section'] | 'all';
}

export default function FinancialsTab({ fin }: { fin: Financials }) {
  const { tokens } = useTheme();
  const [prefs, setPrefs] = useStored<Prefs>('financials.prefs', { freq: 'annual', keys: ['revenue', 'netIncome', 'fcf'], type: 'bar', section: 'all' });
  const set: StatementSet = prefs.freq === 'annual' ? fin.annual : fin.quarterly;
  const items = new Map(fin.lineItems.map((l) => [l.key, l]));
  const labels = set.periods.map((p) => p.label.replace(' FY', "\nFY"));

  // Colour follows the metric: its position in the full line-item list picks the slot.
  const colorOf = (key: string, idx: number) => tokens.series[idx % 8];

  // Metrics with different units never share an axis: one small chart per unit.
  const groups = useMemo(() => {
    const m = new Map<LineItem['fmt'], string[]>();
    for (const k of prefs.keys) {
      const it = items.get(k);
      if (!it) continue;
      m.set(it.fmt, [...(m.get(it.fmt) ?? []), k]);
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.keys, fin]);

  const optionFor = (fmt: LineItem['fmt'], keys: string[]): EChartsOption => {
    const base = chrome(tokens);
    const asBars = prefs.type === 'bar' && keys.length <= 4;
    const axisFmt = (v: number) => (fmt === 'money' || fmt === 'shares' ? fmtAxis(v, fmt === 'money' ? '$' : '') : fmt === 'pct' ? `${(v * 100).toFixed(0)}%` : fmt === 'x' ? `${v}x` : `$${v}`);
    return {
      ...base,
      grid: { left: 56, right: 14, top: keys.length > 1 ? 34 : 12, bottom: prefs.freq === 'quarterly' ? 40 : 26 },
      legend: keys.length > 1 ? { ...base.legendBase, icon: asBars ? 'rect' : 'roundRect', itemHeight: asBars ? 8 : 3, itemWidth: asBars ? 10 : 14 } : undefined,
      tooltip: { ...base.tooltip, axisPointer: { type: asBars ? 'shadow' : 'line', shadowStyle: { color: 'rgba(120,120,120,0.08)' }, lineStyle: { color: tokens.muted, width: 1, type: 'solid' } }, valueFormatter: (v) => cell(v as number, fmt) },
      xAxis: { ...base.xAxis, type: 'category', data: labels, axisLabel: { ...base.xAxis.axisLabel, interval: 0, hideOverlap: true } },
      yAxis: { ...base.yAxis, type: 'value', axisLabel: { ...base.yAxis.axisLabel, formatter: axisFmt } },
      series: keys.map((k) => {
        const idx = prefs.keys.indexOf(k);
        const color = colorOf(k, idx);
        const name = items.get(k)?.label ?? k;
        const data = set.values[k] ?? [];
        return asBars
          ? { name, type: 'bar' as const, data: data.map((v) => (isNum(v) ? { value: v, itemStyle: { borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } } : null)), barMaxWidth: 22, barGap: '12%', itemStyle: { color } }
          : { name, type: 'line' as const, data, symbolSize: 7, lineStyle: { width: 2, color }, itemStyle: { color, borderColor: tokens.surface, borderWidth: 2 }, connectNulls: true };
      }),
    };
  };

  const toggleKey = (k: string) => setPrefs({ ...prefs, keys: prefs.keys.includes(k) ? prefs.keys.filter((x) => x !== k) : [...prefs.keys, k].slice(-8) });
  const visibleSections = SECTIONS.filter((s) => prefs.section === 'all' || prefs.section === s.id);
  const showTtm = prefs.freq === 'annual' && fin.ttm != null;

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <Seg value={prefs.freq} options={[{ v: 'annual', label: 'Annual' }, { v: 'quarterly', label: 'Quarterly' }]} onChange={(v) => setPrefs({ ...prefs, freq: v })} label="Period" />
          <Seg value={prefs.type} options={[{ v: 'bar', label: 'Bars' }, { v: 'line', label: 'Lines' }]} onChange={(v) => setPrefs({ ...prefs, type: v })} label="Chart type" />
        </div>
        <span className="note">{fin.source}{fin.fiscalYearEnd ? ` · fiscal year ends ${fin.fiscalYearEnd.slice(0, 2)}/${fin.fiscalYearEnd.slice(2)}` : ''}</span>
      </div>

      <Card title="Charts" sub="Pick a preset or tick any row in the tables below to chart it. Metrics in different units get their own chart.">
        <div className="row" style={{ marginBottom: 10 }}>
          {PRESETS.map((p) => <button key={p.id} className="btn small" aria-pressed={p.keys.join() === prefs.keys.join()} onClick={() => setPrefs({ ...prefs, keys: p.keys })}>{p.label}</button>)}
        </div>
        <div className="row" style={{ marginBottom: 6 }}>
          {prefs.keys.map((k, i) => (
            <span key={k} className="chip"><i className="swatch" style={{ background: colorOf(k, i) }} />{items.get(k)?.label ?? k}<button aria-label={`Remove ${items.get(k)?.label ?? k}`} onClick={() => toggleKey(k)}>×</button></span>
          ))}
          {!prefs.keys.length && <span className="muted">Nothing selected.</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: groups.length > 1 ? 'repeat(auto-fit, minmax(380px, 1fr))' : '1fr', gap: 16 }}>
          {groups.map(([fmt, keys]) => (
            <div key={fmt} style={{ minWidth: 0 }}>
              <div className="small dim" style={{ marginBottom: 2 }}>{keys.length === 1 ? items.get(keys[0])?.label : UNIT_LABEL[fmt]}</div>
              <EChart option={optionFor(fmt, keys)} height={260} ariaLabel={`${keys.map((k) => items.get(k)?.label).join(', ')} by ${prefs.freq === 'annual' ? 'fiscal year' : 'quarter'}`} />
            </div>
          ))}
        </div>
      </Card>

      <section className="card">
        <div className="card-head">
          <h3>Statements</h3>
          <Seg value={prefs.section} options={[{ v: 'all', label: 'All' }, ...SECTIONS.map((s) => ({ v: s.id, label: s.label }))]} onChange={(v) => setPrefs({ ...prefs, section: v })} label="Statement" />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="left" style={{ position: 'sticky', left: 0, zIndex: 2, minWidth: 230 }}>Chart · Line item</th>
                {set.periods.map((p) => <th key={p.end} title={`${p.start ?? ''} – ${p.end}`}>{p.label}</th>)}
                {showTtm && <th title={`Trailing twelve months to ${fin.ttm!.period.end}`}>TTM</th>}
              </tr>
            </thead>
            <tbody>
              {visibleSections.map((sec) => (
                <SectionRows key={sec.id} label={sec.label} cols={set.periods.length + (showTtm ? 2 : 1)}>
                  {fin.lineItems.filter((l) => l.section === sec.id).map((l) => {
                    const vals = set.values[l.key] ?? [];
                    if (!vals.some(isNum) && !isNum(fin.ttm?.values[l.key])) return null;
                    return (
                      <tr key={l.key} className={l.strong ? 'strong' : ''}>
                        <td className="left" style={{ position: 'sticky', left: 0, background: 'var(--surface)' }} title={l.note}>
                          <label className="row" style={{ gap: 6, flexWrap: 'nowrap', cursor: 'pointer' }}>
                            <input type="checkbox" checked={prefs.keys.includes(l.key)} onChange={() => toggleKey(l.key)} aria-label={`Chart ${l.label}`} />
                            {l.label}
                          </label>
                        </td>
                        {vals.map((v, i) => <td key={i} className={l.fmt === 'pct' && (l.key.endsWith('Growth')) ? (isNum(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '') : ''}>{cell(v, l.fmt)}</td>)}
                        {showTtm && <td>{cell(fin.ttm!.values[l.key], l.fmt)}</td>}
                      </tr>
                    );
                  })}
                </SectionRows>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-pad note">
          Built from the company’s XBRL filings. Quarterly cash-flow items are derived from year-to-date figures; a fiscal fourth quarter is the full year minus the first three quarters. EBITDA, free cash flow, owner earnings and the ratios are calculated here (hover a row name for its definition). A dash means the company did not report that item under a standard tag.
        </div>
      </section>
    </div>
  );
}

function SectionRows({ label, cols, children }: { label: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr><td className="left" colSpan={cols} style={{ background: 'var(--surface-2)', fontWeight: 700 }}>{label}</td></tr>
      {children}
    </>
  );
}
