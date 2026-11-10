import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import { api, useApi } from '../lib/api';
import { useStored } from '../lib/store';
import { useTheme } from '../lib/theme';
import { fmtAxis, fmtCompact, fmtDate, fmtNum, fmtPrice, fmtValue, isNum } from '../lib/format';
import { COLUMN_BY_KEY } from '../../shared/columns';
import type { StockRow } from '../../shared/types';
import EChart, { chrome } from '../components/EChart';
import { Card, ErrorNote, Loading, Seg } from '../components/ui';

interface ComparePayload {
  rows: StockRow[];
  financials: Record<string, { labels: string[]; ends: string[]; values: Record<string, (number | null)[]> } | null>;
  prices: Record<string, [string, number][]>;
  missing: string[];
}

type Better = 'high' | 'low' | null;
const GROUPS: { title: string; rows: [string, string, Better][] }[] = [
  { title: 'Profile', rows: [['sector', 'Sector', null], ['industry', 'Industry', null], ['country', 'Country', null], ['marketCap', 'Market cap', null], ['price', 'Price', null]] },
  { title: 'Valuation', rows: [['pe', 'P/E', 'low'], ['fpe', 'Forward P/E', 'low'], ['peg', 'PEG', 'low'], ['ps', 'P/S', 'low'], ['pb', 'P/B', 'low'], ['pfcf', 'P/FCF', 'low'], ['evEbitda', 'EV/EBITDA', 'low'], ['evSales', 'EV/Sales', 'low']] },
  { title: 'Growth', rows: [['salesGrowthQoq', 'Sales growth (latest quarter, y/y)', 'high'], ['salesGrowth3y', 'Sales growth, 3-yr annualized', 'high'], ['salesGrowth5y', 'Sales growth, 5-yr annualized', 'high'], ['epsGrowthQoq', 'EPS growth (latest quarter, y/y)', 'high'], ['epsGrowth5y', 'EPS growth, 5-yr annualized', 'high'], ['epsGrowthNextYear', 'EPS growth next year (est.)', 'high']] },
  { title: 'Profitability', rows: [['grossMargin', 'Gross margin', 'high'], ['operMargin', 'Operating margin', 'high'], ['netMargin', 'Net margin', 'high'], ['roe', 'Return on equity', 'high'], ['roic', 'Return on invested capital', 'high'], ['roa', 'Return on assets', 'high']] },
  { title: 'Financial health', rows: [['debtEq', 'Debt / equity', 'low'], ['ltDebtEq', 'Long-term debt / equity', 'low'], ['currentRatio', 'Current ratio', 'high'], ['quickRatio', 'Quick ratio', 'high']] },
  { title: 'Income for shareholders', rows: [['dividendYield', 'Dividend yield', 'high'], ['payout', 'Payout ratio', null], ['dividendGrowth', 'Dividend growth (1 yr)', 'high']] },
  { title: 'Ownership & sentiment', rows: [['instOwn', 'Institutional ownership', null], ['insiderOwn', 'Insider / affiliate ownership (est.)', null], ['shortFloat', 'Short interest, % of float', null], ['recom', 'Analyst rating (1 = strong buy)', 'low'], ['targetPrice', 'Mean analyst target', null]] },
  { title: 'Price performance', rows: [['perfMonth', '1 month', 'high'], ['perfQuarter', '3 months', 'high'], ['perfHalf', '6 months', 'high'], ['perfYear', '1 year', 'high'], ['perfYtd', 'Year to date', 'high'], ['beta', 'Beta', null], ['volatilityMonth', 'Volatility (monthly)', 'low'], ['rsi', 'RSI (14)', null], ['high52w', 'Distance from 52-week high', null]] },
];

const TREND_METRICS: { key: string; label: string; fmt: 'money' | 'pct' | 'pershare' | 'x' }[] = [
  { key: 'revenue', label: 'Revenue', fmt: 'money' },
  { key: 'netIncome', label: 'Net income', fmt: 'money' },
  { key: 'fcf', label: 'Free cash flow', fmt: 'money' },
  { key: 'revenueGrowth', label: 'Revenue growth', fmt: 'pct' },
  { key: 'grossMargin', label: 'Gross margin', fmt: 'pct' },
  { key: 'operMargin', label: 'Operating margin', fmt: 'pct' },
  { key: 'netMargin', label: 'Net margin', fmt: 'pct' },
  { key: 'roe', label: 'Return on equity', fmt: 'pct' },
  { key: 'roic', label: 'Return on invested capital', fmt: 'pct' },
  { key: 'eps', label: 'EPS (diluted)', fmt: 'pershare' },
  { key: 'fcfPerShare', label: 'Free cash flow / share', fmt: 'pershare' },
  { key: 'dps', label: 'Dividends / share', fmt: 'pershare' },
  { key: 'debtEq', label: 'Debt / equity', fmt: 'x' },
];

type Span = '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y' | '10y';

function spanStart(span: Span): string {
  const d = new Date();
  if (span === 'ytd') return `${d.getUTCFullYear()}-01-01`;
  const months = { '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60, '10y': 120 }[span];
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function AddSymbol({ onAdd, disabled }: { onAdd: (s: string) => void; disabled: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ symbol: string; name: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => api<{ symbol: string; name: string }[]>(`/api/search?q=${encodeURIComponent(q)}`).then((h) => live && setHits(h), () => undefined), 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const pick = (s: string) => {
    onAdd(s);
    setQ('');
    setHits([]);
  };
  return (
    <div className="search" ref={box} style={{ width: 220 }}>
      <input className="input" placeholder={disabled ? 'Up to 8 companies' : 'Add a ticker or company'} aria-label="Add a company to compare" value={q} disabled={disabled} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (hits[0] || q.trim())) pick(hits[0]?.symbol ?? q.trim().toUpperCase()); }} />
      {hits.length > 0 && (
        <div className="search-list">
          {hits.map((h) => <a key={h.symbol} href="#" onClick={(e) => { e.preventDefault(); pick(h.symbol); }}><span className="sym">{h.symbol}</span><span className="nm">{h.name}</span></a>)}
        </div>
      )}
    </div>
  );
}

export default function Compare() {
  const { tokens } = useTheme();
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useStored<string[]>('compare.symbols', []);
  const fromUrl = (params.get('symbols') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const symbols = fromUrl.length ? fromUrl : saved;
  const [slots, setSlots] = useStored<Record<string, number>>('compare.slots', {});
  const [span, setSpan] = useStored<Span>('compare.span', '1y');
  const [barMetric, setBarMetric] = useStored<string>('compare.bar', 'pe');
  const [trend, setTrend] = useStored<string>('compare.trend', 'operMargin');
  const [indexed, setIndexed] = useStored<boolean>('compare.indexed', true);

  // Colour follows the company: a ticker keeps its slot for as long as it stays on the page.
  const assign = (list: string[]) => {
    const map: Record<string, number> = {};
    const used = new Set<number>();
    for (const s of list) if (slots[s] != null && !used.has(slots[s])) { map[s] = slots[s]; used.add(slots[s]); }
    for (const s of list) if (map[s] == null) { let k = 0; while (used.has(k)) k++; map[s] = k % 8; used.add(map[s]); }
    return map;
  };
  const setSymbols = (list: string[]) => {
    const next = [...new Set(list)].slice(0, 8);
    setSlots(assign(next));
    setSaved(next);
    const p = new URLSearchParams(params);
    if (next.length) p.set('symbols', next.join(','));
    else p.delete('symbols');
    setParams(p, { replace: true });
  };
  useEffect(() => {
    if (fromUrl.length && fromUrl.join() !== saved.join()) {
      setSlots(assign(fromUrl));
      setSaved(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromUrl.join()]);
  const slotMap = useMemo(() => assign(symbols), [symbols.join(), slots]); // eslint-disable-line react-hooks/exhaustive-deps
  const colorOf = (s: string) => tokens.series[slotMap[s] ?? 0];

  const { data, error, loading, stale, reload } = useApi<ComparePayload>(symbols.length ? `/api/compare?symbols=${encodeURIComponent(symbols.join(','))}` : null);
  const rows = useMemo(() => (data ? symbols.map((s) => data.rows.find((r) => r.symbol === s)).filter((r): r is StockRow => r != null) : []), [data, symbols.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const addPeers = async () => {
    if (!symbols.length) return;
    try {
      const peers = await api<{ symbol: string }[]>(`/api/peers/${encodeURIComponent(symbols[0])}`);
      setSymbols([...symbols, ...peers.map((p) => p.symbol).filter((s) => !symbols.includes(s)).slice(0, Math.max(1, 5 - symbols.length))]);
    } catch {
      /* nothing to add */
    }
  };

  const perf = useMemo<EChartsOption | null>(() => {
    if (!data || !rows.length) return null;
    const base = chrome(tokens);
    const from = spanStart(span);
    const series = rows.map((r) => {
      const pts = (data.prices[r.symbol] ?? []).filter((p) => p[0] >= from);
      const first = pts[0]?.[1];
      return { name: r.symbol, type: 'line' as const, data: first ? pts.map((p) => [p[0], +((p[1] / first - 1) * 100).toFixed(2)]) : [], showSymbol: false, lineStyle: { width: 2, color: colorOf(r.symbol) }, itemStyle: { color: colorOf(r.symbol) }, endLabel: { show: rows.length <= 5, formatter: '{a}', color: tokens.text2, fontSize: 11 } };
    });
    return {
      ...base,
      grid: { left: 50, right: rows.length <= 5 ? 56 : 16, top: 34, bottom: 28 },
      legend: { ...base.legendBase },
      tooltip: { ...base.tooltip, valueFormatter: (v) => (isNum(v) ? `${(v as number) > 0 ? '+' : ''}${(v as number).toFixed(1)}%` : '–') },
      xAxis: { ...base.xAxis, type: 'time' },
      yAxis: { ...base.yAxis, type: 'value', scale: true, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => `${v > 0 ? '+' : ''}${v}%` } },
      series,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rows, span, tokens, slotMap]);

  const barDef = COLUMN_BY_KEY.get(barMetric);
  const barRows = useMemo(() => rows.map((r) => ({ symbol: r.symbol, value: (r as unknown as Record<string, unknown>)[barMetric] })).filter((x): x is { symbol: string; value: number } => isNum(x.value)).sort((a, b) => b.value - a.value), [rows, barMetric]);
  const barMax = Math.max(1e-9, ...barRows.map((b) => Math.abs(b.value)));
  const hasNeg = barRows.some((b) => b.value < 0);

  const trendDef = TREND_METRICS.find((m) => m.key === trend) ?? TREND_METRICS[0];
  const trendOption = useMemo<EChartsOption | null>(() => {
    if (!data || !rows.length) return null;
    const base = chrome(tokens);
    const years = new Set<number>();
    const perSym = rows.map((r) => {
      const f = data.financials[r.symbol];
      const m = new Map<number, number | null>();
      if (f) f.ends.forEach((e, i) => { const y = Number(e.slice(0, 4)); m.set(y, f.values[trendDef.key]?.[i] ?? null); years.add(y); });
      return { r, m };
    });
    const xs = [...years].sort((a, b) => a - b).slice(-11);
    const rebase = trendDef.fmt === 'money' && indexed;
    const fmtV = (v: number) => (rebase ? v.toFixed(0) : trendDef.fmt === 'money' ? fmtCompact(v, '$') : trendDef.fmt === 'pct' ? `${(v * 100).toFixed(1)}%` : trendDef.fmt === 'x' ? `${v.toFixed(2)}x` : `$${v.toFixed(2)}`);
    return {
      ...base,
      grid: { left: 58, right: 30, top: 34, bottom: 26 },
      legend: { ...base.legendBase },
      tooltip: { ...base.tooltip, valueFormatter: (v) => (isNum(v) ? fmtV(v as number) : '–') },
      xAxis: { ...base.xAxis, type: 'category', data: xs.map((y) => `FY${y}`), boundaryGap: false },
      yAxis: { ...base.yAxis, type: 'value', scale: true, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => (rebase ? String(v) : trendDef.fmt === 'money' ? fmtAxis(v, '$') : trendDef.fmt === 'pct' ? `${(v * 100).toFixed(0)}%` : trendDef.fmt === 'x' ? `${v}x` : `$${v}`) } },
      series: perSym.map(({ r, m }) => {
        const raw = xs.map((y) => m.get(y) ?? null);
        const first = raw.find((v) => isNum(v) && v > 0) as number | undefined;
        const vals = rebase ? raw.map((v) => (isNum(v) && first ? +((v / first) * 100).toFixed(1) : null)) : raw;
        return { name: r.symbol, type: 'line' as const, data: vals, symbolSize: 7, connectNulls: true, lineStyle: { width: 2, color: colorOf(r.symbol) }, itemStyle: { color: colorOf(r.symbol), borderColor: tokens.surface, borderWidth: 2 } };
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rows, trendDef, indexed, tokens, slotMap]);

  const best = (key: string, better: Better): string | null => {
    if (!better || rows.length < 2) return null;
    const vals = rows.map((r) => ({ s: r.symbol, v: (r as unknown as Record<string, unknown>)[key] })).filter((x): x is { s: string; v: number } => isNum(x.v) && (better === 'high' || x.v > 0));
    if (vals.length < 2) return null;
    return vals.reduce((a, b) => ((better === 'high' ? b.v > a.v : b.v < a.v) ? b : a)).s;
  };

  return (
    <div className="stack">
      <div className="row between">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <h1>Compare companies</h1>
          <span className="note">Up to eight side by side</span>
        </div>
      </div>
      <Card>
        <div className="row">
          {symbols.map((s) => (
            <span key={s} className="chip" style={{ fontSize: 13, padding: '3px 10px' }}>
              <i className="swatch" style={{ background: colorOf(s) }} />
              <Link to={`/stock/${encodeURIComponent(s)}`} style={{ color: 'inherit', fontWeight: 700 }}>{s}</Link>
              <button aria-label={`Remove ${s}`} onClick={() => setSymbols(symbols.filter((x) => x !== s))}>×</button>
            </span>
          ))}
          <AddSymbol onAdd={(s) => setSymbols([...symbols, s])} disabled={symbols.length >= 8} />
          {symbols.length > 0 && symbols.length < 8 && <button className="btn" onClick={addPeers} title={`Add companies in the same industry as ${symbols[0]}, closest in market value`}>+ Similar to {symbols[0]}</button>}
          {symbols.length > 0 && <button className="btn ghost" onClick={() => setSymbols([])}>Clear</button>}
        </div>
        {!symbols.length && (
          <div style={{ marginTop: 12 }}>
            <p className="dim">Add two or more tickers, or start from a group:</p>
            <div className="row" style={{ marginTop: 8 }}>
              {[['Mega-cap tech', 'AAPL,MSFT,GOOGL,AMZN,META'], ['Soft drinks', 'KO,PEP,KDP,MNST'], ['Big banks', 'JPM,BAC,WFC,C'], ['Retail', 'WMT,COST,TGT,HD'], ['Chips', 'NVDA,AMD,AVGO,INTC,QCOM']].map(([label, list]) => (
                <button key={label} className="btn" onClick={() => setSymbols(list.split(','))}>{label}</button>
              ))}
            </div>
          </div>
        )}
        {data && data.missing.length > 0 && <div className="banner warn" style={{ marginTop: 10 }}>Not found among US-listed stocks: {data.missing.join(', ')}</div>}
      </Card>

      {error && !data && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && symbols.length > 0 && <Loading text="Loading companies…" />}

      {data && rows.length > 0 && (
        <div className={`stack ${stale ? 'stale' : ''}`}>
          <Card title="Price performance" sub="Percent change from the start of the range" right={<Seg value={span} options={(['3m', '6m', 'ytd', '1y', '3y', '5y', '10y'] as Span[]).map((v) => ({ v, label: v.toUpperCase() }))} onChange={setSpan} label="Range" />}>
            {perf && <EChart option={perf} height={340} ariaLabel="Relative price performance of the selected companies" />}
          </Card>

          <Card title="Side by side" sub="Bold marks the more favorable figure in a row where one direction is clearly better" pad={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="left" style={{ position: 'sticky', left: 0, zIndex: 2, minWidth: 220 }}>Metric</th>
                    {rows.map((r) => (
                      <th key={r.symbol}><span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><i className="swatch" style={{ background: colorOf(r.symbol) }} /><Link to={`/stock/${encodeURIComponent(r.symbol)}`}>{r.symbol}</Link></span></th>
                    ))}
                  </tr>
                  <tr>
                    <th className="left" style={{ position: 'sticky', left: 0, top: 'auto', fontWeight: 400 }}>Company</th>
                    {rows.map((r) => <th key={r.symbol} style={{ fontWeight: 400, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', top: 'auto' }} title={r.name}>{r.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {GROUPS.map((g) => (
                    <GroupRows key={g.title} title={g.title} cols={rows.length + 1}>
                      {g.rows.map(([key, label, better]) => {
                        const col = COLUMN_BY_KEY.get(key);
                        const win = best(key, better);
                        return (
                          <tr key={key}>
                            <td className="left" style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>{label}</td>
                            {rows.map((r) => {
                              const v = (r as unknown as Record<string, unknown>)[key];
                              const text = !col ? String(v ?? '–') : key === 'marketCap' ? fmtCompact(v, '$') : col.fmt === 'price' ? (isNum(v) ? '$' + fmtPrice(v) : '–') : fmtValue(v, col.fmt === 'signedPct' ? 'pct' : col.fmt);
                              return <td key={r.symbol} className={win === r.symbol ? 'strong' : ''} style={col?.fmt === 'text' ? { maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined} title={win === r.symbol ? 'Most favorable in this row' : undefined}>{text}{win === r.symbol ? ' ●' : ''}</td>;
                            })}
                          </tr>
                        );
                      })}
                    </GroupRows>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-pad note">● marks the most favorable figure (lowest positive multiple, highest growth or return). Valuation multiples use trailing twelve-month results from SEC filings; a dash means the figure is not available.</div>
          </Card>

          <div className="two-col">
            <Card title="Rank on one metric" right={
              <select className="select" value={barMetric} onChange={(e) => setBarMetric(e.target.value)} aria-label="Metric to rank">
                {GROUPS.slice(1).map((g) => <optgroup key={g.title} label={g.title}>{g.rows.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>)}
              </select>
            }>
              <div style={{ display: 'grid', gap: 8 }}>
                {barRows.map((b) => {
                  const w = (Math.abs(b.value) / barMax) * (hasNeg ? 50 : 100);
                  return (
                    <div key={b.symbol} style={{ display: 'grid', gridTemplateColumns: '64px minmax(60px, 1fr) 84px', gap: 8, alignItems: 'center' }}>
                      <b>{b.symbol}</b>
                      <span style={{ position: 'relative', height: 14 }}>
                        {hasNeg && <span style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--axis)' }} />}
                        <span style={{ position: 'absolute', top: 0, height: 14, width: `${w}%`, left: hasNeg ? (b.value >= 0 ? '50%' : `${50 - w}%`) : 0, background: colorOf(b.symbol), borderRadius: b.value >= 0 ? '0 4px 4px 0' : '4px 0 0 4px' }} />
                      </span>
                      <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{barDef ? fmtValue(b.value, barDef.fmt === 'signedPct' ? 'pct' : barDef.fmt) : fmtNum(b.value)}</span>
                    </div>
                  );
                })}
                {!barRows.length && <span className="muted">This figure is not available for the selected companies.</span>}
              </div>
            </Card>

            <Card title="Financial history" sub={`By fiscal year, from SEC filings${trendDef.fmt === 'money' && indexed ? ' · first year shown = 100' : ''}`} right={
              <div className="row">
                {trendDef.fmt === 'money' && <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={indexed} onChange={(e) => setIndexed(e.target.checked)} /> Index to 100</label>}
                <select className="select" value={trend} onChange={(e) => setTrend(e.target.value)} aria-label="Financial metric">
                  {TREND_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
            }>
              {trendOption && <EChart option={trendOption} height={300} ariaLabel={`${trendDef.label} by fiscal year for the selected companies`} />}
              {rows.some((r) => !data.financials[r.symbol]) && <p className="note">No SEC financial statements for: {rows.filter((r) => !data.financials[r.symbol]).map((r) => r.symbol).join(', ')}.</p>}
            </Card>
          </div>
          <p className="note">Price history through {fmtDate(rows[0]?.barsAsOf ?? null)}. Each figure is defined on the company’s own page.</p>
        </div>
      )}
    </div>
  );
}

function GroupRows({ title, cols, children }: { title: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr><td className="left" colSpan={cols} style={{ background: 'var(--surface-2)', fontWeight: 700 }}>{title}</td></tr>
      {children}
    </>
  );
}
