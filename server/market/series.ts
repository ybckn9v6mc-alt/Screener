import { cached, HOUR, MIN } from '../lib/cache.ts';
import * as cboe from '../sources/cboe.ts';
import * as nasdaq from '../sources/nasdaq.ts';
import * as fed from '../sources/fed.ts';
import { ymd } from '../lib/util.ts';
import type { Bar } from '../../shared/types.ts';

export type Point = [string, number]; // [YYYY-MM-DD, value]

export interface SeriesDef {
  id: string;
  name: string;
  short: string;
  unit: 'index' | 'percent' | 'ratio' | 'usd' | 'score';
  group: 'Equity indexes' | 'Sentiment & valuation' | 'Volatility' | 'Rates' | 'International' | 'Other assets';
  source: string;
  note?: string;
  load: () => Promise<Point[]>;
}

const HIST_TTL = 4 * HOUR;

/** Daily bars for any Cboe symbol, cached on disk. */
export function cboeBars(symbol: string): Promise<Bar[]> {
  return cached('bars-cboe', symbol, HIST_TTL, () => cboe.history(symbol), { noMemory: false });
}

/** Up to ten years of daily bars from Nasdaq (used where Cboe has no history). */
export function nasdaqBars(symbol: string, assetclass: nasdaq.AssetClass): Promise<Bar[]> {
  return cached('bars-nasdaq', `${assetclass}-${symbol}`, HIST_TTL, () => {
    const to = new Date();
    const from = new Date(to.getTime() - 3653 * 86_400_000);
    return nasdaq.historical(symbol, assetclass, ymd(from), ymd(to));
  });
}

const closes = (bars: Bar[], scale = 1): Point[] => bars.map((b) => [b.d, b.c * scale]);

/** Append today's delayed quote when the history file has not rolled yet. */
async function withLive(points: Point[], symbol: string, scale = 1): Promise<Point[]> {
  try {
    const q = await cached('quote-cboe', symbol, 2 * MIN, () => cboe.quote(symbol));
    const day = q?.lastTradeTime?.slice(0, 10);
    if (q?.price && day && points.length && day > points[points.length - 1][0]) return [...points, [day, q.price * scale]];
  } catch {
    /* history alone is fine */
  }
  return points;
}

const cboeClose = (symbol: string, scale = 1) => async () => withLive(closes(await cboeBars(symbol), scale), symbol, scale);

async function treasury(id: string): Promise<Point[]> {
  const t = await cached('fed', 'h15-treasury', 6 * HOUR, () => fed.h15Treasury(), { noMemory: true });
  const out: Point[] = [];
  for (const r of t.rows) {
    const v = r.values[id];
    if (v != null) out.push([r.period, v]);
  }
  return out;
}

async function spread(a: string, b: string): Promise<Point[]> {
  const [x, y] = await Promise.all([treasury(a), treasury(b)]);
  const m = new Map(y);
  const out: Point[] = [];
  for (const [d, v] of x) {
    const w = m.get(d);
    if (w != null) out.push([d, Math.round((v - w) * 100) / 100]);
  }
  return out;
}

async function csvSeries(name: 'VIX' | 'SKEW' | 'VIX3M' | 'VVIX', liveSymbol: string): Promise<Point[]> {
  const pts = await cached('cboe-csv', name, HIST_TTL, () => cboe.indexCsv(name));
  return withLive(pts as Point[], liveSymbol);
}

const etf = (symbol: string, name: string, group: SeriesDef['group'] = 'Other assets'): SeriesDef => ({
  id: symbol.toLowerCase(),
  name,
  short: symbol,
  unit: 'usd',
  group,
  source: 'Cboe delayed quotes',
  load: cboeClose(symbol),
});

/**
 * Every series that can be put on the comparison chart. Lazy imports for the
 * two derived indicators avoid a circular dependency at module load.
 */
export const SERIES: SeriesDef[] = [
  { id: 'spx', name: 'S&P 500', short: 'S&P 500', unit: 'index', group: 'Equity indexes', source: 'Cboe', load: cboeClose('_SPX') },
  { id: 'djia', name: 'Dow Jones Industrial Average', short: 'Dow', unit: 'index', group: 'Equity indexes', source: 'Cboe (DJX x 100)', load: cboeClose('_DJX', 100) },
  { id: 'comp', name: 'Nasdaq Composite', short: 'Nasdaq', unit: 'index', group: 'Equity indexes', source: 'Nasdaq', note: 'Ten years of history.', load: async () => closes(await nasdaqBars('COMP', 'index')) },
  { id: 'ndx', name: 'Nasdaq-100', short: 'Nasdaq-100', unit: 'index', group: 'Equity indexes', source: 'Nasdaq', note: 'Ten years of history.', load: async () => closes(await nasdaqBars('NDX', 'index')) },
  { id: 'rut', name: 'Russell 2000', short: 'Russell 2000', unit: 'index', group: 'Equity indexes', source: 'Cboe', note: 'History from late 2020.', load: cboeClose('_RUT') },
  { id: 'rui', name: 'Russell 1000', short: 'Russell 1000', unit: 'index', group: 'Equity indexes', source: 'Cboe', load: cboeClose('_RUI') },
  {
    id: 'fg', name: 'Fear & Greed Index (model)', short: 'Fear & Greed', unit: 'score', group: 'Sentiment & valuation', source: 'Computed in-app from Cboe and Fed data',
    load: async () => (await import('./feargreed.ts')).fearGreed().then((r) => r.history.map((h) => [h[0], h[1]] as Point)),
  },
  {
    id: 'buffett', name: 'Buffett Indicator (US market value / GDP)', short: 'Buffett Indicator', unit: 'percent', group: 'Sentiment & valuation', source: 'Federal Reserve Z.1, S&P 500 (Cboe)',
    load: async () => (await import('./buffett.ts')).buffettIndicator().then((r) => r.history),
  },
  { id: 'vix', name: 'VIX (S&P 500 implied volatility)', short: 'VIX', unit: 'index', group: 'Volatility', source: 'Cboe', load: () => csvSeries('VIX', '_VIX') },
  { id: 'vix3m', name: 'VIX 3-Month', short: 'VIX3M', unit: 'index', group: 'Volatility', source: 'Cboe', load: () => csvSeries('VIX3M', '_VIX3M') },
  { id: 'vvix', name: 'VVIX (volatility of VIX)', short: 'VVIX', unit: 'index', group: 'Volatility', source: 'Cboe', load: () => csvSeries('VVIX', '_VVIX') },
  { id: 'skew', name: 'Cboe SKEW (tail-risk pricing)', short: 'SKEW', unit: 'index', group: 'Volatility', source: 'Cboe', load: () => csvSeries('SKEW', '_SKEW') },
  { id: 't3m', name: '3-Month Treasury yield', short: '3M yield', unit: 'percent', group: 'Rates', source: 'Federal Reserve H.15', load: () => treasury('RIFLGFCM03_N.B') },
  { id: 't2y', name: '2-Year Treasury yield', short: '2Y yield', unit: 'percent', group: 'Rates', source: 'Federal Reserve H.15', load: () => treasury('RIFLGFCY02_N.B') },
  { id: 't10y', name: '10-Year Treasury yield', short: '10Y yield', unit: 'percent', group: 'Rates', source: 'Federal Reserve H.15', load: () => treasury('RIFLGFCY10_N.B') },
  { id: 't30y', name: '30-Year Treasury yield', short: '30Y yield', unit: 'percent', group: 'Rates', source: 'Federal Reserve H.15', load: () => treasury('RIFLGFCY30_N.B') },
  { id: 'curve', name: 'Yield curve: 10-Year minus 2-Year', short: '10Y-2Y', unit: 'percent', group: 'Rates', source: 'Federal Reserve H.15', load: () => spread('RIFLGFCY10_N.B', 'RIFLGFCY02_N.B') },
  { id: 'curve3m', name: 'Yield curve: 10-Year minus 3-Month', short: '10Y-3M', unit: 'percent', group: 'Rates', source: 'Federal Reserve H.15', load: () => spread('RIFLGFCY10_N.B', 'RIFLGFCM03_N.B') },
  { id: 'eafe', name: 'MSCI EAFE (developed markets ex-US)', short: 'MSCI EAFE', unit: 'index', group: 'International', source: 'Cboe', load: cboeClose('_MXEA') },
  { id: 'em', name: 'MSCI Emerging Markets', short: 'MSCI EM', unit: 'index', group: 'International', source: 'Cboe', load: cboeClose('_MXEF') },
  etf('GLD', 'Gold (SPDR Gold Shares)'),
  etf('USO', 'Crude oil (United States Oil Fund)'),
  etf('TLT', 'Long Treasury bonds (iShares 20+ Year)'),
  etf('HYG', 'High-yield bonds (iShares HYG)'),
  etf('UUP', 'US dollar (Invesco DB Dollar Bullish)'),
  etf('IBIT', 'Bitcoin (iShares Bitcoin Trust)'),
];

const byId = new Map(SERIES.map((s) => [s.id, s]));

export interface LoadedSeries {
  id: string;
  name: string;
  short: string;
  unit: SeriesDef['unit'];
  source: string;
  note?: string;
  data: Point[];
}

/** Load a registry series, or any US-listed ticker as "sym:AAPL". */
export async function loadSeries(id: string): Promise<LoadedSeries | null> {
  const def = byId.get(id);
  if (def) return { id, name: def.name, short: def.short, unit: def.unit, source: def.source, note: def.note, data: await def.load() };
  const m = /^sym:([A-Z0-9.]{1,8})$/.exec(id.toUpperCase().replace(/^SYM:/, 'sym:'));
  if (m) {
    const sym = m[1];
    const bars = await cboeBars(sym);
    if (!bars.length) return null;
    return { id: `sym:${sym}`, name: sym, short: sym, unit: 'usd', source: 'Cboe delayed quotes', data: await withLive(closes(bars), sym) };
  }
  return null;
}

export function seriesCatalog() {
  return SERIES.map(({ id, name, short, unit, group, source, note }) => ({ id, name, short, unit, group, source, note }));
}
