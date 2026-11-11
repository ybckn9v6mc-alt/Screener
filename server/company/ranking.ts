import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';
import { mapLimit } from '../lib/http.ts';
import { DAY, HOUR } from '../lib/cache.ts';
import { cagr, isNum, ymd, daysBetween } from '../lib/util.ts';
import { state, markDirty, noteError } from '../universe/store.ts';
import { companyFinancialsCore } from './financials.ts';
import { analyse, autoScore, capexLooksIncomplete, capexMissing, priceSuggestions, isSpecialistSector, DATA_QUESTION_IDS } from '../../shared/analysis.ts';
import { dcf, type DcfInputs } from '../../shared/valuation.ts';
import { QUESTIONS, type Answer } from '../../shared/checklist.ts';
import type { StockRow } from '../../shared/types.ts';

/**
 * Front-page ranking: the companies that score highest on the part of the
 * Buffett checklist that financial data can answer.
 *
 * Each eligible company is analysed with exactly the same code as its own
 * checklist page (shared/analysis.ts). The slow part - loading its statements
 * from the SEC - happens once per company and again only when it reports new
 * results; the two price-dependent answers are refreshed from the live price
 * every time the ranking is read.
 */

export const MIN_CAP = 2e9;
/** Analyse a little below the floor so a company crossing it is ranked straight away. */
const ANALYSE_CAP = 1.6e9;
const MIN_YEARS = 4;
const MAX_STATEMENT_AGE_DAYS = 500;

interface Base {
  symbol: string;
  cik: number;
  /** The universe's "fundamentals as of" date when this was computed; a new date means new filings. */
  rowAsOf: string | null;
  computedAt: number;
  /** No US-GAAP statements (typically an IFRS filer): nothing to score. */
  none?: boolean;
  fyEnd: string | null;
  fyLabel: string | null;
  years: number;
  inputs: Omit<DcfInputs, 'price'>;
  ownerEarningsBasis: string;
  ownerEarningsWhy: string;
  growthWhy: string;
  shareBasis: 'filings' | 'market' | 'none';
  shareBasisNote: string | null;
  /** The share count the per-share inputs were built on. */
  sharesUsed: number | null;
  /** A stock split inside the five scored years was restated. */
  splitAdjusted: number | null;
  /** Capital spending is missing or implausibly small, so cash flow cannot be scored or valued. */
  capexUnknown?: boolean;
  /** Free cash flow for the screener row: trailing twelve months when available, else the latest fiscal year. */
  fcf: number | null;
  /** The statements did not yet include the period the screener data is dated; look again at retryAt. */
  behind?: boolean;
  retryAt?: number;
  retries?: number;
  /** Latest balance-sheet figures from the company's own statements, for the screener row. */
  balance?: { debt: number | null; cash: number | null; equity: number | null; roic: number | null };
  /** The twelve data answers that do not depend on today's price. */
  answers: Record<string, { a: Answer; reason: string }>;
  metrics: {
    avgRoic: number | null;
    avgRoe: number | null;
    positiveFcfYears: number | null;
    netDebtEbitda: number | null;
    fcfToNi: number | null;
    shareChange: number | null;
    ebitToInterest: number | null;
    revCagr: number | null;
    fcfCagr: number | null;
    /** Fiscal years (of the five scored) that have a free-cash-flow figure. */
    fcfYears?: number;
    grossMargin: number | null;
    operMargin: number | null;
    quantPass: number;
    quantWithData: number;
    epsGrowth3y: number | null;
    epsGrowth5y: number | null;
  };
}

const bases = new Map<string, Base>();
const FILE = () => path.join(config.dataDir, 'universe', 'ranking-v4.json');
let dirty = false;

export async function loadRanking(): Promise<void> {
  try {
    const list = JSON.parse(await fs.readFile(FILE(), 'utf8')) as Base[];
    for (const b of list) bases.set(b.symbol, b);
  } catch {
    /* first run */
  }
}

export async function saveRanking(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const file = FILE();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify([...bases.values()]));
  await fs.rename(tmp, file);
}

const eligible = (r: StockRow) => r.type !== 'other' && r.cik != null && Boolean(r.fundamentalsAsOf) && isNum(r.marketCap) && r.marketCap > ANALYSE_CAP && !isSpecialistSector(r.sector, r.sic);

/** Listed shares implied by market value and price. */
const marketShares = (r: StockRow) => (isNum(r.marketCap) && isNum(r.price) && r.price > 0 ? r.marketCap / r.price : null);

/** The share count has moved by more than 15% since the statements were analysed (a split, usually). */
function sharesDiverged(b: Base, r: StockRow): boolean {
  const ms = marketShares(r);
  return ms != null && isNum(b.sharesUsed) && b.sharesUsed > 0 && Math.abs(ms / b.sharesUsed - 1) > 0.15;
}

/**
 * When to look at a company's filings again because they lag the screener's data. A company
 * gets three further looks, twelve hours apart, for each reporting date; a new reporting
 * date starts a new round. Only a look that was itself one of those retries uses one up, so
 * routine refreshes and share-count re-reads do not exhaust the round.
 */
export function nextRetry(behind: boolean, prev: { rowAsOf: string | null; retries?: number } | undefined, rowAsOf: string | null, wasRetry: boolean, now: number): { retryAt?: number; retries: number } {
  if (!behind) return { retries: 0 };
  const sameRound = prev != null && prev.rowAsOf === rowAsOf;
  const retries = sameRound ? (prev.retries ?? 0) + (wasRetry ? 1 : 0) : 0;
  return retries < 3 ? { retryAt: now + 12 * HOUR, retries } : { retries };
}

async function analyseRow(r: StockRow, refetch: boolean, prev?: Base, wasRetry = false): Promise<Base> {
  const empty = (): Base => ({
    symbol: r.symbol, cik: r.cik as number, rowAsOf: r.fundamentalsAsOf ?? null, computedAt: Date.now(), none: true, fyEnd: null, fyLabel: null, years: 0,
    inputs: { ownerEarnings: null, marginOfSafety: 0.25, discountRate: 0.1, growth1to5: 0.05, growth6to10: 0.03, terminalGrowth: 0.02 },
    ownerEarningsBasis: '', ownerEarningsWhy: '', growthWhy: '', shareBasis: 'none', shareBasisNote: null, sharesUsed: null, splitAdjusted: null, fcf: null, answers: {},
    metrics: { avgRoic: null, avgRoe: null, positiveFcfYears: null, netDebtEbitda: null, fcfToNi: null, shareChange: null, ebitToInterest: null, revCagr: null, fcfCagr: null, grossMargin: null, operMargin: null, quantPass: 0, quantWithData: 0, epsGrowth3y: null, epsGrowth5y: null },
  });
  // A company that has reported since the last look gets a fresh download; otherwise a copy up to a month old will do.
  const fin = await companyFinancialsCore(r.cik as number, refetch ? 6 * HOUR : 30 * DAY, true);
  if (!fin || !fin.annual.periods.length) return empty();
  const a = analyse({ fin, price: r.price, marketCap: r.marketCap, sector: r.sector, industry: r.industry });
  const n = fin.annual.periods.length;
  const answers: Base['answers'] = {};
  for (const id of DATA_QUESTION_IDS) {
    if (id === 'v3' || id === 'v4') continue;
    const s = a.suggestions[id];
    answers[id] = { a: s?.answer ?? '', reason: s?.reason ?? '' };
  }
  const { price: _price, ...inputs } = a.inputs;
  void _price;
  const eps = fin.annual.values.eps ?? [];
  const chosen = a.defaults?.options.find((o) => o.id === a.defaults?.chosen);
  // The screener's bulk data said the company has reported up to fundamentalsAsOf. If its own filing
  // history does not reach that date yet, the download was too early: look again in half a day.
  const latest = [fin.annual.periods[n - 1].end, fin.quarterly.periods.at(-1)?.end ?? '', fin.ttm?.period.end ?? ''].sort().at(-1) as string;
  const behind = Boolean(r.fundamentalsAsOf) && daysBetween(latest, r.fundamentalsAsOf as string) > 10;
  const thin = capexLooksIncomplete(fin);
  // Latest known balance-sheet figures: the newest quarter where it can be read, else the fiscal year-end.
  const t = fin.ttm?.values;
  const last = (k: string) => fin.annual.values[k]?.[n - 1] ?? null;
  const latestOf = (k: string) => (t && isNum(t[k]) ? t[k] : last(k));
  return {
    behind,
    ...nextRetry(behind, prev, r.fundamentalsAsOf ?? null, wasRetry, Date.now()),
    sharesUsed: a.defaults?.sharesUsed ?? null,
    capexUnknown: capexMissing(fin) || thin,
    // A free-cash-flow figure built on implausibly small capital spending is not shown.
    fcf: thin ? null : (t?.fcf ?? last('fcf')),
    balance: { debt: latestOf('totalDebt'), cash: latestOf('cash'), equity: latestOf('equity'), roic: latestOf('roic') },
    symbol: r.symbol,
    cik: r.cik as number,
    rowAsOf: r.fundamentalsAsOf ?? null,
    computedAt: Date.now(),
    fyEnd: fin.annual.periods[n - 1].end,
    fyLabel: fin.annual.periods[n - 1].label,
    years: a.summary?.yearsEntered ?? 0,
    inputs,
    ownerEarningsBasis: chosen?.label ?? '',
    ownerEarningsWhy: a.defaults?.ownerEarningsWhy ?? '',
    growthWhy: a.defaults?.growthWhy ?? '',
    shareBasis: a.defaults?.shareBasis ?? 'none',
    shareBasisNote: a.defaults?.shareBasisNote ?? null,
    splitAdjusted: fin.splitAdjustedRecent ?? null,
    answers,
    metrics: {
      avgRoic: a.summary?.avgRoic ?? null,
      avgRoe: a.summary?.avgRoe ?? null,
      positiveFcfYears: a.summary?.positiveFcfYears ?? null,
      netDebtEbitda: a.summary?.netDebtEbitda ?? null,
      fcfToNi: a.summary?.fcfToNi ?? null,
      shareChange: a.summary?.shareChange ?? null,
      ebitToInterest: a.summary?.ebitToInterest ?? null,
      revCagr: a.summary?.revCagr ?? null,
      fcfCagr: a.summary?.fcfCagr ?? null,
      fcfYears: a.summary?.fcfYears ?? 0,
      grossMargin: fin.annual.values.grossMargin?.[n - 1] ?? null,
      operMargin: fin.annual.values.operMargin?.[n - 1] ?? null,
      quantPass: a.tests.filter((t) => t.result === 'PASS').length,
      quantWithData: a.tests.filter((t) => t.result !== 'NO DATA').length,
      // Split-adjusted EPS history, which the bulk screener data cannot provide.
      epsGrowth3y: n > 3 ? cagr(eps[n - 4], eps[n - 1], 3) : null,
      epsGrowth5y: n > 5 ? cagr(eps[n - 6], eps[n - 1], 5) : null,
    },
  };
}

let running = false;

export async function refreshRanking(): Promise<void> {
  if (running || !state.rows.size || !state.funds.size) return;
  running = true;
  try {
    const rows = [...state.rows.values()].filter(eligible).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    const now = Date.now();
    const todo = rows.filter((r) => {
      const b = bases.get(r.symbol);
      if (!b || b.rowAsOf !== (r.fundamentalsAsOf ?? null) || now - b.computedAt > 14 * DAY) return true;
      if (b.none) return false;
      return (b.retryAt != null && now > b.retryAt) || sharesDiverged(b, r);
    });
    state.status.ranking = { done: rows.length - todo.length, total: rows.length };
    if (todo.length) {
      let failures = 0;
      await mapLimit(todo, 3, async (r) => {
        const prev = bases.get(r.symbol);
        try {
          const wasRetry = prev != null && prev.rowAsOf === (r.fundamentalsAsOf ?? null) && prev.retryAt != null && now > prev.retryAt;
          // A new reporting date, a retry, or a previous look that lagged the screener's data: download again.
          const fresh = prev != null && (prev.rowAsOf !== (r.fundamentalsAsOf ?? null) || wasRetry || prev.behind === true);
          bases.set(r.symbol, await analyseRow(r, fresh, prev, wasRetry));
          dirty = true;
          applyRanking(r);
        } catch (err) {
          if (failures++ < 3) noteError(`checklist analysis ${r.symbol}: ${(err as Error).message}`);
        }
        (state.status.ranking as { done: number }).done++;
      });
      markDirty();
    }
    // Forget companies that left the universe or dropped well below the size floor.
    const keep = new Set(rows.map((r) => r.symbol));
    for (const sym of bases.keys()) {
      if (!keep.has(sym)) {
        bases.delete(sym);
        dirty = true;
      }
    }
    refreshRanks();
  } finally {
    running = false;
  }
}

interface Live {
  inputs: DcfInputs;
  result: ReturnType<typeof dcf>;
  answers: Record<string, { a: Answer; reason: string }>;
  score: ReturnType<typeof autoScore>;
}

function live(b: Base, row: StockRow): Live {
  // After a split the stored per-share figure is on the old share count until the statements are
  // re-read: keep the company's total owner earnings and spread them over today's shares.
  let oe = b.inputs.ownerEarnings;
  if (isNum(oe) && sharesDiverged(b, row)) oe = Math.round(((oe * (b.sharesUsed as number)) / (marketShares(row) as number)) * 100) / 100;
  const inputs: DcfInputs = { ...b.inputs, ownerEarnings: oe, price: row.price };
  const result = dcf(inputs);
  const ps = priceSuggestions(inputs, result);
  const answers: Record<string, { a: Answer; reason: string }> = { ...b.answers, v3: { a: ps.v3.answer, reason: ps.v3.reason }, v4: { a: ps.v4.answer, reason: ps.v4.reason } };
  const flat: Record<string, Answer> = {};
  for (const id of DATA_QUESTION_IDS) flat[id] = answers[id]?.a ?? '';
  return { inputs, result, answers, score: autoScore(flat) };
}

/** Copy the checklist figures onto a screener row (called whenever the row's price changes). */
export function applyRanking(row: StockRow): void {
  const b = bases.get(row.symbol);
  if (!b || b.none) {
    row.buffettScore = null;
    row.buffettPoints = null;
    row.buffettGates = null;
    row.intrinsicValue = null;
    row.buyBelow = null;
    row.valueDiscount = null;
    return;
  }
  const l = live(b, row);
  row.buffettScore = l.score.max ? l.score.points / l.score.max : null;
  row.buffettPoints = l.score.points;
  row.buffettGates = l.score.gatesFailed.length ? 'fail' : 'pass';
  row.intrinsicValue = l.result.intrinsicValue;
  row.buyBelow = l.result.buyBelow;
  row.valueDiscount = l.result.discountToValue;
  // Prefer the split-adjusted growth figures from the company's own filing history.
  if (b.metrics.epsGrowth3y != null) row.epsGrowth3y = b.metrics.epsGrowth3y;
  if (b.metrics.epsGrowth5y != null) row.epsGrowth5y = b.metrics.epsGrowth5y;
  // Free cash flow from the company's own cash-flow statement (every capital-spending line, not just the common one).
  row.fcf = b.fcf;
  row.pfcf = isNum(b.fcf) && b.fcf > 0 && isNum(row.marketCap) ? row.marketCap / b.fcf : null;
  // Debt-based figures likewise: the bulk data reads only the commonest debt captions.
  if (b.balance) {
    const { debt, cash, equity, roic } = b.balance;
    row.debtEq = isNum(debt) && isNum(equity) && equity > 0 ? debt / equity : null;
    if (!isNum(row.debtEq)) row.ltDebtEq = null;
    else if (isNum(row.ltDebtEq) && row.ltDebtEq > row.debtEq) row.ltDebtEq = row.debtEq;
    row.roic = roic;
    row.ev = isNum(row.marketCap) && isNum(debt) && isNum(cash) ? row.marketCap + debt - cash : null;
    row.evEbitda = isNum(row.ev) && isNum(row.ebitda) && row.ebitda > 0 ? row.ev / row.ebitda : null;
    row.evSales = isNum(row.ev) && isNum(row.revenue) && row.revenue > 0 ? row.ev / row.revenue : null;
  }
}

export interface RankItem {
  symbol: string;
  cik: number;
  points: number;
  discount: number | null;
  roic: number | null;
  /** Dollar volume, to choose between two listings of the same company. */
  liquidity: number;
}

/**
 * The order of the ranking. One entry per company (where several share classes are listed, the
 * more heavily traded one), then by checklist points, by the larger discount to intrinsic value,
 * by the higher return on invested capital, and finally by ticker so the order is stable.
 */
export function rankOrder<T extends RankItem>(items: T[]): T[] {
  const byCik = new Map<number, T>();
  for (const c of items) {
    const cur = byCik.get(c.cik);
    if (!cur || c.liquidity > cur.liquidity || (c.liquidity === cur.liquidity && c.symbol < cur.symbol)) byCik.set(c.cik, c);
  }
  return [...byCik.values()].sort(
    (x, y) => y.points - x.points || (y.discount ?? -Infinity) - (x.discount ?? -Infinity) || (y.roic ?? -Infinity) - (x.roic ?? -Infinity) || (x.symbol < y.symbol ? -1 : 1),
  );
}

export interface TopEntry {
  rank: number;
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  type: StockRow['type'];
  marketCap: number | null;
  price: number | null;
  change: number | null;
  points: number;
  maxPoints: number;
  yes: number;
  no: number;
  uncertain: number;
  intrinsicValue: number | null;
  buyBelow: number | null;
  valueDiscount: number | null;
  upside: number | null;
  valuationStatus: string;
  ownerEarnings: number | null;
  ownerEarningsBasis: string;
  ownerEarningsYield: number | null;
  growth1to5: number;
  growth6to10: number;
  discountRate: number;
  marginOfSafety: number;
  pe: number | null;
  fyLabel: string | null;
  fyEnd: string | null;
  shareBasisNote: string | null;
  splitAdjusted: number | null;
  metrics: Base['metrics'];
  questions: { id: string; pillar: string; question: string; weight: number; gate: boolean; answer: Answer; reason: string }[];
}

export interface TopPayload {
  asOf: number;
  minCap: number;
  progress: { done: number; total: number };
  counts: { aboveFloor: number; financialOrRealEstate: number; noStatements: number; analysed: number; shortHistory: number; staleStatements: number; gateFailed: number; capexUnknown: number; noValuation: number; duplicateListings: number; ranked: number };
  maxPoints: number;
  questionCount: number;
  rows: TopEntry[];
  rules: string[];
}

let cache: { key: string; at: number; payload: TopPayload } | null = null;

export function buffettTop(limit = 10, minCap = MIN_CAP): TopPayload {
  const key = `${limit}|${minCap}`;
  if (cache && cache.key === key && Date.now() - cache.at < 60_000) return cache.payload;
  const today = ymd(new Date());
  const all = [...state.rows.values()].filter((r) => r.type !== 'other' && isNum(r.marketCap) && r.marketCap > minCap);
  const counts: TopPayload['counts'] = { aboveFloor: all.length, financialOrRealEstate: 0, noStatements: 0, analysed: 0, shortHistory: 0, staleStatements: 0, gateFailed: 0, capexUnknown: 0, noValuation: 0, duplicateListings: 0, ranked: 0 };
  const cands: (RankItem & { row: StockRow; b: Base; l: Live })[] = [];
  for (const row of all) {
    if (isSpecialistSector(row.sector, row.sic)) {
      counts.financialOrRealEstate++;
      continue;
    }
    const b = bases.get(row.symbol);
    if (!b || b.none || row.cik == null) {
      counts.noStatements++;
      continue;
    }
    counts.analysed++;
    if (b.years < MIN_YEARS) {
      counts.shortHistory++;
      continue;
    }
    if (!b.fyEnd || daysBetween(b.fyEnd, today) > MAX_STATEMENT_AGE_DAYS) {
      counts.staleStatements++;
      continue;
    }
    const l = live(b, row);
    if (l.score.gatesFailed.length) {
      counts.gateFailed++;
      continue;
    }
    if (!l.result.valid || !isNum(l.result.intrinsicValue)) {
      if (b.capexUnknown) counts.capexUnknown++;
      else counts.noValuation++;
      continue;
    }
    cands.push({ row, b, l, symbol: row.symbol, cik: b.cik, points: l.score.points, discount: l.result.discountToValue, roic: b.metrics.avgRoic, liquidity: (row.avgVolume ?? row.volume ?? 0) * (row.price ?? 0) });
  }
  const ranked = rankOrder(cands);
  counts.duplicateListings = cands.length - ranked.length;
  counts.ranked = ranked.length;
  if (minCap === MIN_CAP) {
    // Publish the order on the screener rows, so the screener can show exactly this ranking.
    for (const r of state.rows.values()) r.buffettRank = null;
    ranked.forEach((c, i) => {
      c.row.buffettRank = i + 1;
    });
  }
  const qById = new Map(QUESTIONS.map((q) => [q.id, q]));
  const rows: TopEntry[] = ranked.slice(0, Math.max(1, Math.min(50, limit))).map(({ row, b, l }, i) => ({
    rank: i + 1,
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    type: row.type,
    marketCap: row.marketCap,
    price: row.price,
    change: row.change,
    points: l.score.points,
    maxPoints: l.score.max,
    yes: l.score.yes,
    no: l.score.no,
    uncertain: l.score.uncertain,
    intrinsicValue: l.result.intrinsicValue,
    buyBelow: l.result.buyBelow,
    valueDiscount: l.result.discountToValue,
    upside: l.result.upside,
    valuationStatus: l.result.status,
    ownerEarnings: l.inputs.ownerEarnings,
    ownerEarningsBasis: b.ownerEarningsBasis,
    ownerEarningsYield: isNum(l.inputs.ownerEarnings) && isNum(row.price) && row.price > 0 ? l.inputs.ownerEarnings / row.price : null,
    growth1to5: b.inputs.growth1to5,
    growth6to10: b.inputs.growth6to10,
    discountRate: b.inputs.discountRate,
    marginOfSafety: b.inputs.marginOfSafety,
    pe: row.pe ?? null,
    fyLabel: b.fyLabel,
    fyEnd: b.fyEnd,
    shareBasisNote: b.shareBasisNote,
    splitAdjusted: b.splitAdjusted,
    metrics: b.metrics,
    questions: DATA_QUESTION_IDS.map((id) => {
      const q = qById.get(id)!;
      return { id, pillar: q.pillar, question: q.question, weight: q.weight, gate: q.gate, answer: l.answers[id]?.a ?? '', reason: l.answers[id]?.reason ?? '' };
    }),
  }));
  const max = QUESTIONS.filter((q) => DATA_QUESTION_IDS.includes(q.id)).reduce((s, q) => s + q.weight, 0);
  const payload: TopPayload = {
    asOf: Date.now(),
    minCap,
    progress: state.status.ranking ?? { done: 0, total: 0 },
    counts,
    maxPoints: max,
    questionCount: DATA_QUESTION_IDS.length,
    rows,
    rules: [
      `Universe: US-listed companies with a market value above $${(minCap / 1e9).toFixed(0)} billion that file US-GAAP statements with the SEC. Banks, insurers, other financials and real-estate companies are left out, because the workbook treats them as needing specialist analysis.`,
      `Score: of the checklist's 34 questions, ${DATA_QUESTION_IDS.length} can be answered from financial data alone. Each Yes earns the question's workbook weight, for a maximum of ${max} points. The other ${QUESTIONS.length - DATA_QUESTION_IDS.length} questions (understanding the business, the moat, management, governance) need your judgment and are not scored here, so a high rank is a shortlist for research, not a verdict.`,
      'A company is dropped if the data answers No to a required gate (recurring owner cash, conservative leverage, an estimable owner-earnings figure), if it has fewer than four fiscal years of statements, if its latest statements are more than about 16 months old, or if the valuation model cannot run because owner earnings are not positive.',
      'Missing data is never treated as good news. If a company’s filings do not show its capital spending for the latest year in a form this app can read, or show implausibly little of it, its free cash flow is unknown and it is not ranked (a gap in an earlier year only shortens the record the cash-flow questions are judged on). If its borrowings cannot be read, or the figure read is contradicted by its interest bill or its balance sheet, leverage and return on capital are left unanswered and earn no points.',
      'Ties are broken by the larger discount to intrinsic value, then by the higher five-year return on invested capital.',
      'Intrinsic value is the workbook’s 10-year owner-earnings model with automatic, conservative inputs: the lowest of the three-year-average, latest-year and trailing-twelve-month figures for free cash flow and owner earnings; growth at three-quarters of the most cautious reading of past growth (never above revenue growth, capped at 10%); a 10% discount rate, 2% perpetual growth and a 25% margin of safety. Open a company to see and change every input.',
      'Each company is analysed with the same code as its own checklist page, using default thresholds, so the two always agree. Prices are delayed quotes; statements are refreshed when a company reports.',
    ],
  };
  cache = { key, at: Date.now(), payload };
  return payload;
}

export const rankingSize = () => bases.size;

/** Recompute the order now (prices move), bypassing the short-lived cache. */
export function refreshRanks(): void {
  cache = null;
  buffettTop(10, MIN_CAP);
}
