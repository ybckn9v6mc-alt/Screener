import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import { useApi } from '../lib/api';
import { useStored } from '../lib/store';
import { useTheme } from '../lib/theme';
import { deltaText, fmtCompact, fmtDate, fmtNum, fmtPct, fmtPrice, isNum, signClass } from '../lib/format';
import EChart, { chrome } from '../components/EChart';
import MiniChart from '../components/MiniChart';
import { Card, ErrorNote, Legend, Loading, Seg } from '../components/ui';
import CompareLab from '../components/CompareLab';
import BuffettTop from '../components/BuffettTop';

// ---------------------------------------------------------------- index board

interface IndexCard {
  id: string;
  name: string;
  detail: string;
  group: 'us' | 'world' | 'countries' | 'other';
  kind: 'index' | 'etf' | 'yield';
  symbol: string | null;
  last: number | null;
  change: number | null;
  pct: number | null;
  prevClose: number | null;
  rangePct: number | null;
  asOf: string | null;
  series: [number | string, number][];
  baseline: number | null;
}

type Range = '1d' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '5y';
const RANGE_OPTS: { v: Range; label: string }[] = [
  { v: '1d', label: '1D' },
  { v: '1m', label: '1M' },
  { v: '3m', label: '3M' },
  { v: '6m', label: '6M' },
  { v: 'ytd', label: 'YTD' },
  { v: '1y', label: '1Y' },
  { v: '5y', label: '5Y' },
];

const GROUPS: { id: IndexCard['group']; title: string; note?: string }[] = [
  { id: 'us', title: 'United States' },
  { id: 'world', title: 'World', note: 'MSCI indexes, in US dollars' },
  { id: 'countries', title: 'By country', note: 'US-listed iShares MSCI country funds, in US dollars. They trade during US hours, so moves include currency and can differ from each local index’s own session.' },
  { id: 'other', title: 'Rates & other assets' },
];

const clock = (t: number | string) =>
  typeof t === 'number' ? `${new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} ET` : fmtDate(t);

function IndexTile({ c, range }: { c: IndexCard; range: Range }) {
  const value = (v: number) => (c.kind === 'yield' ? `${v.toFixed(2)}%` : c.kind === 'etf' ? `$${fmtPrice(v)}` : fmtNum(v, 2));
  const shown = range === '1d' ? c.pct : c.rangePct;
  const color = !isNum(shown) || shown === 0 ? 'var(--neutral-mark)' : shown > 0 ? 'var(--up-mark)' : 'var(--down-mark)';
  const body = (
    <>
      <div className="row between" style={{ flexWrap: 'nowrap', gap: 6 }}>
        <span className="name" title={`${c.name} — ${c.detail}`}>{c.name}</span>
        {c.symbol && <span className="muted small">{c.symbol}</span>}
      </div>
      <div className="row between" style={{ alignItems: 'baseline', gap: '0 8px' }}>
        <span className="last">{isNum(c.last) ? value(c.last) : '–'}</span>
        <span className={`num ${signClass(c.pct)}`} style={{ fontWeight: 650 }} title="Change today">{deltaText(c.pct)}</span>
      </div>
      <div className="row between small" style={{ flexWrap: 'nowrap' }}>
        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.detail}</span>
        {range !== '1d' && <span className={`num ${signClass(c.rangePct)}`}>{deltaText(c.rangePct)} <span className="muted">{RANGE_OPTS.find((r) => r.v === range)?.label}</span></span>}
      </div>
    </>
  );
  return (
    <div className="card index-card">
      {c.symbol ? <Link to={`/compare?symbols=${c.symbol}`} style={{ color: 'inherit', textDecoration: 'none' }} title="Open in Compare">{body}</Link> : body}
      <MiniChart points={c.series.map(([t, v]) => ({ t, v }))} baseline={c.baseline} color={color} formatValue={value} formatTime={clock} ariaLabel={`${c.name} ${RANGE_OPTS.find((r) => r.v === range)?.label} chart`} />
    </div>
  );
}

function IndexBoard() {
  const [range, setRange] = useStored<Range>('home.range', '1d');
  const { data, error, stale, reload } = useApi<{ cards: IndexCard[]; session: { status: string; date: string } }>(`/api/market/indexes?range=${range}`, 60000);
  return (
    <section>
      <div className="section-title">
        <h1>Markets</h1>
        {data && <span className="note">{data.session.status || 'Market'} · session {fmtDate(data.session.date)} · quotes delayed about 15 minutes</span>}
        <span className="grow" />
        <Seg value={range} options={RANGE_OPTS} onChange={setRange} label="Chart range for all indexes" />
      </div>
      {error && !data && <ErrorNote message={error} onRetry={reload} />}
      {!data && !error && <Loading text="Loading indexes…" />}
      {data && (
        <div className={stale ? 'stale' : ''}>
          {GROUPS.map((g) => {
            const cards = data.cards.filter((c) => c.group === g.id);
            if (!cards.length) return null;
            return (
              <div key={g.id} style={{ marginBottom: 14 }}>
                <div className="row" style={{ margin: '0 0 6px', alignItems: 'baseline' }}>
                  <h3>{g.title}</h3>
                  {g.note && <span className="note">{g.note}</span>}
                </div>
                <div className="index-grid">
                  {cards.map((c) => <IndexTile key={c.id} c={c} range={range} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- market internals

interface Mover {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  volume: number | null;
}

interface Overview {
  sectors: { sector: string; change: number; marketCap: number; count: number; advancers: number }[];
  gainers: Mover[];
  losers: Mover[];
  active: Mover[];
  breadth: { advancers: number; decliners: number; unchanged: number; newHighs: number; newLows: number; aboveSma50: number | null; aboveSma200: number | null; measured: number };
}

function MoverTable({ title, rows, link }: { title: string; rows: Mover[]; link: string }) {
  return (
    <Card title={title} right={<Link className="small" to={link}>See all</Link>} pad={false}>
      <div className="table-wrap">
        <table className="data compact">
          <thead>
            <tr><th className="left">Ticker</th><th className="left">Company</th><th>Price</th><th>Change</th><th>Volume</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="left strong"><Link to={`/stock/${encodeURIComponent(r.symbol)}`}>{r.symbol}</Link></td>
                <td className="left" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</td>
                <td>{fmtPrice(r.price)}</td>
                <td className={signClass(r.change)}>{fmtPct(r.change, 2, true)}</td>
                <td>{fmtCompact(r.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SectorBars({ sectors }: { sectors: Overview['sectors'] }) {
  const max = Math.max(0.005, ...sectors.map((s) => Math.abs(s.change)));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {sectors.map((s) => {
        const w = (Math.abs(s.change) / max) * 50;
        return (
          <Link key={s.sector} to={`/screener?sector=${encodeURIComponent(s.sector)}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 170px) minmax(60px, 1fr) 64px', gap: 8, alignItems: 'center', color: 'inherit' }} title={`${s.advancers} of ${s.count} stocks up · ${fmtCompact(s.marketCap, '$')} market value`}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sector}</span>
            <span style={{ position: 'relative', height: 12 }}>
              <span style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--axis)' }} />
              <span style={{ position: 'absolute', top: 0, height: 12, width: `${w}%`, left: s.change >= 0 ? '50%' : `${50 - w}%`, background: s.change >= 0 ? 'var(--up-mark)' : 'var(--down-mark)', borderRadius: s.change >= 0 ? '0 4px 4px 0' : '4px 0 0 4px' }} />
            </span>
            <span className={`num ${signClass(s.change)}`} style={{ textAlign: 'right', fontWeight: 600 }}>{fmtPct(s.change, 2, true)}</span>
          </Link>
        );
      })}
    </div>
  );
}

interface Yields {
  latest: { date: string; points: { tenor: string; value: number | null }[] };
  monthAgo: { date: string; points: { tenor: string; value: number | null }[] };
  yearAgo: { date: string; points: { tenor: string; value: number | null }[] };
}

function YieldCurve() {
  const { data } = useApi<Yields>('/api/market/yields');
  const { tokens } = useTheme();
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    const base = chrome(tokens);
    const mk = (name: string, d: Yields['latest'], color: string, width: number) => ({ name: `${name} (${fmtDate(d.date)})`, type: 'line' as const, data: d.points.map((p) => p.value), symbolSize: 6, lineStyle: { width, color }, itemStyle: { color, borderColor: tokens.surface, borderWidth: 2 }, connectNulls: true });
    return {
      ...base,
      grid: { left: 40, right: 12, top: 34, bottom: 24 },
      legend: { ...base.legendBase },
      tooltip: { ...base.tooltip, valueFormatter: (v) => (isNum(v) ? `${(v as number).toFixed(2)}%` : '–') },
      xAxis: { ...base.xAxis, type: 'category', data: data.latest.points.map((p) => p.tenor), boundaryGap: false },
      yAxis: { ...base.yAxis, type: 'value', scale: true, axisLabel: { ...base.yAxis.axisLabel, formatter: '{value}%' } },
      series: [mk('Latest', data.latest, tokens.series[0], 2), mk('1 month ago', data.monthAgo, tokens.series[1], 2), mk('1 year ago', data.yearAgo, tokens.series[2], 2)],
    };
  }, [data, tokens]);
  return (
    <Card title="US Treasury yield curve" sub="Constant-maturity yields, Federal Reserve H.15">
      {option ? <EChart option={option} height={220} ariaLabel="US Treasury yield curve: latest, one month ago and one year ago" /> : <Loading />}
    </Card>
  );
}

function Internals() {
  const { data, error } = useApi<Overview>('/api/market/overview', 120000);
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return <Loading text="Loading market internals…" />;
  const b = data.breadth;
  const total = b.advancers + b.decliners + b.unchanged || 1;
  return (
    <section>
      <div className="section-title">
        <h2>Today’s market</h2>
        <span className="note">All US-listed common stocks and ADRs</span>
      </div>
      <div className="two-col">
        <Card title="Sector performance today" sub="Market-value weighted. Select a sector to screen it.">
          {data.sectors.length ? <SectorBars sectors={data.sectors} /> : <span className="muted">Waiting for quotes…</span>}
        </Card>
        <div className="stack">
          <Card title="Breadth">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
              <div><div className="stat-label">Advancing</div><div className="stat-value">{b.advancers.toLocaleString()}</div><div className="small muted">{((b.advancers / total) * 100).toFixed(0)}% of stocks</div></div>
              <div><div className="stat-label">Declining</div><div className="stat-value">{b.decliners.toLocaleString()}</div><div className="small muted">{((b.decliners / total) * 100).toFixed(0)}% of stocks</div></div>
              <div><div className="stat-label">New 52-week highs</div><div className="stat-value">{b.measured ? b.newHighs.toLocaleString() : '–'}</div></div>
              <div><div className="stat-label">New 52-week lows</div><div className="stat-value">{b.measured ? b.newLows.toLocaleString() : '–'}</div></div>
              <div><div className="stat-label">Above 50-day average</div><div className="stat-value">{isNum(b.aboveSma50) ? `${(b.aboveSma50 * 100).toFixed(0)}%` : '–'}</div></div>
              <div><div className="stat-label">Above 200-day average</div><div className="stat-value">{isNum(b.aboveSma200) ? `${(b.aboveSma200 * 100).toFixed(0)}%` : '–'}</div></div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="meter" role="img" aria-label={`${b.advancers} advancing, ${b.unchanged} unchanged, ${b.decliners} declining`}>
                <span style={{ flex: b.advancers, background: 'var(--up-mark)' }} />
                {b.unchanged > 0 && <span style={{ flex: b.unchanged, background: 'var(--neutral-mark)' }} />}
                <span style={{ flex: b.decliners, background: 'var(--down-mark)' }} />
              </div>
              <div style={{ marginTop: 6 }}><Legend items={[{ label: 'Advancing', color: 'var(--up-mark)', line: false }, { label: 'Unchanged', color: 'var(--neutral-mark)', line: false }, { label: 'Declining', color: 'var(--down-mark)', line: false }]} /></div>
            </div>
            {b.measured < total * 0.9 && <p className="note" style={{ marginTop: 8 }}>Highs, lows and moving averages cover {b.measured.toLocaleString()} stocks so far; price history is still loading.</p>}
          </Card>
          <YieldCurve />
        </div>
      </div>
      <div className="three-col" style={{ marginTop: 12 }}>
        <MoverTable title="Top gainers" rows={data.gainers} link="/screener?signal=gainers" />
        <MoverTable title="Top losers" rows={data.losers} link="/screener?signal=losers" />
        <MoverTable title="Most active (dollar volume)" rows={data.active} link="/screener?signal=active" />
      </div>
      <p className="note" style={{ marginTop: 6 }}>Movers are limited to stocks above $300M market value, $2 price and 100K shares traded.</p>
    </section>
  );
}

// ---------------------------------------------------------------- fear & greed

interface FgComponent {
  id: string;
  name: string;
  description: string;
  score: number | null;
  rating: string;
  valueLabel: string;
  since: string | null;
}

interface FearGreed {
  asOf: string;
  score: number;
  rating: string;
  previous: { label: string; date: string; score: number; rating: string }[];
  components: FgComponent[];
  history: [string, number, number][];
  methodology: string[];
}

const ZONES = [
  { to: 25, label: 'Extreme Fear', color: 'var(--div-neg-2)' },
  { to: 45, label: 'Fear', color: 'var(--div-neg-1)' },
  { to: 55, label: 'Neutral', color: 'var(--div-mid)' },
  { to: 75, label: 'Greed', color: 'var(--div-pos-1)' },
  { to: 100, label: 'Extreme Greed', color: 'var(--div-pos-2)' },
];

function ZoneMeter({ score, labels = false }: { score: number | null; labels?: boolean }) {
  let from = 0;
  return (
    <div>
      <div className="meter" role="img" aria-label={isNum(score) ? `Score ${score.toFixed(0)} of 100` : 'No reading'}>
        {ZONES.map((z) => {
          const w = z.to - from;
          from = z.to;
          return <span key={z.label} style={{ flex: w, background: z.color }} />;
        })}
        {isNum(score) && <i className="pin" style={{ left: `${Math.min(100, Math.max(0, score))}%` }} />}
      </div>
      {labels && (
        <div style={{ display: 'flex', marginTop: 6, fontSize: 11, color: 'var(--text-2)' }}>
          {ZONES.map((z, i) => (
            <span key={z.label} style={{ flex: z.to - (i ? ZONES[i - 1].to : 0), textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{z.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

type Span = '1y' | '3y' | '5y' | '10y' | '25y' | 'max';
const spanStart = (span: Span, last: string): string => {
  if (span === 'max') return '0000';
  const years = { '1y': 1, '3y': 3, '5y': 5, '10y': 10, '25y': 25 }[span];
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

function FearGreedPanel() {
  const { data, error, reload } = useApi<FearGreed>('/api/market/feargreed', 600000);
  const { tokens } = useTheme();
  const [span, setSpan] = useStored<Span>('home.fgSpan', '3y');
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    const base = chrome(tokens);
    const from = spanStart(span, data.asOf);
    const pts = data.history.filter((h) => h[0] >= from).map((h) => [h[0], h[1]]);
    const zoneColors = [tokens.divNeg2, tokens.divNeg1, tokens.divMid, tokens.divPos1, tokens.divPos2];
    let lo = 0;
    const areas = ZONES.map((z, i) => {
      const a = [{ yAxis: lo, itemStyle: { color: zoneColors[i], opacity: 0.16 }, name: z.label }, { yAxis: z.to }];
      lo = z.to;
      return a;
    });
    return {
      ...base,
      grid: { left: 34, right: 92, top: 10, bottom: 26 },
      tooltip: {
        ...base.tooltip,
        formatter: (p: any) => {
          const v = p[0].value[1] as number;
          const z = ZONES.find((x) => v <= x.to) ?? ZONES[4];
          return `<b>${v.toFixed(0)}</b> ${z.label}<br/><span style="color:${tokens.muted}">${fmtDate(p[0].value[0])}</span>`;
        },
      },
      xAxis: { ...base.xAxis, type: 'time' },
      yAxis: { ...base.yAxis, type: 'value', min: 0, max: 100, interval: 25, splitLine: { show: false } },
      series: [{
        type: 'line', data: pts, showSymbol: false, lineStyle: { width: 2, color: tokens.text2 }, itemStyle: { color: tokens.text2 }, sampling: 'lttb',
        markArea: { silent: true, data: areas as any, label: { position: 'right', distance: 6, color: tokens.text2, fontSize: 11 } },
      }],
    };
  }, [data, tokens, span]);

  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data || !option) return <Card title="Fear & Greed Index"><Loading /></Card>;
  return (
    <Card title="Fear & Greed Index" sub={`Computed in-app from seven market indicators · as of ${fmtDate(data.asOf)}`} right={<Seg value={span} options={(['1y', '3y', '5y', '10y', 'max'] as Span[]).map((v) => ({ v, label: v.toUpperCase() }))} onChange={setSpan} label="History range" />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 20 }} className="fg-top">
        <div>
          <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
            <span className="hero">{data.score}</span>
            <span style={{ fontSize: 18, fontWeight: 650 }}>{data.rating}</span>
          </div>
          <div style={{ margin: '14px 0 12px' }}><ZoneMeter score={data.score} labels /></div>
          <div className="kv small">
            {data.previous.map((p) => (
              <FragmentRow key={p.label} k={p.label} v={`${p.score} · ${p.rating}`} />
            ))}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <EChart option={option} height={230} ariaLabel="Fear and Greed index history" />
        </div>
      </div>
      <h3 style={{ margin: '16px 0 8px' }}>What is driving it</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {data.components.map((c) => (
          <div key={c.id} className="fg-row" title={c.description}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="small muted">{c.valueLabel}</div>
            </div>
            <ZoneMeter score={c.score} />
            <div className="num" style={{ textAlign: 'right' }}><b>{isNum(c.score) ? c.score.toFixed(0) : '–'}</b> <span className="dim small">{c.rating}</span></div>
          </div>
        ))}
      </div>
      <details className="method" style={{ marginTop: 14 }}>
        <summary>How this index is calculated</summary>
        <ul>
          {data.methodology.map((m) => <li key={m}>{m}</li>)}
          {data.components.map((c) => <li key={c.id}><b>{c.name}.</b> {c.description}</li>)}
        </ul>
      </details>
    </Card>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </>
  );
}

// ---------------------------------------------------------------- buffett indicator

interface Buffett {
  asOf: string;
  value: number;
  marketValue: number;
  gdp: number;
  rating: string;
  zScore: number;
  trendValue: number;
  percentile: number;
  lastOfficialQuarter: string;
  lastOfficialValue: number;
  stats: { mean: number; median: number; min: [string, number]; max: [string, number] };
  history: [string, number][];
  trend: { date: string; trend: number; p1: number; p2: number; m1: number; m2: number }[];
  methodology: string[];
}

function BuffettPanel() {
  const { data, error, reload } = useApi<Buffett>('/api/market/buffett', 600000);
  const { tokens } = useTheme();
  const [span, setSpan] = useStored<Span>('home.biSpan', 'max');
  const option = useMemo<EChartsOption | null>(() => {
    if (!data) return null;
    const base = chrome(tokens);
    const from = spanStart(span, data.asOf);
    const hist = data.history.filter((h) => h[0] >= from);
    const tr = data.trend.filter((t) => t.date >= from);
    const band = (name: string, lowKey: 'm1' | 'm2', highKey: 'p1' | 'p2', opacity: number) => [
      { name: `${name}-base`, type: 'line' as const, stack: name, data: tr.map((t) => [t.date, t[lowKey]]), showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
      { name, type: 'line' as const, stack: name, data: tr.map((t) => [t.date, t[highKey] - t[lowKey]]), showSymbol: false, color: tokens.muted, itemStyle: { color: tokens.muted, opacity: opacity * 2.5 }, lineStyle: { opacity: 0 }, areaStyle: { color: tokens.muted, opacity }, silent: true, tooltip: { show: false } },
    ];
    return {
      ...base,
      grid: { left: 46, right: 14, top: 34, bottom: 26 },
      legend: { ...base.legendBase, data: [{ name: 'Buffett Indicator' }, { name: 'Long-run trend' }, { name: 'Within 1 std. dev. of trend', icon: 'rect', itemHeight: 9 } as any, { name: 'Within 2 std. dev.', icon: 'rect', itemHeight: 9 } as any] },
      tooltip: {
        ...base.tooltip,
        formatter: (p: any) => {
          const main = p.find((x: any) => x.seriesName === 'Buffett Indicator');
          const trend = p.find((x: any) => x.seriesName === 'Long-run trend');
          const date = (main ?? p[0]).value[0];
          return `<span style="color:${tokens.muted}">${fmtDate(date)}</span>${main ? `<br/><b>${(main.value[1] as number).toFixed(1)}%</b> Buffett Indicator` : ''}${trend ? `<br/><b>${(trend.value[1] as number).toFixed(1)}%</b> trend` : ''}`;
        },
      },
      xAxis: { ...base.xAxis, type: 'time' },
      yAxis: { ...base.yAxis, type: 'value', axisLabel: { ...base.yAxis.axisLabel, formatter: '{value}%' } },
      series: [
        ...band('Within 2 std. dev.', 'm2', 'p2', 0.1),
        ...band('Within 1 std. dev. of trend', 'm1', 'p1', 0.16),
        { name: 'Long-run trend', type: 'line', data: tr.map((t) => [t.date, t.trend]), showSymbol: false, lineStyle: { width: 2, color: tokens.muted }, itemStyle: { color: tokens.muted } },
        { name: 'Buffett Indicator', type: 'line', data: hist, showSymbol: false, lineStyle: { width: 2, color: tokens.series[0] }, itemStyle: { color: tokens.series[0] }, sampling: 'lttb' },
      ],
    };
  }, [data, tokens, span]);

  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data || !option) return <Card title="Buffett Indicator"><Loading /></Card>;
  const gap = data.value / data.trendValue - 1;
  return (
    <Card title="Buffett Indicator" sub={`US stock market value ÷ GDP · as of ${fmtDate(data.asOf)}`} right={<Seg value={span} options={(['5y', '10y', '25y', 'max'] as Span[]).map((v) => ({ v, label: v.toUpperCase() }))} onChange={setSpan} label="History range" />}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 20 }} className="fg-top">
        <div>
          <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
            <span className="hero">{data.value.toFixed(0)}%</span>
            <span style={{ fontSize: 18, fontWeight: 650 }}>{data.rating}</span>
          </div>
          <p className="note" style={{ margin: '8px 0 12px' }}>
            {Math.abs(gap * 100).toFixed(0)}% {gap >= 0 ? 'above' : 'below'} its long-run trend ({data.zScore >= 0 ? '+' : ''}{data.zScore.toFixed(1)} standard deviations). Higher than {data.percentile}% of quarters since 1946.
          </p>
          <div className="kv small">
            <FragmentRow k="US market value" v={fmtCompact(data.marketValue, '$')} />
            <FragmentRow k="GDP (annual rate)" v={fmtCompact(data.gdp, '$')} />
            <FragmentRow k="Trend value today" v={`${data.trendValue.toFixed(0)}%`} />
            <FragmentRow k="Average since 1946" v={`${data.stats.mean.toFixed(0)}%`} />
            <FragmentRow k={`Low (${data.stats.min[0].slice(0, 4)})`} v={`${data.stats.min[1].toFixed(0)}%`} />
            <FragmentRow k={`Latest Fed quarter (${fmtDate(data.lastOfficialQuarter)})`} v={`${data.lastOfficialValue.toFixed(0)}%`} />
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <EChart option={option} height={270} ariaLabel="Buffett Indicator history against its long-run trend" />
        </div>
      </div>
      <details className="method" style={{ marginTop: 12 }}>
        <summary>How this indicator is calculated</summary>
        <ul>{data.methodology.map((m) => <li key={m}>{m}</li>)}</ul>
      </details>
    </Card>
  );
}

export default function Home() {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <IndexBoard />
      <section>
        <div className="section-title">
          <h2>Sentiment & valuation</h2>
          <span className="note">Two slow-moving gauges of how stretched the market is</span>
        </div>
        <div className="stack">
          <FearGreedPanel />
          <BuffettPanel />
        </div>
      </section>
      <section>
        <div className="section-title">
          <h2>Quality at a sensible price</h2>
          <span className="note">The checklist, run across the whole market</span>
        </div>
        <BuffettTop />
      </section>
      <section>
        <div className="section-title">
          <h2>Compare</h2>
          <span className="note">Put the S&P 500 next to sentiment, valuation, volatility, rates or any ticker</span>
        </div>
        <CompareLab />
      </section>
      <Internals />
    </div>
  );
}
