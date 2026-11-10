import { fetchJson } from '../lib/http.ts';
import { num, usDateToIso } from '../lib/util.ts';
import type { Bar } from '../../shared/types.ts';

const BASE = 'https://api.nasdaq.com/api';

async function get<T = any>(path: string): Promise<T | null> {
  const j = await fetchJson<{ data: T | null; status?: { rCode?: number } }>(`${BASE}${path}`, { timeoutMs: 45_000 });
  return j?.data ?? null;
}

/** Canonical symbols use a dot for share classes (BRK.B). Nasdaq writes BRK/B. */
export const fromNasdaqSymbol = (s: string) => s.trim().toUpperCase().replace('/', '.');
const toPath = (s: string) => encodeURIComponent(s.toUpperCase());

export interface ScreenerRow {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  pctChange: number | null;
  volume: number | null;
  marketCap: number | null;
  country: string;
  ipoYear: number | null;
  sector: string;
  industry: string;
  exchange: string;
}

export async function screenerStocks(exchange: 'NASDAQ' | 'NYSE' | 'AMEX'): Promise<ScreenerRow[]> {
  const d = await get<any>(`/screener/stocks?tableonly=true&limit=25&offset=0&download=true&exchange=${exchange}`);
  const rows: any[] = d?.rows ?? [];
  return rows.map((r) => ({
    symbol: fromNasdaqSymbol(String(r.symbol ?? '')),
    name: String(r.name ?? '').trim(),
    price: num(r.lastsale),
    change: num(r.pctchange) == null ? null : num(r.netchange),
    pctChange: num(r.pctchange),
    volume: num(r.volume),
    marketCap: num(r.marketCap) || null,
    country: String(r.country ?? '').trim(),
    ipoYear: num(r.ipoyear),
    sector: String(r.sector ?? '').trim(),
    industry: String(r.industry ?? '').trim(),
    exchange,
  }));
}

export type AssetClass = 'stocks' | 'etf' | 'index';

export async function historical(symbol: string, assetclass: AssetClass, from: string, to: string): Promise<Bar[]> {
  const d = await get<any>(`/quote/${toPath(symbol)}/historical?assetclass=${assetclass}&fromdate=${from}&todate=${to}&limit=9999`);
  const rows: any[] = d?.tradesTable?.rows ?? [];
  const out: Bar[] = [];
  for (const r of rows) {
    const date = usDateToIso(String(r.date ?? ''));
    const c = num(r.close);
    if (!date || c == null) continue;
    const o = num(r.open) ?? c;
    const h = num(r.high) ?? Math.max(o, c);
    const l = num(r.low) ?? Math.min(o, c);
    out.push({ d: date, o: o || c, h: h || c, l: l || c, c, v: num(r.volume) ?? 0 });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : 1));
  return out;
}

export interface IntradayPoint {
  t: number;
  v: number;
}

export async function intradayChart(symbol: string, assetclass: AssetClass): Promise<{ points: IntradayPoint[]; prevClose: number | null; last: number | null }> {
  const d = await get<any>(`/quote/${toPath(symbol)}/chart?assetclass=${assetclass}`);
  const pts: IntradayPoint[] = (d?.chart ?? []).map((p: any) => ({ t: Number(p.x), v: Number(p.y) })).filter((p: IntradayPoint) => Number.isFinite(p.t) && Number.isFinite(p.v));
  return { points: pts, prevClose: num(d?.previousClose), last: num(d?.lastSalePrice) };
}

export async function nasdaq100(): Promise<string[]> {
  const d = await get<any>('/quote/list-type/nasdaq100');
  return (d?.data?.rows ?? []).map((r: any) => fromNasdaqSymbol(String(r.symbol)));
}

export interface EarningsCalRow {
  symbol: string;
  date: string;
  time: string;
  epsForecast: number | null;
  lastYearEps: number | null;
  fiscalQuarterEnding: string;
}

export async function earningsCalendar(date: string): Promise<EarningsCalRow[]> {
  const d = await get<any>(`/calendar/earnings?date=${date}`);
  return (d?.rows ?? []).map((r: any) => ({
    symbol: fromNasdaqSymbol(String(r.symbol ?? '')),
    date,
    time: String(r.time ?? '').replace('time-', ''),
    epsForecast: num(r.epsForecast),
    lastYearEps: num(r.lastYearEPS),
    fiscalQuarterEnding: String(r.fiscalQuarterEnding ?? ''),
  }));
}

export interface Summary {
  target: number | null;
  avgVolume: number | null;
  dividend: number | null;
  yield: number | null;
  exDividendDate: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
}

export async function summary(symbol: string, assetclass: AssetClass = 'stocks'): Promise<Summary | null> {
  const d = await get<any>(`/quote/${toPath(symbol)}/summary?assetclass=${assetclass}`);
  const s = d?.summaryData;
  if (!s) return null;
  const val = (k: string) => s[k]?.value ?? null;
  return {
    target: num(val('OneYrTarget')),
    avgVolume: num(val('AverageVolume')),
    dividend: num(val('AnnualizedDividend')),
    yield: num(val('Yield')),
    exDividendDate: val('ExDividendDate') && val('ExDividendDate') !== 'N/A' ? String(val('ExDividendDate')) : null,
    sector: val('Sector'),
    industry: val('Industry'),
    exchange: val('Exchange'),
  };
}

export interface AnalystTarget {
  low: number | null;
  high: number | null;
  mean: number | null;
  buy: number;
  hold: number;
  sell: number;
  history: { date: string; target: number | null; consensus: string | null }[];
}

export async function targetPrice(symbol: string): Promise<AnalystTarget | null> {
  const d = await get<any>(`/analyst/${toPath(symbol)}/targetprice`);
  const c = d?.consensusOverview;
  if (!c) return null;
  return {
    low: num(c.lowPriceTarget),
    high: num(c.highPriceTarget),
    mean: num(c.priceTarget),
    buy: Number(c.buy ?? 0),
    hold: Number(c.hold ?? 0),
    sell: Number(c.sell ?? 0),
    history: (d.historicalConsensus ?? []).map((h: any) => ({
      date: usDateToIso(String(h?.z?.date ?? '')) ?? '',
      target: num(h?.y),
      consensus: h?.z?.consensus ?? null,
    })),
  };
}

export interface Forecast {
  quarterly: { fiscalEnd: string; eps: number | null; high: number | null; low: number | null; n: number | null }[];
  yearly: { fiscalEnd: string; eps: number | null; high: number | null; low: number | null; n: number | null }[];
}

export async function earningsForecast(symbol: string): Promise<Forecast | null> {
  const d = await get<any>(`/analyst/${toPath(symbol)}/earnings-forecast`);
  if (!d) return null;
  const map = (rows: any[]) =>
    (rows ?? []).map((r) => ({
      fiscalEnd: String(r.fiscalEnd ?? ''),
      eps: num(r.consensusEPSForecast),
      high: num(r.highEPSForecast),
      low: num(r.lowEPSForecast),
      n: num(r.noOfEstimates),
    }));
  return { quarterly: map(d.quarterlyForecast?.rows), yearly: map(d.yearlyForecast?.rows) };
}

export interface ShortInterest {
  settlementDate: string | null;
  shares: number | null;
  avgDailyVolume: number | null;
  daysToCover: number | null;
}

export async function shortInterest(symbol: string): Promise<ShortInterest | null> {
  const d = await get<any>(`/quote/${toPath(symbol)}/short-interest?assetClass=stocks`);
  const r = d?.shortInterestTable?.rows?.[0];
  if (!r) return null;
  return {
    settlementDate: usDateToIso(String(r.settlementDate ?? '')),
    shares: num(r.interest),
    avgDailyVolume: num(r.avgDailyShareVolume),
    daysToCover: num(r.daysToCover),
  };
}

export interface Institutional {
  pct: number | null;
  holders: number | null;
  sharesHeld: number | null;
  increasedShares: number | null;
  decreasedShares: number | null;
  top: { name: string; date: string; shares: number | null; change: number | null; changePct: number | null; value: number | null }[];
}

export async function institutional(symbol: string, limit = 10): Promise<Institutional | null> {
  const d = await get<any>(`/company/${toPath(symbol)}/institutional-holdings?limit=${limit}&type=TOTAL&sortColumn=marketValue`);
  if (!d?.ownershipSummary) return null;
  const pos = (label: string) => num((d.activePositions?.rows ?? []).find((r: any) => String(r.positions).startsWith(label))?.shares);
  return {
    pct: num(d.ownershipSummary?.SharesOutstandingPCT?.value),
    holders: num(String(d.holdingsTransactions?.institutionalHolders ?? '').split(' ')[0]),
    sharesHeld: num(String(d.holdingsTransactions?.sharesHeld ?? '').split(' ')[0]),
    increasedShares: pos('Increased'),
    decreasedShares: pos('Decreased'),
    top: (d.holdingsTransactions?.table?.rows ?? []).map((r: any) => ({
      name: String(r.ownerName ?? ''),
      date: usDateToIso(String(r.date ?? '')) ?? '',
      shares: num(r.sharesHeld),
      change: num(r.sharesChange),
      changePct: num(r.sharesChangePCT),
      value: (num(r.marketValue) ?? 0) * 1000 || null,
    })),
  };
}

export interface InsiderActivity {
  buys3m: number | null;
  sells3m: number | null;
  buys12m: number | null;
  sells12m: number | null;
  sharesBought3m: number | null;
  sharesSold3m: number | null;
  sharesBought12m: number | null;
  sharesSold12m: number | null;
  recent: { insider: string; relation: string; date: string; type: string; shares: number | null; price: number | null; held: number | null }[];
}

export async function insiderTrades(symbol: string, limit = 15): Promise<InsiderActivity | null> {
  const d = await get<any>(`/company/${toPath(symbol)}/insider-trades?limit=${limit}&type=ALL&sortColumn=lastDate&sortOrder=DESC`);
  if (!d) return null;
  const row = (tbl: any, label: string) => (tbl?.rows ?? []).find((r: any) => String(r.insiderTrade).includes(label));
  const n = d.numberOfTrades;
  const s = d.numberOfSharesTraded;
  return {
    buys3m: num(row(n, 'Buys')?.months3),
    sells3m: num(row(n, 'Sells')?.months3),
    buys12m: num(row(n, 'Buys')?.months12),
    sells12m: num(row(n, 'Sells')?.months12),
    sharesBought3m: num(row(s, 'Bought')?.months3),
    sharesSold3m: num(row(s, 'Sold')?.months3),
    sharesBought12m: num(row(s, 'Bought')?.months12),
    sharesSold12m: num(row(s, 'Sold')?.months12),
    recent: (d.transactionTable?.table?.rows ?? []).map((r: any) => ({
      insider: String(r.insider ?? ''),
      relation: String(r.relation ?? ''),
      date: usDateToIso(String(r.lastDate ?? '')) ?? '',
      type: String(r.transactionType ?? ''),
      shares: num(r.sharesTraded),
      price: num(r.lastPrice),
      held: num(r.sharesHeld),
    })),
  };
}

export async function companyProfile(symbol: string): Promise<{ description: string | null; address: string | null; phone: string | null; ceo: string | null; website: string | null } | null> {
  const d = await get<any>(`/company/${toPath(symbol)}/company-profile`);
  if (!d) return null;
  const v = (k: string) => (d[k]?.value && d[k].value !== 'N/A' ? String(d[k].value) : null);
  return { description: v('CompanyDescription'), address: v('Address'), phone: v('Phone'), ceo: v('KeyExecutiveName'), website: v('CompanyUrl') };
}

export async function dividendHistory(symbol: string): Promise<{ exDate: string; amount: number | null; payDate: string | null }[]> {
  const d = await get<any>(`/quote/${toPath(symbol)}/dividends?assetclass=stocks`);
  return (d?.dividends?.rows ?? [])
    .map((r: any) => ({ exDate: usDateToIso(String(r.exOrEffDate ?? '')) ?? '', amount: num(r.amount), payDate: usDateToIso(String(r.paymentDate ?? '')) }))
    .filter((r: any) => r.exDate);
}

export async function earningsSurprise(symbol: string): Promise<{ fiscalQtrEnd: string; dateReported: string | null; eps: number | null; consensus: number | null; surprisePct: number | null }[]> {
  const d = await get<any>(`/company/${toPath(symbol)}/earnings-surprise`);
  return (d?.earningsSurpriseTable?.rows ?? []).map((r: any) => ({
    fiscalQtrEnd: String(r.fiscalQtrEnd ?? ''),
    dateReported: usDateToIso(String(r.dateReported ?? '')),
    eps: num(r.eps),
    consensus: num(r.consensusForecast),
    surprisePct: num(r.percentageSurprise),
  }));
}

export async function marketInfo(): Promise<{ status: string; isOpen: boolean; previousTradeDate: string | null; nextTradeDate: string | null } | null> {
  const d = await get<any>('/market-info');
  if (!d) return null;
  return { status: String(d.mrktStatus ?? ''), isOpen: /open/i.test(String(d.mrktStatus ?? '')) && !/pre|after|closed/i.test(String(d.mrktStatus ?? '')), previousTradeDate: d.previousTradeDate ?? null, nextTradeDate: d.nextTradeDate ?? null };
}

export interface WatchQuote {
  symbol: string;
  last: number | null;
  netChange: number | null;
  prevClose: number | null;
  volume: number | null;
  time: string | null; // ISO, exchange local time
  status: string;
}

/** Delayed quotes for up to 20 symbols in one request. */
export async function watchlist(symbols: string[], assetclass: AssetClass = 'stocks', background = false): Promise<WatchQuote[]> {
  if (!symbols.length) return [];
  const qs = symbols.slice(0, 20).map((s) => `symbol=${encodeURIComponent(s.toLowerCase())}%7c${assetclass}`).join('&');
  const j = await fetchJson<{ data: any[] | null }>(`${BASE}/quote/watchlist?${qs}`, { timeoutMs: 45_000, background });
  return (j?.data ?? []).map((r) => ({
    symbol: fromNasdaqSymbol(String(r.symbol ?? '')),
    last: num(r.lastSalePrice),
    netChange: /unch/i.test(String(r.netChange ?? '')) ? 0 : num(r.netChange),
    prevClose: num(r.previousClosePrice),
    volume: num(r.volume),
    time: r.lastTradeTimestampDateTime ? String(r.lastTradeTimestampDateTime).slice(0, 19) : null,
    status: String(r.marketStatus ?? ''),
  }));
}
