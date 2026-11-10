import { state } from './universe/store.ts';
import { FILTERS, FILTER_BY_ID, SIGNALS, customCond, evalCond, type Cond } from '../shared/filters.ts';
import { COLUMN_BY_KEY, VIEWS, DEFAULT_CUSTOM } from '../shared/columns.ts';
import type { StockRow } from '../shared/types.ts';
import { isNum, ymd } from './lib/util.ts';

export interface ScreenerQuery {
  filters: Record<string, string>;
  signal?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  size?: number;
  view?: string;
  columns?: string[];
  q?: string;
  symbols?: string[];
}

function condFor(id: string, value: string): Cond | null {
  const def = FILTER_BY_ID.get(id);
  if (!def || !value) return null;
  if (value.startsWith('r:')) return customCond(def, value);
  if (def.dynamic && !def.options.some((o) => o.v === value)) {
    const field = def.dynamic;
    return { op: 'eq', field, value };
  }
  return def.options.find((o) => o.v === value)?.cond ?? null;
}

export function runScreener(query: ScreenerQuery) {
  const today = ymd(new Date());
  const conds: Cond[] = [];
  for (const [id, value] of Object.entries(query.filters)) {
    // A filter may hold several values separated by "|" (any of them may match).
    const parts = value.split('|').map((v) => condFor(id, v)).filter((c): c is Cond => c != null);
    if (parts.length === 1) conds.push(parts[0]);
    else if (parts.length > 1) conds.push({ op: 'or', conds: parts });
  }
  const signal = SIGNALS.find((s) => s.id === query.signal);
  if (signal?.cond) conds.push(signal.cond);

  let rows: StockRow[] = [...state.rows.values()];
  if (query.symbols?.length) {
    const set = new Set(query.symbols);
    rows = rows.filter((r) => set.has(r.symbol));
  }
  if (query.q) {
    const needle = query.q.trim().toUpperCase();
    rows = rows.filter((r) => r.symbol.includes(needle) || r.name.toUpperCase().includes(needle));
  }
  const matched = conds.length ? rows.filter((r) => conds.every((c) => evalCond(r as any, c, today))) : rows;

  const sortKey = query.sort ?? signal?.sort ?? 'marketCap';
  const dir = query.dir ?? signal?.dir ?? (sortKey === 'symbol' || sortKey === 'name' ? 'asc' : 'desc');
  const mul = dir === 'asc' ? 1 : -1;
  const sorted = [...matched].sort((a: any, b: any) => {
    const x = a[sortKey];
    const y = b[sortKey];
    const xn = x == null || (typeof x === 'number' && !Number.isFinite(x));
    const yn = y == null || (typeof y === 'number' && !Number.isFinite(y));
    if (xn && yn) return a.symbol < b.symbol ? -1 : 1;
    if (xn) return 1; // missing values always sort last
    if (yn) return -1;
    if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * mul;
    if (typeof x === 'boolean') return (Number(x) - Number(y)) * mul;
    return (x - y) * mul || (a.symbol < b.symbol ? -1 : 1);
  });

  const size = Math.min(500, Math.max(1, query.size ?? 20));
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const page = Math.min(pages, Math.max(1, query.page ?? 1));
  const view = query.view ?? 'overview';
  const keys = view === 'custom' ? (query.columns?.length ? query.columns : DEFAULT_CUSTOM) : view === 'charts' ? ['symbol', 'name', 'price', 'change', 'marketCap', 'sector', 'perfQuarter'] : VIEWS[view]?.columns ?? VIEWS.overview.columns;
  const cols = [...new Set(['symbol', 'name', ...keys])].filter((k) => COLUMN_BY_KEY.has(k));
  const slice = sorted.slice((page - 1) * size, page * size).map((r: any) => {
    const o: Record<string, unknown> = {};
    for (const k of cols) o[k] = r[k] ?? null;
    if (view === 'charts') o.spark = r.spark ?? [];
    return o;
  });
  return { total: sorted.length, universe: state.rows.size, page, pages, size, sort: sortKey, dir, view, columns: keys, rows: slice };
}

/** Sector, industry and country lists (with counts) for the dynamic dropdowns. */
export function screenerMeta() {
  const count = (key: 'sector' | 'industry' | 'country') => {
    const m = new Map<string, number>();
    for (const r of state.rows.values()) {
      const v = r[key];
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, n]) => ({ value, n }));
  };
  const industriesBySector: Record<string, string[]> = {};
  for (const r of state.rows.values()) {
    if (!r.sector || !r.industry) continue;
    const list = (industriesBySector[r.sector] ??= []);
    if (!list.includes(r.industry)) list.push(r.industry);
  }
  const rows = [...state.rows.values()];
  const cover = (f: (r: StockRow) => unknown) => rows.filter((r) => f(r) != null).length;
  return {
    sectors: count('sector'),
    industries: count('industry'),
    countries: count('country'),
    industriesBySector,
    coverage: { total: rows.length, fundamentals: cover((r) => r.fundamentalsAsOf), technicals: cover((r) => r.rsi), enriched: cover((r) => r.enrichedAt) },
    filterCount: FILTERS.length,
  };
}

export function searchSymbols(q: string, limit = 10) {
  const needle = q.trim().toUpperCase();
  if (!needle) return [];
  const rows = [...state.rows.values()];
  const score = (r: StockRow) => (r.symbol === needle ? 0 : r.symbol.startsWith(needle) ? 1 : r.name.toUpperCase().startsWith(needle) ? 2 : r.name.toUpperCase().includes(needle) ? 3 : 9);
  return rows
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || (b.r.marketCap ?? 0) - (a.r.marketCap ?? 0))
    .slice(0, limit)
    .map(({ r }) => ({ symbol: r.symbol, name: r.name, exchange: r.exchange, sector: r.sector, marketCap: r.marketCap }));
}

export function peersOf(symbol: string, limit = 8): StockRow[] {
  const self = state.rows.get(symbol);
  if (!self) return [];
  const all = [...state.rows.values()].filter((r) => r.symbol !== symbol && r.cik !== self.cik && isNum(r.marketCap) && r.marketCap > 0);
  let pool = self.industry ? all.filter((r) => r.industry === self.industry) : [];
  // Thin industries are topped up from the same sector so there is always something to compare with.
  if (pool.length < 4 && self.sector) pool = [...pool, ...all.filter((r) => r.sector === self.sector && !pool.includes(r))];
  const cap = self.marketCap ?? 0;
  const dist = (r: StockRow) => (cap > 0 ? Math.abs(Math.log((r.marketCap as number) / cap)) : -(r.marketCap as number));
  return pool.sort((a, b) => (a.industry === self.industry ? 0 : 1) - (b.industry === self.industry ? 0 : 1) || dist(a) - dist(b)).slice(0, limit);
}

export function marketOverview() {
  const rows = [...state.rows.values()].filter((r) => isNum(r.change) && isNum(r.marketCap) && r.marketCap > 0);
  const sectors = new Map<string, { cap: number; weighted: number; n: number; up: number }>();
  for (const r of rows) {
    if (!r.sector) continue;
    const s = sectors.get(r.sector) ?? { cap: 0, weighted: 0, n: 0, up: 0 };
    s.cap += r.marketCap as number;
    s.weighted += (r.marketCap as number) * (r.change as number);
    s.n++;
    if ((r.change as number) > 0) s.up++;
    sectors.set(r.sector, s);
  }
  const liquid = rows.filter((r) => (r.marketCap as number) >= 3e8 && (r.price ?? 0) >= 2 && (r.volume ?? 0) >= 100_000);
  const pick = (r: StockRow) => ({ symbol: r.symbol, name: r.name, price: r.price, change: r.change, volume: r.volume, marketCap: r.marketCap, sector: r.sector });
  const adv = rows.filter((r) => (r.change as number) > 0).length;
  const dec = rows.filter((r) => (r.change as number) < 0).length;
  const withTech = rows.filter((r) => isNum(r.high52w));
  return {
    asOf: state.quotesAt,
    session: state.session,
    sectors: [...sectors.entries()].map(([sector, s]) => ({ sector, change: s.weighted / s.cap, marketCap: s.cap, count: s.n, advancers: s.up })).sort((a, b) => b.change - a.change),
    gainers: [...liquid].sort((a, b) => (b.change as number) - (a.change as number)).slice(0, 10).map(pick),
    losers: [...liquid].sort((a, b) => (a.change as number) - (b.change as number)).slice(0, 10).map(pick),
    active: [...liquid].sort((a, b) => (b.volume ?? 0) * (b.price ?? 0) - (a.volume ?? 0) * (a.price ?? 0)).slice(0, 10).map(pick),
    breadth: {
      advancers: adv,
      decliners: dec,
      unchanged: rows.length - adv - dec,
      newHighs: withTech.filter((r) => (r.high52w as number) >= -0.0005).length,
      newLows: withTech.filter((r) => isNum(r.low52w) && r.low52w <= 0.0005).length,
      aboveSma50: withTech.length ? withTech.filter((r) => isNum(r.sma50) && r.sma50 > 0).length / withTech.filter((r) => isNum(r.sma50)).length : null,
      aboveSma200: withTech.length ? withTech.filter((r) => isNum(r.sma200) && r.sma200 > 0).length / Math.max(1, withTech.filter((r) => isNum(r.sma200)).length) : null,
      measured: withTech.length,
    },
  };
}
