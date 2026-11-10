import { config } from '../config.ts';
import { hostIsThrottled, mapLimit, sleep } from '../lib/http.ts';
import { HOUR, MIN, DAY } from '../lib/cache.ts';
import { daysBetween, growth, isNum, ymd } from '../lib/util.ts';
import * as nasdaq from '../sources/nasdaq.ts';
import * as cboe from '../sources/cboe.ts';
import { cboeBars } from '../market/series.ts';
import { fetchAllFundamentals, type Fundamentals } from './fundamentals.ts';
import { ensureEntities, loadEntities, tickerIndex, getEntity, sectorFromSic, countryFromState } from './entities.ts';
import { loadMembership } from './membership.ts';
import { applyLevels, computeLevels } from './technicals.ts';
import { state, noteError, markDirty, saveSnapshot, loadSnapshot, readBars, writeBars, type LevelsMeta } from './store.ts';
import type { Bar, StockRow } from '../../shared/types.ts';

const HISTORY_DAYS = 760;

// ---------------------------------------------------------------------------------
// Session: which trading day do the screener quotes belong to?
// ---------------------------------------------------------------------------------

function nowEastern(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }).replace(' ', 'T');
}

function lastWeekday(from: Date): string {
  const d = new Date(from);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}

let sessionAt = 0;
export const sessionExtra = { prevDate: null as string | null };

async function updateSession(): Promise<void> {
  if (Date.now() - sessionAt < 2 * MIN && state.session.date) return;
  try {
    const j = await (await import('../lib/http.ts')).fetchJson<any>('https://api.nasdaq.com/api/market-info');
    const d = j?.data;
    if (!d) throw new Error('no market info');
    const prev = d.previousTradeDate ? ymd(new Date(Date.parse(`${d.previousTradeDate} UTC`))) : null;
    const now = nowEastern();
    let date = prev ?? lastWeekday(new Date());
    let open = false;
    if (d.isBusinessDay && d.openRaw && d.closeRaw && now >= d.openRaw) {
      date = String(d.openRaw).slice(0, 10);
      open = now < d.closeRaw;
      sessionExtra.prevDate = prev;
    } else {
      sessionExtra.prevDate = null;
    }
    state.session = { date, open, status: String(d.mrktStatus ?? '') };
    sessionAt = Date.now();
  } catch (err) {
    if (!state.session.date) state.session = { date: lastWeekday(new Date()), open: false, status: 'Unknown' };
    noteError(`market status unavailable: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------
// Quotes: the whole US-listed universe in three requests
// ---------------------------------------------------------------------------------

function classify(symbol: string, name: string): StockRow['type'] {
  if (/[\^$]/.test(symbol)) return 'other';
  if (/\.(WS|W|U|R|RT|UN)$/.test(symbol)) return 'other';
  if (/\b(Warrants?|Preferred|Preference|Debentures?|Notes?\b.*\bdue|Senior Notes|Subordinated|Subscription Rights?|Contingent Value Rights?|Fixed[- ]to[- ]Floating|Cumulative|Perpetual|% (Series|Notes))\b/i.test(name)) return 'other';
  if (/\bRights?$/i.test(name.trim()) || /\bRights? to\b/i.test(name)) return 'other';
  if (/\bUnits?\b/i.test(name) && !/(Common|Limited Partner|Partnership|Depositary|Beneficial|Trust|Subordinate|LP|L\.P\.) (Interests?|Units?)/i.test(name) && !/Common Units?/i.test(name) && !/United/i.test(name.replace(/\bUnits?\b/gi, ''))) {
    if (/\bUnits?\b(,| each| consisting|$)/i.test(name.trim()) || /Acquisition|SPAC/i.test(name)) return 'other';
  }
  if (/American Depositary|\bADS\b|\bADR\b|Depositary Receipts?/i.test(name)) return 'adr';
  return 'stock';
}

function cleanName(name: string): string {
  return name
    .replace(/\s+(American Depositary (Shares?|Receipts?)|Depositary (Shares?|Receipts?)|ADS|ADR)\b.*$/i, '')
    .replace(/\s+(Common Stock|Common Shares?|Ordinary Shares?|Capital Stock|Shares of Beneficial Interest|Common Units?.*|Class [A-Z] (Common Stock|Ordinary Shares?|Common Shares?))(\s.*)?$/i, (m) => {
      const cls = /Class [A-Z]/i.exec(m);
      return cls ? ` ${cls[0]}` : '';
    })
    .replace(/[\s,]+$/, '')
    .trim();
}

let membershipCache: Awaited<ReturnType<typeof loadMembership>> | null = null;

export async function refreshQuotes(): Promise<void> {
  await updateSession();
  const lists = await Promise.all((['NASDAQ', 'NYSE', 'AMEX'] as const).map((ex) => nasdaq.screenerStocks(ex).catch((e) => {
    noteError(`${ex} listing failed: ${(e as Error).message}`);
    return [] as nasdaq.ScreenerRow[];
  })));
  const total = lists.reduce((s, l) => s + l.length, 0);
  if (total < 3000) {
    noteError(`quote refresh returned only ${total} rows; keeping previous data`);
    return;
  }
  const seen = new Set<string>();
  for (const list of lists) {
    for (const s of list) {
      if (!s.symbol || seen.has(s.symbol)) continue;
      const type = classify(s.symbol, s.name);
      if (type === 'other') continue;
      seen.add(s.symbol);
      const prev = state.rows.get(s.symbol);
      const row: StockRow = prev ?? { symbol: s.symbol, name: '', exchange: s.exchange, sector: '', industry: '', country: '', type, indexes: [], ipoYear: null, price: null, change: null, volume: null, marketCap: null, sharesOut: null };
      row.name = cleanName(s.name) || s.name;
      row.type = type;
      row.exchange = s.exchange;
      if (s.sector) row.sector = s.sector;
      if (s.industry) row.industry = s.industry;
      if (s.country) row.country = s.country;
      row.ipoYear = s.ipoYear ?? row.ipoYear;
      row.price = s.price;
      row.change = s.pctChange == null ? null : s.pctChange / 100;
      row.volume = s.volume;
      row.marketCap = s.marketCap;
      row.sharesOut = isNum(s.marketCap) && isNum(s.price) && s.price > 0 ? s.marketCap / s.price : null;
      state.rows.set(s.symbol, row);
    }
  }
  for (const sym of [...state.rows.keys()]) if (!seen.has(sym)) state.rows.delete(sym);

  await inferScreenerSession();
  for (const row of state.rows.values()) overlayLive(row);

  try {
    membershipCache = await loadMembership();
  } catch (err) {
    noteError(`index membership unavailable: ${(err as Error).message}`);
  }
  applyMembership();
  for (const row of state.rows.values()) recompute(row);
  state.quotesAt = Date.now();
  state.status.universe = { count: state.rows.size, updatedAt: state.quotesAt };
  markDirty();
}

/**
 * Nasdaq's bulk listing is an end-of-day file: until its evening refresh it still
 * shows the previous session. Compare a few liquid names with Cboe's delayed
 * quotes to tell which session it reflects.
 */
async function inferScreenerSession(): Promise<void> {
  const S = state.session.date;
  let behind = 0;
  let current = 0;
  for (const sym of ['AAPL', 'MSFT', 'JPM', 'XOM', 'KO']) {
    const row = state.rows.get(sym);
    if (!row || !isNum(row.price)) continue;
    try {
      const q = await cboe.quote(sym);
      if (!q?.price || !q.prevClose) continue;
      if (q.lastTradeTime?.slice(0, 10) !== S) {
        current++; // Cboe has not started the new session either
        continue;
      }
      const near = (a: number, b: number) => Math.abs(a / b - 1) < 0.0005;
      const matchesPrev = near(row.price, q.prevClose);
      const matchesNow = near(row.price, q.price);
      if (matchesPrev && !matchesNow) behind++;
      else if (matchesNow && !matchesPrev) current++;
    } catch {
      /* no vote */
    }
  }
  if (behind + current === 0) {
    if (!state.screenerSession) state.screenerSession = state.session.open ? '' : S;
    return;
  }
  state.screenerSession = behind > current ? (sessionExtra.prevDate ?? ymd(new Date(Date.parse(S) - 86_400_000))) : S;
}

export const screenerIsBehind = () => state.screenerSession < state.session.date;

/** While the listing is a session behind, show the live quote instead (or blank the stale change). */
function overlayLive(row: StockRow): void {
  if (!screenerIsBehind()) return;
  const lq = state.live.get(row.symbol);
  if (lq && lq.date === state.session.date) {
    row.price = lq.price;
    row.change = lq.pct == null ? null : lq.pct / 100;
    row.volume = lq.volume;
    if (isNum(row.sharesOut)) row.marketCap = row.sharesOut * lq.price;
  } else {
    row.change = null;
    row.volume = null;
  }
}

function applyMembership() {
  const sets = {
    sp500: new Set(membershipCache?.sp500 ?? []),
    djia: new Set(membershipCache?.djia ?? []),
    ndx: new Set(membershipCache?.ndx ?? []),
  };
  // Russell 2000 membership is licensed data; approximate it the way the index is
  // built: US companies ranked 1,001-3,000 by market value.
  const us = [...state.rows.values()].filter((r) => r.type === 'stock' && (r.country === 'United States' || !r.country) && isNum(r.marketCap) && r.marketCap > 0).sort((a, b) => (b.marketCap as number) - (a.marketCap as number));
  const r2000 = new Set(us.slice(1000, 3000).map((r) => r.symbol));
  for (const row of state.rows.values()) {
    const ix: string[] = [];
    if (sets.sp500.has(row.symbol)) ix.push('sp500');
    if (sets.ndx.has(row.symbol)) ix.push('ndx');
    if (sets.djia.has(row.symbol)) ix.push('djia');
    if (r2000.has(row.symbol)) ix.push('r2000');
    row.indexes = ix;
  }
}

// ---------------------------------------------------------------------------------
// Derived fields: combine quote + fundamentals + technical levels + enrichment
// ---------------------------------------------------------------------------------

export interface Enrichment {
  t: number;
  target: number | null;
  dividend: number | null;
  yield: number | null;
  recom: number | null;
  epsThisFy: number | null;
  epsNextFy: number | null;
  shortShares: number | null;
  shortRatio: number | null;
  instOwn: number | null;
  instTrans: number | null;
  insiderNetShares12m: number | null;
}

export const enrichment = new Map<string, Enrichment>();
export const earnings = new Map<string, { date: string; time: string }>();
export const floatRef = new Map<string, { date: string; close: number }>();

const ratio = (a: number | null | undefined, b: number | null | undefined, requirePositive = true): number | null => {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  if (requirePositive && b < 0) return null;
  return a / b;
};

export function recompute(row: StockRow): void {
  const lv = state.levels.get(row.symbol);
  if (lv) {
    const lq = state.live.get(row.symbol);
    Object.assign(row, applyLevels(lv, row.price, row.volume, lq && lq.date === state.session.date ? lq : null));
    // A history that starts well after the requested window means the stock listed recently.
    const windowStart = ymd(new Date(Date.now() - (HISTORY_DAYS - 20) * 86_400_000));
    row.ipoDate = lv.firstDate > windowStart ? lv.firstDate : null;
  }
  const f: Fundamentals | undefined = row.cik != null ? state.funds.get(row.cik) : undefined;
  const P = row.price;
  const M = row.marketCap;
  if (f) {
    row.revenue = f.revenue;
    row.netIncome = f.netIncome;
    row.fcf = f.fcf;
    row.ebitda = f.ebitda;
    // Per-share figures are rebuilt from totals when the reported EPS belongs to another
    // share class or ADR ratio (it would otherwise give a nonsense P/E).
    const epsCalc = ratio(f.netIncome, row.sharesOut);
    let eps = f.eps;
    if (isNum(epsCalc) && (!isNum(eps) || (eps !== 0 && Math.abs(epsCalc / eps - 1) > 0.5))) eps = epsCalc;
    row.eps = eps;
    row.pe = isNum(M) && isNum(f.netIncome) && f.netIncome > 0 ? M / f.netIncome : isNum(P) && isNum(eps) && eps > 0 ? P / eps : null;
    row.ps = isNum(f.revenue) && f.revenue > 0 ? ratio(M, f.revenue) : null;
    row.pb = isNum(f.equity) && f.equity > 0 ? ratio(M, f.equity) : null;
    row.pc = isNum(f.cashAndInvestments) && f.cashAndInvestments > 0 ? ratio(M, f.cashAndInvestments) : null;
    row.pfcf = isNum(f.fcf) && f.fcf > 0 ? ratio(M, f.fcf) : null;
    row.ev = isNum(M) && f.debt != null && f.cashAndInvestments != null ? M + f.debt - f.cashAndInvestments : null;
    row.evEbitda = isNum(f.ebitda) && f.ebitda > 0 ? ratio(row.ev, f.ebitda) : null;
    row.evSales = isNum(f.revenue) && f.revenue > 0 ? ratio(row.ev, f.revenue) : null;
    row.bookPerShare = ratio(f.equity, row.sharesOut);
    row.cashPerShare = ratio(f.cashAndInvestments, row.sharesOut);
    row.dividend = f.dps;
    const y = isNum(f.dps) && isNum(P) && P > 0 ? f.dps / P : null;
    row.dividendYield = y != null && y < 0.6 ? y : null;
    row.payout = f.payout;
    row.dividendGrowth = f.dividendGrowth;
    row.epsGrowthQoq = f.epsGrowthQoq;
    row.epsGrowthTtm = f.epsGrowthTtm;
    row.epsGrowth3y = f.epsGrowth3y;
    row.epsGrowth5y = f.epsGrowth5y;
    row.salesGrowthQoq = f.salesGrowthQoq;
    row.salesGrowthTtm = f.salesGrowthTtm;
    row.salesGrowth3y = f.salesGrowth3y;
    row.salesGrowth5y = f.salesGrowth5y;
    row.grossMargin = f.grossMargin;
    row.operMargin = f.operMargin;
    row.netMargin = f.netMargin;
    row.roa = f.roa;
    row.roe = f.roe;
    row.roic = f.roic;
    row.currentRatio = f.currentRatio;
    row.quickRatio = f.quickRatio;
    row.ltDebtEq = f.ltDebtEq;
    row.debtEq = f.debtEq;
    row.fundamentalsAsOf = f.asOf;

    const fr = floatRef.get(row.symbol);
    if (f.publicFloat && fr && fr.date === f.publicFloat.date && isNum(row.sharesOut) && row.sharesOut > 0 && fr.close > 0) {
      const fl = Math.min(row.sharesOut, f.publicFloat.value / fr.close);
      row.float = fl;
      row.insiderOwn = Math.max(0, 1 - fl / row.sharesOut);
    }
  }
  const e = enrichment.get(row.symbol);
  if (e) {
    row.enrichedAt = e.t;
    row.targetPrice = e.target;
    if (isNum(e.dividend) && e.dividend > 0) {
      row.dividend = e.dividend;
      row.dividendYield = isNum(P) && P > 0 ? e.dividend / P : e.yield != null ? e.yield / 100 : row.dividendYield;
    }
    row.recom = e.recom;
    row.fpe = isNum(P) && isNum(e.epsThisFy) && e.epsThisFy > 0 ? P / e.epsThisFy : null;
    row.epsGrowthThisYear = f ? growth(f.epsFy, e.epsThisFy) : null;
    row.epsGrowthNextYear = growth(e.epsThisFy, e.epsNextFy);
    const g = [row.epsGrowthThisYear, row.epsGrowthNextYear].filter((v): v is number => isNum(v));
    const gAvg = g.length ? g.reduce((s, v) => s + v, 0) / g.length : null;
    row.peg = isNum(row.pe) && isNum(gAvg) && gAvg > 0 ? row.pe / (gAvg * 100) : null;
    const base = row.float ?? row.sharesOut;
    row.shortFloat = isNum(e.shortShares) && isNum(base) && base > 0 ? e.shortShares / base : null;
    row.shortRatio = e.shortRatio;
    row.instOwn = e.instOwn != null ? e.instOwn / 100 : null;
    row.instTrans = e.instTrans;
    row.insiderTrans = isNum(e.insiderNetShares12m) && isNum(row.sharesOut) && row.sharesOut > 0 ? e.insiderNetShares12m / row.sharesOut : null;
  }
  const er = earnings.get(row.symbol);
  row.earningsDate = er?.date ?? null;
  row.earningsTime = er?.time ?? null;
}

// ---------------------------------------------------------------------------------
// Fundamentals (SEC)
// ---------------------------------------------------------------------------------

export async function refreshFundamentals(): Promise<void> {
  state.status.fundamentals.progress = 'Downloading SEC financial data';
  const funds = await fetchAllFundamentals((d, n) => {
    state.status.fundamentals.progress = `Downloading SEC financial data (${d}/${n})`;
  });
  if (funds.length < 2000) throw new Error(`SEC returned data for only ${funds.length} companies`);
  await loadEntities();
  state.status.fundamentals.progress = 'Matching tickers to SEC filers';
  await ensureEntities(funds.map((f) => f.cik), (d, n) => {
    state.status.fundamentals.progress = `Matching tickers to SEC filers (${d}/${n})`;
  });
  state.funds = new Map(funds.map((f) => [f.cik, f]));
  linkEntities();
  for (const row of state.rows.values()) recompute(row);
  state.fundamentalsAt = Date.now();
  state.status.fundamentals = { done: true, covered: [...state.rows.values()].filter((r) => r.fundamentalsAsOf).length, updatedAt: state.fundamentalsAt };
  markDirty();
}

function linkEntities() {
  const idx = tickerIndex();
  for (const row of state.rows.values()) {
    const cands = idx.get(row.symbol);
    if (!cands?.length) continue;
    // When more than one filer claims a ticker, prefer the one with the newest financials.
    const best = [...cands].sort((a, b) => (state.funds.get(b.cik)?.asOf ?? '').localeCompare(state.funds.get(a.cik)?.asOf ?? ''))[0];
    row.cik = best.cik;
    row.sic = best.sic;
    if (!row.sector) row.sector = sectorFromSic(best.sic);
    if (!row.industry && best.sicDesc) row.industry = titleCase(best.sicDesc);
    if (!row.country) row.country = countryFromState(best.state);
  }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------------
// Technicals (daily bars per symbol)
// ---------------------------------------------------------------------------------

const misses = new Map<string, number>();
let benchmark: Map<string, number> | null = null;
let benchmarkAt = 0;

async function loadBenchmark(): Promise<Map<string, number> | undefined> {
  if (benchmark && Date.now() - benchmarkAt < 6 * HOUR) return benchmark;
  try {
    const bars = await cboeBars('SPY');
    benchmark = new Map(bars.slice(-900).map((b) => [b.d, b.c]));
    benchmarkAt = Date.now();
  } catch {
    /* beta is simply left blank */
  }
  return benchmark ?? undefined;
}

function needsBars(sym: string): boolean {
  const lv = state.levels.get(sym);
  if (!lv) {
    const miss = misses.get(sym);
    return !miss || Date.now() - miss > 12 * HOUR;
  }
  const s = state.session;
  if (lv.lastBar >= s.date) return false;
  if (lv.lastBar < (sessionExtra.prevDate ?? s.date) && Date.now() - lv.fetchedAt > 30 * MIN) return true;
  // After the close, look again every so often for the session's own bar.
  return !s.open && Date.now() - lv.fetchedAt > 90 * MIN;
}

function closeOnOrBefore(bars: Bar[], date: string): number | null {
  if (!bars.length || bars[0].d > date) return null;
  let best: Bar | null = null;
  for (const b of bars) {
    if (b.d <= date) best = b;
    else break;
  }
  return best && daysBetween(best.d, date) <= 7 ? best.c : null;
}

async function refreshSymbolBars(row: StockRow, bench: Map<string, number> | undefined): Promise<void> {
  const sym = row.symbol;
  const today = ymd(new Date());
  const start = ymd(new Date(Date.now() - HISTORY_DAYS * 86_400_000));
  let have = await readBars(sym);
  let from = start;
  if (have.length && daysBetween(have[have.length - 1].d, today) < 45) from = ymd(new Date(Date.parse(have[have.length - 1].d) - 7 * 86_400_000));
  let fresh = await nasdaq.historical(sym, 'stocks', from, today);
  if (from !== start && fresh.length) {
    // If the overlap disagrees (split or other adjustment), start over with the full window.
    const old = new Map(have.map((b) => [b.d, b.c]));
    const mismatch = fresh.some((b) => {
      const o = old.get(b.d);
      return o != null && Math.abs(b.c / o - 1) > 0.01;
    });
    if (mismatch) {
      have = [];
      fresh = await nasdaq.historical(sym, 'stocks', start, today);
    }
  }
  let bars: Bar[];
  if (!fresh.length) bars = have;
  else bars = [...have.filter((b) => b.d < fresh[0].d), ...fresh].filter((b) => b.d >= start);
  if (bars.length < 2) {
    misses.set(sym, Date.now());
    return;
  }
  if (fresh.length) await writeBars(sym, bars);
  setLevels(row, bars, bench);
}

function setLevels(row: StockRow, bars: Bar[], bench: Map<string, number> | undefined) {
  const lv = computeLevels(bars, state.session.date, bench);
  if (!lv) {
    misses.set(row.symbol, Date.now());
    return;
  }
  const meta: LevelsMeta = { ...lv, fetchedAt: Date.now(), lastBar: bars[bars.length - 1].d };
  (meta as any).forSession = state.session.date;
  state.levels.set(row.symbol, meta);
  const f = row.cik != null ? state.funds.get(row.cik) : undefined;
  if (f?.publicFloat) {
    const c = closeOnOrBefore(bars, f.publicFloat.date);
    if (c) floatRef.set(row.symbol, { date: f.publicFloat.date, close: c });
  }
  recompute(row);
}


export async function refreshTechnicals(): Promise<void> {
  await updateSession();
  const bench = await loadBenchmark();
  const rows = [...state.rows.values()].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));

  // New trading day: re-derive levels from the bars already on disk before fetching anything.
  const rolled = rows.filter((r) => {
    const lv = state.levels.get(r.symbol) as (LevelsMeta & { forSession?: string }) | undefined;
    return lv && lv.forSession !== state.session.date;
  });
  if (rolled.length) {
    await mapLimit(rolled, 8, async (r) => {
      const bars = await readBars(r.symbol);
      if (bars.length) {
        const prev = state.levels.get(r.symbol) as LevelsMeta;
        setLevels(r, bars, bench);
        const next = state.levels.get(r.symbol);
        if (next) next.fetchedAt = prev.fetchedAt;
      }
    });
    markDirty();
  }

  const todo = rows.filter((r) => needsBars(r.symbol));
  state.status.technicals.total = rows.length;
  state.status.technicals.done = rows.length - todo.length;
  if (todo.length) {
    let n = 0;
    await mapLimit(todo, 5, async (r) => {
      try {
        await refreshSymbolBars(r, bench);
      } catch (err) {
        misses.set(r.symbol, Date.now());
        if (n < 3) noteError(`bars ${r.symbol}: ${(err as Error).message}`);
      }
      n++;
      state.status.technicals.done = rows.length - todo.length + n;
      if (n % 400 === 0) {
        markDirty();
        await saveSnapshot().catch(() => undefined);
      }
    });
    state.status.technicals.updatedAt = Date.now();
    markDirty();
  }

}

// ---------------------------------------------------------------------------------
// Live quotes: batched delayed quotes while the end-of-day listing is behind
// ---------------------------------------------------------------------------------

let liveSweepAt = 0;
let liveSweepSession = '';

/**
 * Nasdaq's batch quote endpoint returns 20 symbols per request, so the whole
 * universe takes about 300 requests. Runs every few minutes during the session
 * and once more after the close, and only while the bulk listing still shows
 * the previous session.
 */
async function liveSweep(): Promise<void> {
  await updateSession();
  const S = state.session.date;
  if (!S || !state.rows.size) return;
  const behind = screenerIsBehind();
  const rows = [...state.rows.values()].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const have = rows.filter((r) => state.live.get(r.symbol)?.date === S).length;
  state.status.live = { behind, done: have, total: rows.length };
  if (!behind) return;
  const allFinal = liveSweepSession === S && rows.every((r) => state.live.get(r.symbol)?.final !== false);
  if (!state.session.open && allFinal && have > rows.length * 0.9) return;
  if (Date.now() - liveSweepAt < (state.session.open ? 3 * MIN : 10 * MIN) && liveSweepSession === S) return;
  liveSweepAt = Date.now();
  liveSweepSession = S;
  const closed = !state.session.open;
  const chunks: StockRow[][] = [];
  for (let i = 0; i < rows.length; i += 20) chunks.push(rows.slice(i, i + 20));
  await mapLimit(chunks, 3, async (chunk) => {
    try {
      const quotes = await nasdaq.watchlist(chunk.map((r) => r.symbol), 'stocks', true);
      for (const q of quotes) {
        const row = state.rows.get(q.symbol);
        if (!row || q.last == null || q.time?.slice(0, 10) !== S) continue;
        // Outside regular hours "last" is an extended-hours trade and the net change is measured
        // from the official close, so the close is last minus that change.
        const regular = /open/i.test(q.status) && !/pre|after/i.test(q.status) ? q.last : q.last - (q.netChange ?? 0);
        if (!(regular > 0)) continue;
        const prev = state.live.get(q.symbol);
        const keep = prev && prev.date === S ? prev : null;
        state.live.set(q.symbol, { date: S, price: regular, pct: q.prevClose && q.prevClose > 0 ? (regular / q.prevClose - 1) * 100 : null, volume: q.volume, o: keep?.o ?? null, h: keep?.h ?? null, l: keep?.l ?? null, final: closed, t: Date.now() });
        overlayLive(row);
        recompute(row);
      }
    } catch {
      /* the next pass will pick these up */
    }
  });
  state.status.live.done = rows.filter((r) => state.live.get(r.symbol)?.date === S).length;
  applyMembership();
  markDirty();
}

/** Record a Cboe quote for one stock: today's open/high/low and whether options trade on it. */
export function noteCboeQuote(row: StockRow, q: cboe.CboeQuote): void {
  state.optionableAt.set(row.symbol, Date.now());
  row.optionable = q.iv30 != null && q.iv30 > 0;
  const S = state.session.date;
  if (q.lastTradeTime?.slice(0, 10) !== S || !q.price) return;
  const prev = state.live.get(row.symbol);
  const keep = prev && prev.date === S ? prev : null;
  state.live.set(row.symbol, { date: S, price: keep?.price ?? q.price, pct: keep?.pct ?? q.pctChange, volume: keep?.volume ?? q.volume, o: q.open, h: q.high, l: q.low, final: keep?.final ?? !state.session.open, t: keep?.t ?? Date.now() });
  overlayLive(row);
  recompute(row);
}

/**
 * "Optionable" comes from Cboe (it reports implied volatility only where options
 * trade). Cboe throttles hard, so this is a slow trickle: one stock every few
 * seconds, refreshed every two weeks, and it stands down whenever Cboe pushes back.
 */
async function optionableTrickle(): Promise<void> {
  if (hostIsThrottled('cdn-api.cboe.com') || !state.rows.size) return;
  const now = Date.now();
  let pick: StockRow | null = null;
  for (const r of state.rows.values()) {
    if (now - (state.optionableAt.get(r.symbol) ?? 0) < 14 * DAY) continue;
    if (!pick || (r.marketCap ?? 0) > (pick.marketCap ?? 0)) pick = r;
  }
  if (!pick) return;
  state.optionableAt.set(pick.symbol, now);
  try {
    const q = await cboe.quote(pick.symbol, true);
    if (q) noteCboeQuote(pick, q);
    else pick.optionable = false;
    markDirty();
  } catch {
    state.optionableAt.delete(pick.symbol);
  }
}

// ---------------------------------------------------------------------------------
// Earnings calendar (bulk, by date)
// ---------------------------------------------------------------------------------

let earningsAt = 0;

export async function refreshEarnings(): Promise<void> {
  if (Date.now() - earningsAt < 12 * HOUR) return;
  const days: string[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  for (let i = 0; i < 45; i++) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const today = ymd(new Date());
  const found = new Map<string, { date: string; time: string }>();
  await mapLimit(days, 3, async (day) => {
    try {
      for (const r of await nasdaq.earningsCalendar(day)) {
        const cur = found.get(r.symbol);
        // Keep the next upcoming date; otherwise the most recent past one.
        const better = !cur || (cur.date < today && r.date > cur.date) || (cur.date >= today && r.date >= today && r.date < cur.date);
        if (better) found.set(r.symbol, { date: r.date, time: r.time });
      }
    } catch {
      /* skip that day */
    }
  });
  if (found.size) {
    earnings.clear();
    for (const [k, v] of found) earnings.set(k, v);
    earningsAt = Date.now();
    for (const row of state.rows.values()) recompute(row);
    markDirty();
  }
}

// ---------------------------------------------------------------------------------
// Enrichment: analyst, short-interest and ownership data (one symbol at a time, slow)
// ---------------------------------------------------------------------------------

const ENRICH_TTL = 7 * DAY;

export async function enrichSymbol(sym: string): Promise<Enrichment> {
  const [sum, tgt, fc, si, inst, ins] = await Promise.all([
    nasdaq.summary(sym).catch(() => null),
    nasdaq.targetPrice(sym).catch(() => null),
    nasdaq.earningsForecast(sym).catch(() => null),
    nasdaq.shortInterest(sym).catch(() => null),
    nasdaq.institutional(sym, 1).catch(() => null),
    nasdaq.insiderTrades(sym, 1).catch(() => null),
  ]);
  const votes = tgt ? tgt.buy + tgt.hold + tgt.sell : 0;
  // Nasdaq groups ratings into buy / hold / sell; map them onto the usual 1 (strong buy) - 5 (strong sell) scale.
  const recom = tgt && votes > 0 ? (tgt.buy * 1.5 + tgt.hold * 3 + tgt.sell * 4.5) / votes : null;
  const yearly = (fc?.yearly ?? []).filter((y) => y.eps != null);
  const e: Enrichment = {
    t: Date.now(),
    target: tgt?.mean ?? sum?.target ?? null,
    dividend: sum?.dividend ?? null,
    yield: sum?.yield ?? null,
    recom,
    epsThisFy: yearly[0]?.eps ?? null,
    epsNextFy: yearly[1]?.eps ?? null,
    shortShares: si?.shares ?? null,
    shortRatio: si?.daysToCover ?? null,
    instOwn: inst?.pct ?? null,
    instTrans: inst && isNum(inst.increasedShares) && isNum(inst.decreasedShares) && isNum(inst.sharesHeld) && inst.sharesHeld > 0 ? (inst.increasedShares - inst.decreasedShares) / inst.sharesHeld : null,
    insiderNetShares12m: ins && (isNum(ins.sharesBought12m) || isNum(ins.sharesSold12m)) ? (ins.sharesBought12m ?? 0) - (ins.sharesSold12m ?? 0) : null,
  };
  enrichment.set(sym, e);
  const row = state.rows.get(sym);
  if (row) recompute(row);
  return e;
}

async function enrichBatch(max: number): Promise<number> {
  const rows = [...state.rows.values()].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const todo = rows.filter((r) => {
    const e = enrichment.get(r.symbol);
    return !e || Date.now() - e.t > ENRICH_TTL;
  });
  state.status.enrichment.total = rows.length;
  state.status.enrichment.done = rows.length - todo.length;
  let n = 0;
  for (const r of todo.slice(0, max)) {
    try {
      await enrichSymbol(r.symbol);
    } catch {
      enrichment.set(r.symbol, { t: Date.now() - ENRICH_TTL + DAY, target: null, dividend: null, yield: null, recom: null, epsThisFy: null, epsNextFy: null, shortShares: null, shortRatio: null, instOwn: null, instTrans: null, insiderNetShares12m: null });
    }
    n++;
    state.status.enrichment.done++;
    await sleep(350); // keep this crawl gentle: roughly two symbols a second at most
  }
  if (n) markDirty();
  return n;
}

// ---------------------------------------------------------------------------------
// Persistence of the side tables + background loops
// ---------------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';

const sideFile = () => path.join(config.dataDir, 'universe', 'side.json');

async function saveSide(): Promise<void> {
  await fs.mkdir(path.dirname(sideFile()), { recursive: true });
  const tmp = `${sideFile()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ enrichment: [...enrichment.entries()], earnings: [...earnings.entries()], earningsAt, floatRef: [...floatRef.entries()] }));
  await fs.rename(tmp, sideFile());
}

async function loadSide(): Promise<void> {
  try {
    const p = JSON.parse(await fs.readFile(sideFile(), 'utf8'));
    for (const [k, v] of p.enrichment ?? []) enrichment.set(k, v);
    for (const [k, v] of p.earnings ?? []) earnings.set(k, v);
    for (const [k, v] of p.floatRef ?? []) floatRef.set(k, v);
    earningsAt = p.earningsAt ?? 0;
  } catch {
    /* first run */
  }
}

function loop(name: string, everyMs: () => number, fn: () => Promise<void>) {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      noteError(`${name}: ${(err as Error).message}`);
    }
    setTimeout(run, everyMs()).unref?.();
  };
  void run();
}

let started = false;

export async function startUniverse(): Promise<void> {
  if (started) return;
  started = true;
  await loadEntities();
  const had = await loadSnapshot();
  await loadSide();
  if (had) {
    linkEntities();
    for (const row of state.rows.values()) recompute(row);
    state.status.stage = 'ready (cached)';
  }
  if (!config.background) {
    state.status.stage = had ? 'ready (background refresh disabled)' : 'no data (background refresh disabled)';
    return;
  }

  // Quotes first so the screener is usable within seconds, then the slower layers.
  (async () => {
    try {
      state.status.stage = 'loading quotes';
      await refreshQuotes();
      state.status.stage = 'loading fundamentals';
      if (Date.now() - state.fundamentalsAt > 20 * HOUR) await refreshFundamentals();
      else linkEntities();
      await saveSnapshot(true);
    } catch (err) {
      noteError(`startup: ${(err as Error).message}`);
    }
    state.status.stage = 'ready';

    // The listing is end-of-day data, so a slow cadence is enough to catch its evening refresh.
    loop('quotes', () => 10 * MIN, async () => {
      if (Date.now() - state.quotesAt > 20 * MIN) await refreshQuotes();
    });
    loop('fundamentals', () => HOUR, async () => {
      if (Date.now() - state.fundamentalsAt > 24 * HOUR) await refreshFundamentals();
    });
    loop('technicals', () => 5 * MIN, refreshTechnicals);
    if (config.liveQuotes) loop('live quotes', () => 30_000, liveSweep);
    loop('optionable', () => 5_000, optionableTrickle);
    loop('earnings', () => HOUR, refreshEarnings);
    if (config.enrich) {
      loop('enrichment', () => 20_000, async () => {
        // Wait for the price history crawl so the two do not compete for the same host.
        if (state.status.technicals.total && state.status.technicals.done < state.status.technicals.total * 0.98) return;
        await enrichBatch(40);
      });
    }
    loop('save', () => 2 * MIN, async () => {
      await saveSnapshot();
      await saveSide();
    });
  })();
}

export { state };
