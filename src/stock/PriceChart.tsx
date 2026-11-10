import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useApi } from '../lib/api';
import { useStored } from '../lib/store';
import { useTheme } from '../lib/theme';
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, isNum } from '../lib/format';
import EChart, { chrome } from '../components/EChart';
import { ErrorNote, Loading, Seg } from '../components/ui';
import { aggregate, bollinger, ema, macd, rsi, sma, type Num, type OHLCV } from './indicators';

type Range = '1d' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '2y' | '5y' | '10y' | 'max';
type Kind = 'candles' | 'line' | 'area';

interface Prefs {
  range: Range;
  kind: Kind;
  log: boolean;
  interval: 'D' | 'W' | 'M';
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  ema20: boolean;
  bb: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
}

const DEFAULTS: Prefs = { range: '1y', kind: 'candles', log: false, interval: 'D', sma20: false, sma50: true, sma200: true, ema20: false, bb: false, volume: true, rsi: false, macd: false };
const RANGES: { v: Range; label: string }[] = [
  { v: '1d', label: '1D' }, { v: '1m', label: '1M' }, { v: '3m', label: '3M' }, { v: '6m', label: '6M' }, { v: 'ytd', label: 'YTD' },
  { v: '1y', label: '1Y' }, { v: '2y', label: '2Y' }, { v: '5y', label: '5Y' }, { v: '10y', label: '10Y' }, { v: 'max', label: 'Max' },
];

function rangeStart(range: Range, last: string): string {
  if (range === 'max') return '0000';
  if (range === 'ytd') return `${last.slice(0, 4)}-01-01`;
  const d = new Date(`${last}T00:00:00Z`);
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '2y': 24, '5y': 60, '10y': 120 }[range as Exclude<Range, '1d' | 'ytd' | 'max'>];
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

interface ChartData {
  symbol: string;
  intraday: boolean;
  bars: [string | number, number, number, number, number, number][];
}

const toBars = (d: ChartData | null): OHLCV[] => (d?.bars ?? []).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

export default function PriceChart({ symbol }: { symbol: string }) {
  const { tokens } = useTheme();
  const [prefs, setPrefs] = useStored<Prefs>('chart.prefs', DEFAULTS);
  const p = { ...DEFAULTS, ...prefs };
  const set = (patch: Partial<Prefs>) => setPrefs({ ...p, ...patch });
  const [compare, setCompare] = useStored<string[]>('chart.compare', []);
  const [cmpInput, setCmpInput] = useState('');
  const intraday = p.range === '1d';

  const daily = useApi<ChartData>(`/api/stock/${encodeURIComponent(symbol)}/chart`);
  const intra = useApi<ChartData>(intraday ? `/api/stock/${encodeURIComponent(symbol)}/chart?range=1d` : null, 60000);
  const cmp = useApi<{ series: { id: string; short: string; data: [string, number][] }[] }>(compare.length && !intraday ? `/api/market/series?ids=${encodeURIComponent(compare.join(','))}&max=6000` : null);

  const view = useMemo(() => {
    const src = toBars(intraday ? intra.data : daily.data);
    if (!src.length) return null;
    const bars = intraday || p.interval === 'D' ? src : aggregate(src, p.interval);
    const closes = bars.map((b) => b.c);
    // Indicators are computed on the full history, then cut to the visible range.
    const ind = {
      sma20: sma(closes, 20), sma50: sma(closes, 50), sma200: sma(closes, 200), ema20: ema(closes, 20),
      bb: bollinger(closes), rsi: rsi(closes), macd: macd(closes),
    };
    let from = 0;
    if (!intraday) {
      const start = rangeStart(p.range, String(bars[bars.length - 1].t));
      from = Math.max(0, bars.findIndex((b) => String(b.t) >= start));
    }
    const cut = <T,>(a: T[]) => a.slice(from);
    return { bars: cut(bars), ind: { sma20: cut(ind.sma20), sma50: cut(ind.sma50), sma200: cut(ind.sma200), ema20: cut(ind.ema20), bbU: cut(ind.bb.upper), bbL: cut(ind.bb.lower), rsi: cut(ind.rsi), macd: cut(ind.macd.macd), signal: cut(ind.macd.signal), hist: cut(ind.macd.hist) } };
  }, [daily.data, intra.data, intraday, p.interval, p.range]);

  const comparing = compare.length > 0 && !intraday;

  const option = useMemo<EChartsOption | null>(() => {
    if (!view || !view.bars.length) return null;
    const base = chrome(tokens);
    const { bars, ind } = view;
    const x = bars.map((b) => (typeof b.t === 'number' ? new Date(b.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : String(b.t)));
    const showVol = p.volume && bars.some((b) => b.v > 0) && !comparing;
    const showRsi = p.rsi && !comparing;
    const showMacd = p.macd && !comparing;
    const lower = [showVol, showRsi, showMacd].filter(Boolean).length;
    // Stack the panels: each lower panel takes a fixed slice, the price panel takes the rest.
    const panelH = 14;
    const gap = 5;
    const top = 6;
    const bottom = 11;
    const mainH = 100 - top - bottom - lower * (panelH + gap);
    const grids: any[] = [{ left: 58, right: 16, top: `${top}%`, height: `${mainH}%` }];
    const xAxes: any[] = [];
    const yAxes: any[] = [];
    const series: any[] = [];
    const axisX = (gridIndex: number, showLabel: boolean) => ({ ...base.xAxis, type: 'category', data: x, gridIndex, boundaryGap: !comparing && p.kind === 'candles', axisLabel: { ...base.xAxis.axisLabel, show: showLabel, hideOverlap: true }, axisPointer: { label: { show: showLabel } } });
    xAxes.push(axisX(0, lower === 0));

    const line = (name: string, data: Num[] | number[], color: string, width = 2, extra: any = {}) => ({ name, type: 'line', data, showSymbol: false, lineStyle: { width, color }, itemStyle: { color }, xAxisIndex: 0, yAxisIndex: 0, connectNulls: false, ...extra });

    if (comparing) {
      // Relative performance: everything rebased to 0% at the start of the range, on one axis.
      const baseClose = bars[0].c;
      yAxes.push({ ...base.yAxis, type: 'value', scale: true, gridIndex: 0, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%` } });
      series.push(line(symbol, bars.map((b) => +((b.c / baseClose - 1) * 100).toFixed(2)), tokens.series[0]));
      (cmp.data?.series ?? []).forEach((s, i) => {
        const m = new Map(s.data);
        let first: number | null = null;
        const pts = bars.map((b) => {
          const v = m.get(String(b.t));
          if (v == null) return null;
          if (first == null) first = v;
          return +((v / first - 1) * 100).toFixed(2);
        });
        series.push(line(s.short, pts, tokens.series[(i + 1) % 8], 2, { connectNulls: true }));
      });
    } else {
      yAxes.push({ ...base.yAxis, type: p.log ? 'log' : 'value', scale: true, gridIndex: 0, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => fmtPrice(v) } });
      if (p.kind === 'candles') {
        series.push({ name: symbol, type: 'candlestick', data: bars.map((b) => [b.o, b.c, b.l, b.h]), xAxisIndex: 0, yAxisIndex: 0, itemStyle: { color: tokens.up, color0: tokens.down, borderColor: tokens.up, borderColor0: tokens.down }, barMaxWidth: 14 });
      } else {
        series.push(line(symbol, bars.map((b) => b.c), tokens.text, 2, p.kind === 'area' ? { areaStyle: { color: tokens.text, opacity: 0.07 } } : {}));
      }
      if (!intraday) {
        if (p.sma20) series.push(line('SMA 20', ind.sma20, tokens.series[0], 1.5));
        if (p.sma50) series.push(line('SMA 50', ind.sma50, tokens.series[1], 1.5));
        if (p.sma200) series.push(line('SMA 200', ind.sma200, tokens.series[6], 1.5));
        if (p.ema20) series.push(line('EMA 20', ind.ema20, tokens.series[2], 1.5));
        if (p.bb) {
          series.push(line('Bollinger bands', ind.bbU, tokens.series[4], 1));
          series.push(line('Bollinger bands', ind.bbL, tokens.series[4], 1));
        }
      }
    }

    let gi = 1;
    let cursor = top + mainH + gap;
    const titles: any[] = [];
    const addPanel = (name: string) => {
      grids.push({ left: 58, right: 16, top: `${cursor}%`, height: `${panelH}%` });
      titles.push({ text: name, left: 64, top: `${cursor - 3.2}%`, textStyle: { color: tokens.muted, fontSize: 11, fontWeight: 'normal' } });
      cursor += panelH + gap;
      const last = gi === lower;
      xAxes.push(axisX(gi, last));
      return gi++;
    };
    if (showVol) {
      const g = addPanel('Volume');
      yAxes.push({ ...base.yAxis, type: 'value', gridIndex: g, splitNumber: 2, axisLabel: { ...base.yAxis.axisLabel, formatter: (v: number) => fmtCompact(v) } });
      series.push({ name: 'Volume', type: 'bar', data: bars.map((b) => ({ value: b.v, itemStyle: { color: b.c >= b.o ? tokens.up : tokens.down, opacity: 0.55 } })), xAxisIndex: g, yAxisIndex: g, barMaxWidth: 14 });
    }
    if (showRsi) {
      const g = addPanel('RSI (14)');
      yAxes.push({ ...base.yAxis, type: 'value', gridIndex: g, min: 0, max: 100, interval: 50, });
      series.push({ name: 'RSI (14)', type: 'line', data: ind.rsi.map((v) => (v == null ? null : +v.toFixed(1))), showSymbol: false, lineStyle: { width: 1.5, color: tokens.series[0] }, itemStyle: { color: tokens.series[0] }, xAxisIndex: g, yAxisIndex: g, markLine: { silent: true, symbol: 'none', lineStyle: { color: tokens.axis, type: 'solid', width: 1 }, label: { color: tokens.muted, fontSize: 10, position: 'insideEndTop' }, data: [{ yAxis: 70, name: '70' }, { yAxis: 30, name: '30' }] } });
    }
    if (showMacd) {
      const g = addPanel('MACD (12, 26, 9)');
      yAxes.push({ ...base.yAxis, type: 'value', gridIndex: g, scale: true, splitNumber: 2, });
      series.push({ name: 'MACD histogram', type: 'bar', data: ind.hist.map((v) => (v == null ? null : { value: +v.toFixed(3), itemStyle: { color: v >= 0 ? tokens.up : tokens.down, opacity: 0.55 } })), xAxisIndex: g, yAxisIndex: g, barMaxWidth: 10 });
      series.push({ name: 'MACD', type: 'line', data: ind.macd.map((v) => (v == null ? null : +v.toFixed(3))), showSymbol: false, lineStyle: { width: 1.5, color: tokens.series[0] }, itemStyle: { color: tokens.series[0] }, xAxisIndex: g, yAxisIndex: g });
      series.push({ name: 'Signal', type: 'line', data: ind.signal.map((v) => (v == null ? null : +v.toFixed(3))), showSymbol: false, lineStyle: { width: 1.5, color: tokens.series[1] }, itemStyle: { color: tokens.series[1] }, xAxisIndex: g, yAxisIndex: g });
    }

    const legendNames = series.filter((s) => s.xAxisIndex === 0 && s.type !== 'candlestick').map((s) => s.name).filter((n, i, arr) => arr.indexOf(n) === i);
    const allX = xAxes.map((_, i) => i);
    return {
      ...base,
      legend: legendNames.length > 1 || (legendNames.length === 1 && p.kind === 'candles') ? { ...base.legendBase, data: legendNames, left: 58 } : undefined,
      title: titles,
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      tooltip: {
        ...base.tooltip,
        axisPointer: { type: 'cross', lineStyle: { color: tokens.muted, width: 1, type: 'solid' }, crossStyle: { color: tokens.muted, width: 1, type: 'solid' }, label: { backgroundColor: tokens.text2, color: tokens.surface, fontSize: 11 } },
        formatter: (params: any) => {
          const i = params[0].dataIndex;
          const b = bars[i];
          const when = typeof b.t === 'number' ? `${x[i]} ET` : fmtDate(String(b.t));
          const rows: string[] = [`<span style="color:${tokens.muted}">${when}</span>`];
          if (comparing) {
            for (const q of params) if (q.value != null) rows.push(`<span style="display:inline-block;width:12px;height:2px;background:${q.color};vertical-align:middle;margin-right:6px"></span><b>${q.value > 0 ? '+' : ''}${Number(q.value).toFixed(1)}%</b> ${q.seriesName}`);
            return rows.join('<br/>');
          }
          const prev = i > 0 ? bars[i - 1].c : null;
          rows.push(`<b>${fmtPrice(b.c)}</b> close${prev ? ` <span style="color:${b.c >= prev ? tokens.up : tokens.down}">${fmtPct(b.c / prev - 1, 2, true)}</span>` : ''}`);
          rows.push(`O ${fmtPrice(b.o)} · H ${fmtPrice(b.h)} · L ${fmtPrice(b.l)}`);
          if (b.v) rows.push(`Volume ${fmtCompact(b.v)}`);
          for (const q of params) {
            if (q.seriesType === 'candlestick' || q.seriesName === symbol || q.seriesName === 'Volume' || q.value == null) continue;
            const val = typeof q.value === 'object' ? q.value.value : q.value;
            if (!isNum(val)) continue;
            rows.push(`<span style="display:inline-block;width:12px;height:2px;background:${q.color};vertical-align:middle;margin-right:6px"></span><b>${fmtNum(val, 2)}</b> ${q.seriesName}`);
          }
          return rows.join('<br/>');
        },
      },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      dataZoom: [
        { type: 'inside', xAxisIndex: allX },
        { type: 'slider', xAxisIndex: allX, height: 18, bottom: 6, borderColor: tokens.grid, textStyle: { color: tokens.muted, fontSize: 10 }, fillerColor: 'rgba(120,120,120,0.15)', dataBackground: { lineStyle: { color: tokens.axis }, areaStyle: { color: tokens.grid } }, showDetail: false },
      ],
      series,
    };
  }, [view, tokens, p, comparing, cmp.data, symbol, intraday]);

  const loading = intraday ? intra.loading && !intra.data : daily.loading && !daily.data;
  const error = intraday ? intra.error : daily.error;
  const lowerCount = [p.volume, p.rsi, p.macd].filter(Boolean).length;
  const toggle = (k: keyof Prefs, label: string, disabled = false) => (
    <label className="row small" style={{ gap: 4, opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={Boolean(p[k])} disabled={disabled} onChange={(e) => set({ [k]: e.target.checked } as Partial<Prefs>)} /> {label}
    </label>
  );
  const first = view?.bars[0];
  const lastBar = view?.bars[view.bars.length - 1];
  const change = first && lastBar ? lastBar.c / first.c - 1 : null;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="row">
          <Seg value={p.range} options={RANGES} onChange={(v) => set({ range: v })} label="Chart range" />
          {!intraday && <Seg value={p.interval} options={[{ v: 'D', label: 'Daily' }, { v: 'W', label: 'Weekly' }, { v: 'M', label: 'Monthly' }]} onChange={(v) => set({ interval: v })} label="Bar interval" />}
          <Seg value={p.kind} options={[{ v: 'candles', label: 'Candles' }, { v: 'line', label: 'Line' }, { v: 'area', label: 'Area' }]} onChange={(v) => set({ kind: v })} label="Chart type" />
        </div>
        {isNum(change) && <span className="small dim">Range change <b className={`num ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>{fmtPct(change, 2, true)}</b></span>}
      </div>
      <div className="row" style={{ marginBottom: 8, gap: 14 }}>
        <span className="small dim">Overlays</span>
        {toggle('sma20', 'SMA 20', intraday || comparing)}
        {toggle('sma50', 'SMA 50', intraday || comparing)}
        {toggle('sma200', 'SMA 200', intraday || comparing)}
        {toggle('ema20', 'EMA 20', intraday || comparing)}
        {toggle('bb', 'Bollinger (20, 2)', intraday || comparing)}
        <span className="small dim">Panels</span>
        {toggle('volume', 'Volume', comparing)}
        {toggle('rsi', 'RSI', comparing)}
        {toggle('macd', 'MACD', comparing)}
        {toggle('log', 'Log scale', comparing)}
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small dim">Compare performance with</span>
        {compare.map((id) => (
          <span key={id} className="chip">{id.replace('sym:', '').toUpperCase()}<button aria-label={`Remove ${id}`} onClick={() => setCompare(compare.filter((x) => x !== id))}>×</button></span>
        ))}
        {[['spx', 'S&P 500'], ['ndx', 'Nasdaq-100'], ['rut', 'Russell 2000']].filter(([id]) => !compare.includes(id)).map(([id, label]) => (
          <button key={id} className="btn small" onClick={() => setCompare([...compare, id].slice(0, 4))} disabled={intraday}>+ {label}</button>
        ))}
        <form className="row" style={{ gap: 4 }} onSubmit={(e) => { e.preventDefault(); const t = cmpInput.trim().toUpperCase(); if (t && t !== symbol) setCompare([...new Set([...compare, `sym:${t}`])].slice(0, 4)); setCmpInput(''); }}>
          <input className="input" style={{ width: 100 }} placeholder="Ticker" aria-label="Compare with ticker" value={cmpInput} onChange={(e) => setCmpInput(e.target.value)} disabled={intraday} />
          <button className="btn small" type="submit" disabled={!cmpInput.trim() || intraday}>Add</button>
        </form>
        {comparing && <span className="note">Showing percent change from the start of the range.</span>}
      </div>
      {error && !view && <ErrorNote message={error} onRetry={intraday ? intra.reload : daily.reload} />}
      {loading && <Loading text="Loading price history…" />}
      {!loading && !error && view && !view.bars.length && <div className="banner">No price data for this range.</div>}
      {option && <EChart option={option} height={comparing ? 380 : 380 + lowerCount * 90} ariaLabel={`${symbol} price chart`} />}
      <p className="note" style={{ marginTop: 4 }}>Price history from Cboe (delayed 15 minutes; daily bars back to 2004 where available). Drag the slider or pinch to zoom.</p>
    </div>
  );
}
