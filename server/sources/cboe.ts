import { fetchJson, fetchText } from '../lib/http.ts';
import { num, parseCsv, usDateToIso } from '../lib/util.ts';
import type { Bar } from '../../shared/types.ts';

/**
 * Cboe publishes 15-minute delayed quotes, intraday bars and full daily history
 * for US equities, ETFs and the indexes it disseminates (S&P 500, Dow, Russell,
 * VIX, MSCI ...). Index symbols are prefixed with an underscore: _SPX.
 */
const BASE = 'https://cdn-api.cboe.com/api/global';

export interface CboeQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  pctChange: number | null; // percent, e.g. -0.36
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  iv30: number | null;
  lastTradeTime: string | null;
}

export async function quote(symbol: string, background = false): Promise<CboeQuote | null> {
  const j = await fetchJson<any>(`${BASE}/delayed_quotes/quotes/${encodeURIComponent(symbol)}.json`, { nullOn: [403, 404], retries: 2, background });
  const d = j?.data;
  if (!d) return null;
  const price = num(d.current_price) || num(d.close) || null;
  return {
    symbol,
    price,
    change: num(d.price_change),
    pctChange: num(d.price_change_percent),
    open: num(d.open) || null,
    high: num(d.high) || null,
    low: num(d.low) || null,
    prevClose: num(d.prev_day_close) || null,
    volume: num(d.volume),
    iv30: num(d.iv30) || null,
    lastTradeTime: d.last_trade_time ?? null,
  };
}

/** Daily history, oldest first. Index bars often carry open = 0; those are repaired from the close. */
export async function history(symbol: string): Promise<Bar[]> {
  const j = await fetchJson<any>(`${BASE}/delayed_quotes/charts/historical/${encodeURIComponent(symbol)}.json`, { nullOn: [403, 404], timeoutMs: 60_000 });
  const rows: any[] = j?.data ?? [];
  const out: Bar[] = [];
  for (const r of rows) {
    const c = num(r.close);
    if (!r.date || c == null || c <= 0) continue;
    const o = num(r.open) || c;
    const h = num(r.high) || Math.max(o, c);
    const l = num(r.low) || Math.min(o, c);
    out.push({ d: String(r.date), o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: num(r.volume) ?? 0 });
  }
  return out;
}

export interface IntradayBar {
  t: number; // exchange wall-clock time encoded as a UTC epoch (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export async function intraday(symbol: string): Promise<IntradayBar[]> {
  const j = await fetchJson<any>(`${BASE}/delayed_quotes/charts/intraday/${encodeURIComponent(symbol)}.json`, { nullOn: [403, 404] });
  const rows: any[] = j?.data ?? [];
  const out: IntradayBar[] = [];
  for (const r of rows) {
    const t = Date.parse(`${r.datetime}Z`);
    const c = num(r.price?.close);
    if (!Number.isFinite(t) || c == null || c <= 0) continue;
    out.push({ t, o: num(r.price?.open) || c, h: num(r.price?.high) || c, l: num(r.price?.low) || c, c, v: num(r.volume?.stock_volume) ?? 0 });
  }
  return out;
}

/** Long daily index histories that Cboe publishes as CSV (VIX from 1990, SKEW from 1990). */
export async function indexCsv(name: 'VIX' | 'SKEW' | 'VIX3M' | 'VVIX'): Promise<[string, number][]> {
  const text = await fetchText(`${BASE}/us_indices/daily_prices/${name}_History.csv`, { timeoutMs: 60_000 });
  if (!text) return [];
  const rows = parseCsv(text);
  const head = rows[0].map((h) => h.trim().toUpperCase());
  const ci = head.indexOf('CLOSE') >= 0 ? head.indexOf('CLOSE') : head.length - 1;
  const out: [string, number][] = [];
  for (const r of rows.slice(1)) {
    const d = usDateToIso(r[0] ?? '');
    const v = num(r[ci]);
    if (d && v != null) out.push([d, v]);
  }
  return out;
}
