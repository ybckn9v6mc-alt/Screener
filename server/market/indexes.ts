import { cached, swr } from '../lib/cache.ts';
import { mapLimit } from '../lib/http.ts';
import * as cboe from '../sources/cboe.ts';
import * as nasdaq from '../sources/nasdaq.ts';
import { cboeBars, nasdaqBars } from './series.ts';
import type { Bar } from '../../shared/types.ts';

/**
 * The dashboard's index board. US and MSCI indexes are real index levels from
 * Cboe/Nasdaq. Single-country benchmarks (Nikkei, DAX, FTSE ...) are not
 * published by any open source that permits automated access, so each country
 * is represented by its US-listed iShares MSCI country ETF, priced in dollars.
 */
export interface IndexDef {
  id: string;
  name: string;
  detail: string;
  group: 'us' | 'world' | 'countries' | 'other';
  kind: 'index' | 'etf' | 'yield';
  src: 'cboe' | 'nasdaq';
  symbol: string;
  historySrc?: 'cboe' | 'nasdaq';
  scale?: number;
  ticker?: string; // links to the stock page where it applies
}

const c = (id: string, name: string, detail: string, group: IndexDef['group'], symbol: string, extra: Partial<IndexDef> = {}): IndexDef => ({ id, name, detail, group, kind: 'index', src: 'cboe', symbol, ...extra });
const etf = (symbol: string, name: string, detail: string, group: IndexDef['group'] = 'countries'): IndexDef => ({ id: symbol.toLowerCase(), name, detail, group, kind: 'etf', src: 'nasdaq', symbol });

export const INDEXES: IndexDef[] = [
  c('spx', 'S&P 500', 'Large-cap US stocks', 'us', '_SPX'),
  c('djia', 'Dow Jones Industrial Average', '30 US blue chips', 'us', '_DJX', { scale: 100 }),
  { id: 'comp', name: 'Nasdaq Composite', detail: 'All Nasdaq-listed stocks', group: 'us', kind: 'index', src: 'nasdaq', symbol: 'COMP' },
  c('ndx', 'Nasdaq-100', 'Largest non-financial Nasdaq stocks', 'us', '_NDX', { historySrc: 'nasdaq' }),
  c('rut', 'Russell 2000', 'US small caps', 'us', '_RUT'),
  c('vix', 'VIX', 'S&P 500 implied volatility', 'us', '_VIX'),

  c('mxwld', 'MSCI World', 'Developed markets', 'world', '_MXWLD'),
  c('mxacw', 'MSCI ACWI', 'Developed + emerging markets', 'world', '_MXACW'),
  c('mxea', 'MSCI EAFE', 'Developed markets outside North America', 'world', '_MXEA'),
  c('mxef', 'MSCI Emerging Markets', 'Emerging markets', 'world', '_MXEF'),

  etf('EWJ', 'Japan', 'iShares MSCI Japan ETF'),
  etf('MCHI', 'China', 'iShares MSCI China ETF'),
  etf('EWH', 'Hong Kong', 'iShares MSCI Hong Kong ETF'),
  etf('INDA', 'India', 'iShares MSCI India ETF'),
  etf('EWY', 'South Korea', 'iShares MSCI South Korea ETF'),
  etf('EWT', 'Taiwan', 'iShares MSCI Taiwan ETF'),
  etf('EWA', 'Australia', 'iShares MSCI Australia ETF'),
  etf('EWU', 'United Kingdom', 'iShares MSCI United Kingdom ETF'),
  etf('EWG', 'Germany', 'iShares MSCI Germany ETF'),
  etf('EWQ', 'France', 'iShares MSCI France ETF'),
  etf('EZU', 'Eurozone', 'iShares MSCI Eurozone ETF'),
  etf('EWL', 'Switzerland', 'iShares MSCI Switzerland ETF'),
  etf('EWC', 'Canada', 'iShares MSCI Canada ETF'),
  etf('EWZ', 'Brazil', 'iShares MSCI Brazil ETF'),
  etf('EWW', 'Mexico', 'iShares MSCI Mexico ETF'),

  { id: 'tnx', name: 'US 10-Year Treasury yield', detail: 'Percent', group: 'other', kind: 'yield', src: 'cboe', symbol: '_TNX', scale: 0.1 },
  etf('GLD', 'Gold', 'SPDR Gold Shares', 'other'),
  etf('USO', 'Crude oil', 'United States Oil Fund', 'other'),
  etf('UUP', 'US dollar', 'Invesco DB US Dollar Index Bullish', 'other'),
  etf('IBIT', 'Bitcoin', 'iShares Bitcoin Trust', 'other'),
];

export type Range = '1d' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '5y';
export const RANGES: Range[] = ['1d', '1m', '3m', '6m', 'ytd', '1y', '5y'];

export interface IndexCard {
  id: string;
  name: string;
  detail: string;
  group: IndexDef['group'];
  kind: IndexDef['kind'];
  symbol: string | null;
  last: number | null;
  change: number | null;
  pct: number | null; // today's change, percent
  prevClose: number | null;
  rangePct: number | null; // change over the selected range, percent
  high: number | null;
  low: number | null;
  asOf: string | null;
  /** [time, value]; time is epoch ms (exchange wall clock) for 1d, YYYY-MM-DD otherwise */
  series: [number | string, number][];
  baseline: number | null;
}

function sliceRange(bars: Bar[], range: Range): Bar[] {
  if (!bars.length) return bars;
  const last = bars[bars.length - 1].d;
  const back = (days: number) => new Date(Date.parse(last) - days * 86_400_000).toISOString().slice(0, 10);
  const from = range === '1m' ? back(31) : range === '3m' ? back(92) : range === '6m' ? back(183) : range === '1y' ? back(366) : range === '5y' ? back(5 * 365.25 + 1) : `${last.slice(0, 4)}-01-01`;
  let out = bars.filter((b) => b.d >= from);
  if (range === 'ytd') {
    // Include the last close of the previous year as the starting point.
    const idx = bars.findIndex((b) => b.d >= from);
    if (idx > 0) out = bars.slice(idx - 1);
  }
  return out;
}

function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

const liveTtl = () => 90_000;

async function card(def: IndexDef, range: Range): Promise<IndexCard> {
  const scale = def.scale ?? 1;
  const base: IndexCard = { id: def.id, name: def.name, detail: def.detail, group: def.group, kind: def.kind, symbol: def.kind === 'etf' ? def.symbol : null, last: null, change: null, pct: null, prevClose: null, rangePct: null, high: null, low: null, asOf: null, series: [], baseline: null };
  try {
    if (def.src === 'nasdaq') {
      const cls = def.kind === 'etf' ? 'etf' : 'index';
      const ic = await cached('intraday-nasdaq', `${cls}-${def.symbol}`, liveTtl(), () => nasdaq.intradayChart(def.symbol, cls));
      // The last chart point is the regular-session price; the quoted "last sale" can be an extended-hours trade.
      const last = ic.points.length ? ic.points[ic.points.length - 1].v : ic.last;
      base.last = last;
      base.prevClose = ic.prevClose;
      if (last != null && ic.prevClose) {
        base.change = last - ic.prevClose;
        base.pct = (last / ic.prevClose - 1) * 100;
      }
      if (ic.points.length) {
        base.high = Math.max(...ic.points.map((p) => p.v));
        base.low = Math.min(...ic.points.map((p) => p.v));
        base.asOf = new Date(ic.points[ic.points.length - 1].t).toISOString().slice(0, 16).replace('T', ' ');
      }
      if (range === '1d') {
        base.series = thin(ic.points, 100).map((p) => [p.t, p.v]);
        base.baseline = ic.prevClose;
      }
    } else {
      const q = await cached('quote-cboe', def.symbol, liveTtl(), () => cboe.quote(def.symbol));
      if (q) {
        base.last = q.price != null ? q.price * scale : null;
        base.prevClose = q.prevClose != null ? q.prevClose * scale : null;
        base.change = q.change != null ? q.change * scale : null;
        base.pct = q.pctChange;
        base.high = q.high != null ? q.high * scale : null;
        base.low = q.low != null ? q.low * scale : null;
        base.asOf = q.lastTradeTime ? q.lastTradeTime.slice(0, 16).replace('T', ' ') : null;
      }
      if (range === '1d') {
        const bars = await cached('intraday-cboe', def.symbol, liveTtl(), () => cboe.intraday(def.symbol));
        base.series = thin(bars, 100).map((b) => [b.t, b.c * scale]);
        base.baseline = base.prevClose;
      }
    }
    if (range !== '1d') {
      const bars = (def.historySrc ?? def.src) === 'nasdaq' ? await nasdaqBars(def.src === 'nasdaq' ? def.symbol : def.symbol.replace('_', ''), def.kind === 'etf' ? 'etf' : 'index') : await cboeBars(def.symbol);
      const sl = sliceRange(bars, range);
      const pts: [string, number][] = sl.map((b) => [b.d, b.c * scale]);
      // Extend with the live value when the history file has not rolled to today.
      const day = base.asOf?.slice(0, 10);
      if (base.last != null && day && pts.length && day > pts[pts.length - 1][0]) pts.push([day, base.last]);
      base.series = thin(pts, 260);
      if (pts.length > 1) {
        base.baseline = pts[0][1];
        base.rangePct = (pts[pts.length - 1][1] / pts[0][1] - 1) * 100;
      }
    } else {
      base.rangePct = base.pct;
    }
  } catch {
    /* leave the card empty rather than failing the board */
  }
  return base;
}

export async function indexBoard(range: Range): Promise<IndexCard[]> {
  // Serve the last board immediately and refresh it in the background once it is over a minute old.
  return swr<IndexCard[]>('market', `board-${range}`, 75_000, async (prev) => {
    const cards = await mapLimit(INDEXES, 6, (def) => card(def, range));
    if (!prev) return cards;
    // A card that failed to refresh keeps its previous reading rather than going blank.
    const old = new Map(prev.map((c) => [c.id, c]));
    return cards.map((c) => (c.last == null && old.get(c.id)?.last != null ? (old.get(c.id) as IndexCard) : c));
  });
}
