import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useStored } from '../lib/store';
import { fmtCompact, fmtPct, fmtPrice, fmtValue, signClass } from '../lib/format';
import { FILTERS, FILTER_BY_ID, SIGNALS, type FilterDef, type FilterTab } from '../../shared/filters';
import { COLUMNS, COLUMN_BY_KEY, DEFAULT_CUSTOM, VIEWS } from '../../shared/columns';
import type { BuildStatus } from '../../shared/types';
import MiniChart from '../components/MiniChart';
import { ErrorNote, Hint, Loading } from '../components/ui';

interface Meta {
  sectors: { value: string; n: number }[];
  industries: { value: string; n: number }[];
  countries: { value: string; n: number }[];
  industriesBySector: Record<string, string[]>;
  coverage: { total: number; fundamentals: number; technicals: number; enriched: number };
  status: BuildStatus;
}

interface Result {
  total: number;
  universe: number;
  page: number;
  pages: number;
  size: number;
  sort: string;
  dir: 'asc' | 'desc';
  view: string;
  columns: string[];
  rows: Record<string, any>[];
}

const RESERVED = new Set(['sort', 'dir', 'page', 'size', 'view', 'signal', 'columns', 'q']);
const TABS: { v: FilterTab | 'all'; label: string }[] = [
  { v: 'descriptive', label: 'Descriptive' },
  { v: 'fundamental', label: 'Fundamental' },
  { v: 'technical', label: 'Technical' },
  { v: 'all', label: 'All' },
];
const VIEW_TABS = [...Object.entries(VIEWS).map(([v, d]) => ({ v, label: d.label })), { v: 'custom', label: 'Custom' }, { v: 'charts', label: 'Charts' }];

function FilterControl({ def, value, onChange, meta, sector }: { def: FilterDef; value: string; onChange: (v: string) => void; meta: Meta | null; sector: string }) {
  const isCustom = value.startsWith('r:');
  const [, lo = '', hi = ''] = isCustom ? value.split(':') : [];
  const dynamic = useMemo(() => {
    if (!def.dynamic || !meta) return [];
    if (def.dynamic === 'sector') return meta.sectors;
    if (def.dynamic === 'country') return meta.countries;
    const allowed = sector && meta.industriesBySector[sector] ? new Set(meta.industriesBySector[sector]) : null;
    return meta.industries.filter((i) => !allowed || allowed.has(i.value));
  }, [def.dynamic, meta, sector]);
  const id = `f-${def.id}`;
  return (
    <div className={`filter ${value ? 'active' : ''}`}>
      <label htmlFor={id}>
        {def.label}
        {def.help && <Hint text={def.help} />}
      </label>
      <select id={id} className="select" value={isCustom ? '__custom' : value} onChange={(e) => onChange(e.target.value === '__custom' ? 'r::' : e.target.value)}>
        <option value="">Any</option>
        {def.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        {dynamic.map((d) => <option key={d.value} value={d.value}>{d.value} ({d.n})</option>)}
        {def.custom && <option value="__custom">Custom range…</option>}
      </select>
      {isCustom && def.custom && (
        <div className="range">
          <input className="input" type="number" inputMode="decimal" placeholder="Min" aria-label={`${def.label} minimum`} value={lo} onChange={(e) => onChange(`r:${e.target.value}:${hi}`)} />
          <span className="muted">to</span>
          <input className="input" type="number" inputMode="decimal" placeholder="Max" aria-label={`${def.label} maximum`} value={hi} onChange={(e) => onChange(`r:${lo}:${e.target.value}`)} />
          {def.custom.unit && <span className="muted small nowrap">{def.custom.unit}</span>}
        </div>
      )}
    </div>
  );
}

function describe(def: FilterDef, value: string): string {
  if (value.startsWith('r:')) {
    const [, lo, hi] = value.split(':');
    const u = def.custom?.unit ?? '';
    if (lo && hi) return `${lo}–${hi}${u}`;
    if (lo) return `≥ ${lo}${u}`;
    if (hi) return `≤ ${hi}${u}`;
    return 'custom';
  }
  return def.options.find((o) => o.v === value)?.label ?? value;
}

export default function Screener() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useStored<FilterTab | 'all'>('screener.tab', 'descriptive');
  const [open, setOpen] = useStored<boolean>('screener.filtersOpen', true);
  const [customCols, setCustomCols] = useStored<string[]>('screener.columns', DEFAULT_CUSTOM);
  const [presets, setPresets] = useStored<Record<string, string>>('screener.presets', {});
  const [pickCols, setPickCols] = useState(false);
  const meta = useApi<Meta>('/api/screener/meta', 30000);

  const view = params.get('view') ?? 'overview';
  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    params.forEach((v, k) => {
      if (!RESERVED.has(k) && FILTER_BY_ID.has(k) && v) f[k] = v;
    });
    return f;
  }, [params]);

  // Custom ranges are typed a character at a time; wait briefly before querying.
  const query = useMemo(() => {
    const p = new URLSearchParams(params);
    if (view === 'custom') p.set('columns', customCols.join(','));
    if (!p.get('size')) p.set('size', view === 'charts' ? '24' : '20');
    return p.toString();
  }, [params, view, customCols]);
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(t);
  }, [query]);
  const { data, error, loading, stale, reload } = useApi<Result>(`/api/screener?${debounced}`, 60000);

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') p.delete(k);
      else p.set(k, v);
    }
    if (resetPage && !('page' in patch)) p.delete('page');
    setParams(p, { replace: true });
  };
  const setFilter = (id: string, value: string) => {
    const patch: Record<string, string | null> = { [id]: value || null };
    if (id === 'sector') patch.industry = null; // industries depend on the sector
    update(patch);
  };
  const clearAll = () => {
    const p = new URLSearchParams();
    for (const k of ['view', 'size']) if (params.get(k)) p.set(k, params.get(k) as string);
    setParams(p, { replace: true });
  };
  const sortBy = (key: string) => {
    const cur = data?.sort === key ? data.dir : null;
    const textCol = COLUMN_BY_KEY.get(key)?.fmt === 'text';
    update({ sort: key, dir: cur === 'desc' ? 'asc' : cur === 'asc' ? 'desc' : textCol ? 'asc' : 'desc' });
  };

  const shown = FILTERS.filter((f) => tab === 'all' || f.tab === tab);
  const active = Object.entries(filters);
  const counts = { descriptive: 0, fundamental: 0, technical: 0 } as Record<FilterTab, number>;
  for (const [id] of active) {
    const d = FILTER_BY_ID.get(id);
    if (d) counts[d.tab]++;
  }
  const cov = meta.data?.coverage;
  const enrichedActive = active.some(([id]) => FILTER_BY_ID.get(id)?.enriched);
  const cols = (data?.columns ?? []).map((k) => COLUMN_BY_KEY.get(k)).filter((c): c is NonNullable<typeof c> => c != null);
  const csvHref = `/api/screener?${debounced}&format=csv`;
  const presetNames = Object.keys(presets).sort();

  return (
    <div className="stack">
      <div className="row between">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <h1>Stock screener</h1>
          <span className="note">{cov ? `${cov.total.toLocaleString()} US-listed common stocks and ADRs` : 'US-listed common stocks and ADRs'}</span>
        </div>
        <div className="row">
          <select className="select" aria-label="Signal" value={params.get('signal') ?? ''} onChange={(e) => update({ signal: e.target.value || null, sort: null, dir: null })}>
            <option value="">Signal: none</option>
            {SIGNALS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input className="input" style={{ width: 170 }} placeholder="Ticker or name contains" aria-label="Ticker or name contains" value={params.get('q') ?? ''} onChange={(e) => update({ q: e.target.value || null })} />
          <select className="select" aria-label="Saved screens" value="" onChange={(e) => { const q = presets[e.target.value]; if (q != null) setParams(new URLSearchParams(q), { replace: true }); }}>
            <option value="">Saved screens{presetNames.length ? ` (${presetNames.length})` : ''}</option>
            {presetNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="btn" onClick={() => { const name = window.prompt('Name this screen'); if (name?.trim()) setPresets({ ...presets, [name.trim()]: params.toString() }); }}>Save</button>
          {presetNames.length > 0 && <button className="btn ghost" onClick={() => { const name = window.prompt(`Delete which saved screen?\n${presetNames.join(', ')}`); if (name && presets[name] != null) { const next = { ...presets }; delete next[name]; setPresets(next); } }}>Delete…</button>}
        </div>
      </div>

      <section className="card">
        <div className="row between" style={{ padding: '0 8px 0 4px' }}>
          <div className="tabs" style={{ borderBottom: 0 }}>
            {TABS.map((t) => (
              <button key={t.v} className={tab === t.v && open ? 'on' : ''} onClick={() => { setTab(t.v); setOpen(true); }}>
                {t.label}
                {t.v !== 'all' && counts[t.v] > 0 ? ` (${counts[t.v]})` : t.v === 'all' && active.length ? ` (${active.length})` : ''}
              </button>
            ))}
          </div>
          <div className="row">
            <span className="small dim">{FILTERS.length} filters</span>
            <button className="btn ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide filters' : 'Show filters'}</button>
            <button className="btn small" onClick={clearAll} disabled={!active.length && !params.get('signal') && !params.get('q')}>Reset</button>
          </div>
        </div>
        {open && (
          <div className="filter-grid" style={{ borderTop: '1px solid var(--border)' }}>
            {shown.map((def) => <FilterControl key={def.id} def={def} value={filters[def.id] ?? ''} onChange={(v) => setFilter(def.id, v)} meta={meta.data} sector={filters.sector ?? ''} />)}
          </div>
        )}
        {active.length > 0 && (
          <div className="row" style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
            {active.map(([id, v]) => {
              const def = FILTER_BY_ID.get(id) as FilterDef;
              return (
                <span key={id} className="chip">
                  <span className="dim">{def.label}:</span> {describe(def, v)}
                  <button aria-label={`Remove ${def.label} filter`} onClick={() => setFilter(id, '')}>×</button>
                </span>
              );
            })}
          </div>
        )}
      </section>

      {enrichedActive && cov && cov.enriched < cov.total * 0.95 && (
        <div className="banner">
          Analyst, short-interest and ownership data is collected one company at a time, largest first: {cov.enriched.toLocaleString()} of {cov.total.toLocaleString()} loaded so far. Stocks not reached yet are left out of filters that use it.
        </div>
      )}

      <section className="card">
        <div className="row between" style={{ padding: '0 12px 0 4px', borderBottom: '1px solid var(--border)' }}>
          <div className="tabs" style={{ borderBottom: 0 }}>
            {VIEW_TABS.map((t) => <button key={t.v} className={view === t.v ? 'on' : ''} onClick={() => update({ view: t.v === 'overview' ? null : t.v, size: null }, false)}>{t.label}</button>)}
          </div>
          <div className="row">
            {view === 'custom' && <button className="btn small" onClick={() => setPickCols(!pickCols)} aria-expanded={pickCols}>Choose columns ({customCols.length})</button>}
            <a className="btn small" href={csvHref} download>Export CSV</a>
          </div>
        </div>
        {view === 'custom' && pickCols && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '2px 12px' }}>
            {COLUMNS.filter((c) => c.key !== 'symbol').map((c) => (
              <label key={c.key} className="row small" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input type="checkbox" checked={customCols.includes(c.key)} onChange={(e) => setCustomCols(e.target.checked ? [...customCols, c.key] : customCols.filter((k) => k !== c.key))} />
                {c.label}
              </label>
            ))}
          </div>
        )}

        <div className="row between" style={{ padding: '8px 16px' }}>
          <span>
            <b className="num">{data ? data.total.toLocaleString() : '–'}</b> <span className="dim">of {data ? data.universe.toLocaleString() : '–'} stocks match</span>
            {loading && <span className="spinner" style={{ marginLeft: 8, width: 12, height: 12, verticalAlign: 'middle' }} aria-label="Loading" />}
          </span>
          {data && <Pager data={data} onPage={(p) => update({ page: String(p) }, false)} onSize={(s) => update({ size: String(s) })} />}
        </div>

        {error && !data && <div className="card-pad"><ErrorNote message={error} onRetry={reload} /></div>}
        {!data && !error && <Loading text="Screening…" />}
        {data && view !== 'charts' && (
          <div className={`table-wrap ${stale ? 'stale' : ''}`}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>No.</th>
                  {cols.map((c) => (
                    <th key={c.key} className={`sortable ${c.align === 'left' ? 'left' : ''} ${data.sort === c.key ? 'sorted' : ''}`} onClick={() => sortBy(c.key)} title={c.title ?? `Sort by ${c.label}`} aria-sort={data.sort === c.key ? (data.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      {c.label}{data.sort === c.key ? (data.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.symbol}>
                    <td className="muted">{(data.page - 1) * data.size + i + 1}</td>
                    {cols.map((c) => {
                      const v = r[c.key];
                      if (c.key === 'symbol') return <td key={c.key} className="left strong"><Link to={`/stock/${encodeURIComponent(r.symbol)}`}>{r.symbol}</Link></td>;
                      if (c.key === 'name') return <td key={c.key} className="left" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }} title={v}><Link to={`/stock/${encodeURIComponent(r.symbol)}`} style={{ color: 'inherit' }}>{v}</Link></td>;
                      return <td key={c.key} className={`${c.align === 'left' ? 'left' : ''} ${c.signed ? signClass(v) : ''}`} style={c.align === 'left' ? { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>{fmtValue(v, c.fmt)}</td>;
                    })}
                  </tr>
                ))}
                {!data.rows.length && <tr><td className="left muted" colSpan={cols.length + 1} style={{ padding: 20 }}>No stocks match these filters. Remove one to widen the search.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {data && view === 'charts' && (
          <div className={`chart-tiles ${stale ? 'stale' : ''}`}>
            {data.rows.map((r) => {
              const spark: number[] = r.spark ?? [];
              const up = (r.perfQuarter ?? 0) >= 0;
              return (
                <Link key={r.symbol} to={`/stock/${encodeURIComponent(r.symbol)}`} className="card index-card" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="row between" style={{ flexWrap: 'nowrap' }}><b>{r.symbol}</b><span className={`num ${signClass(r.change)}`}>{fmtPct(r.change, 2, true)}</span></div>
                  <div className="row between small" style={{ flexWrap: 'nowrap' }}><span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span><span className="num">{fmtPrice(r.price)}</span></div>
                  <MiniChart points={spark.map((v, i) => ({ t: i, v }))} color={up ? 'var(--up-mark)' : 'var(--down-mark)'} formatValue={(v) => fmtPrice(v)} formatTime={() => ''} ariaLabel={`${r.symbol} price, last 90 sessions`} height={56} />
                  <div className="row between small"><span className="muted">{fmtCompact(r.marketCap, '$')}</span><span className={`num ${signClass(r.perfQuarter)}`}>{fmtPct(r.perfQuarter, 1, true)} <span className="muted">3M</span></span></div>
                </Link>
              );
            })}
            {!data.rows.length && <span className="muted">No stocks match these filters.</span>}
          </div>
        )}
        {data && data.pages > 1 && (
          <div className="row" style={{ padding: '8px 16px', justifyContent: 'flex-end' }}>
            <Pager data={data} onPage={(p) => update({ page: String(p) }, false)} onSize={(s) => update({ size: String(s) })} />
          </div>
        )}
      </section>

      {cov && (
        <p className="note">
          Coverage: fundamentals for {cov.fundamentals.toLocaleString()} stocks (SEC filings; foreign companies reporting under IFRS are not covered) · price history and technicals for {cov.technicals.toLocaleString()} · analyst and ownership data for {cov.enriched.toLocaleString()}.
          {meta.data?.status.live?.behind ? ` Prices are 15-minute delayed quotes refreshed on a rolling basis (${meta.data.status.live.done.toLocaleString()} of ${meta.data.status.live.total.toLocaleString()} updated this session); the rest show the previous close.` : ' Prices are end-of-day.'}
          {' '}A blank (–) means the figure is not available, and such stocks never pass a filter on that figure.
        </p>
      )}
    </div>
  );
}

function Pager({ data, onPage, onSize }: { data: Result; onPage: (p: number) => void; onSize: (s: number) => void }) {
  return (
    <div className="pager">
      <select className="select" aria-label="Rows per page" value={data.size} onChange={(e) => onSize(Number(e.target.value))}>
        {[20, 24, 50, 100, 200].filter((n) => n !== 24 || data.size === 24).map((n) => <option key={n} value={n}>{n} per page</option>)}
      </select>
      <button className="btn small" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>‹ Prev</button>
      <span className="small num">Page {data.page} of {data.pages}</span>
      <button className="btn small" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)}>Next ›</button>
    </div>
  );
}
