import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.ts';
import { mapLimit } from '../lib/http.ts';
import { DAY, HOUR } from '../lib/cache.ts';
import { cagr, isNum, ymd, daysBetween } from '../lib/util.ts';
import { state, markDirty, noteError } from '../universe/store.ts';
import { companyFinancialsCore } from './financials.ts';
import { analyse, autoScore, priceSuggestions, isSpecialistSector, DATA_QUESTION_IDS } from '../../shared/analysis.ts';
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
  splitAdjusted: number | null;
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
    grossMargin: number | null;
    operMargin: number | null;
    quantPass: number;
    quantWithData: number;
    epsGrowth3y: number | null;
    epsGrowth5y: number | null;
  };
}

const bases = new Map<string, Base>();
const FILE = () => path.join(config.dataDir, 'universe', 'ranking-v2.json');
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

async function analyseRow(r: StockRow, refetch: boolean): Promise<Base> {
  const empty = (): Base => ({
    symbol: r.symbol, cik: r.cik as number, rowAsOf: r.fundamentalsAsOf ?? null, computedAt: Date.now(), none: true, fyEnd: null, fyLabel: null, years: 0,
    inputs: { ownerEarnings: null, marginOfSafety: 0.25, discountRate: 0.1, growth1to5: 0.05, growth6to10: 0.03, terminalGrowth: 0.02 },
    ownerEarningsBasis: '', ownerEarningsWhy: '', growthWhy: '', shareBasis: 'none', shareBasisNote: null, splitAdjusted: null, answers: {},
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
  return {
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
    splitAdjusted: fin.splitAdjusted ?? null,
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
      return !b || b.rowAsOf !== (r.fundamentalsAsOf ?? null) || now - b.computedAt > 14 * DAY;
    });
    state.status.ranking = { done: rows.length - todo.length, total: rows.length };
    if (todo.length) {
      let failures = 0;
      await mapLimit(todo, 3, async (r) => {
        const prev = bases.get(r.symbol);
        try {
          bases.set(r.symbol, await analyseRow(r, prev != null && prev.rowAsOf !== (r.fundamentalsAsOf ?? null)));
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
    cache = null;
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

function live(b: Base, price: number | null): Live {
  const inputs: DcfInputs = { ...b.inputs, price };
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
  const l = live(b, row.price);
  row.buffettScore = l.score.max ? l.score.points / l.score.max : null;
  row.buffettPoints = l.score.points;
  row.buffettGates = l.score.gatesFailed.length ? 'fail' : 'pass';
  row.intrinsicValue = l.result.intrinsicValue;
  row.buyBelow = l.result.buyBelow;
  row.valueDiscount = l.result.discountToValue;
  // Prefer the split-adjusted growth figures from the company's own filing history.
  if (b.metrics.epsGrowth3y != null) row.epsGrowth3y = b.metrics.epsGrowth3y;
  if (b.metrics.epsGrowth5y != null) row.epsGrowth5y = b.metrics.epsGrowth5y;
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
  counts: { aboveFloor: number; financialOrRealEstate: number; noStatements: number; analysed: number; shortHistory: number; staleStatements: number; gateFailed: number; noValuation: number; ranked: number };
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
  const counts: TopPayload['counts'] = { aboveFloor: all.length, financialOrRealEstate: 0, noStatements: 0, analysed: 0, shortHistory: 0, staleStatements: 0, gateFailed: 0, noValuation: 0, ranked: 0 };
  const cands: { row: StockRow; b: Base; l: Live }[] = [];
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
    const l = live(b, row.price);
    if (l.score.gatesFailed.length) {
      counts.gateFailed++;
      continue;
    }
    if (!l.result.valid || !isNum(l.result.intrinsicValue)) {
      counts.noValuation++;
      continue;
    }
    cands.push({ row, b, l });
  }
  // One entry per company: where several share classes are listed, keep the more heavily traded one.
  const byCik = new Map<number, { row: StockRow; b: Base; l: Live }>();
  for (const c of cands) {
    const cur = byCik.get(c.b.cik);
    const liquidity = (r: StockRow) => (r.avgVolume ?? r.volume ?? 0) * (r.price ?? 0);
    if (!cur || liquidity(c.row) > liquidity(cur.row) || (liquidity(c.row) === liquidity(cur.row) && c.row.symbol < cur.row.symbol)) byCik.set(c.b.cik, c);
  }
  const ranked = [...byCik.values()].sort(
    (x, y) =>
      y.l.score.points - x.l.score.points ||
      (y.l.result.discountToValue ?? -Infinity) - (x.l.result.discountToValue ?? -Infinity) ||
      (y.b.metrics.avgRoic ?? -Infinity) - (x.b.metrics.avgRoic ?? -Infinity) ||
      (x.row.symbol < y.row.symbol ? -1 : 1),
  );
  counts.ranked = ranked.length;
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
    ownerEarnings: b.inputs.ownerEarnings,
    ownerEarningsBasis: b.ownerEarningsBasis,
    ownerEarningsYield: isNum(b.inputs.ownerEarnings) && isNum(row.price) && row.price > 0 ? b.inputs.ownerEarnings / row.price : null,
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
      'Ties are broken by the larger discount to intrinsic value, then by the higher five-year return on invested capital.',
      'Intrinsic value is the workbook’s 10-year owner-earnings model with automatic, conservative inputs: the lowest of four owner-earnings estimates, growth at three-quarters of the historical rate capped at 12%, a 10% discount rate, 2% perpetual growth and a 25% margin of safety. Open a company to see and change every input.',
      'Each company is analysed with the same code as its own checklist page, using default thresholds, so the two always agree. Prices are delayed quotes; statements are refreshed when a company reports.',
    ],
  };
  cache = { key, at: Date.now(), payload };
  return payload;
}

export const rankingSize = () => bases.size;
