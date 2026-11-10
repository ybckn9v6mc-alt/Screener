import * as sec from '../sources/sec.ts';
import { mapLimit } from '../lib/http.ts';
import { cagr, daysBetween, div, growth, isNum, ymd } from '../lib/util.ts';

/**
 * Fundamentals for every SEC filer at once, using the XBRL "frames" API: one
 * request returns one concept for one period across all companies. Income
 * statement items are turned into trailing-twelve-month figures (the fourth
 * fiscal quarter is derived as full year minus the three reported quarters);
 * cash-flow items use the latest fiscal year because 10-Q filings report them
 * year-to-date; balance-sheet items use the latest quarter end.
 */

interface Fact {
  s?: string;
  e: string;
  v: number;
  p: number; // tag priority (0 = preferred)
}

type Kind = 'flow' | 'annual' | 'instant';

interface Concept {
  kind: Kind;
  unit: string;
  tax?: 'us-gaap' | 'dei';
  tags: string[];
  history?: boolean; // fetch extra annual history (for 3y / 5y growth)
}

const CONCEPTS: Record<string, Concept> = {
  revenue: { kind: 'flow', unit: 'USD', history: true, tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'RevenuesNetOfInterestExpense'] },
  costOfRevenue: { kind: 'flow', unit: 'USD', tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'] },
  grossProfit: { kind: 'flow', unit: 'USD', tags: ['GrossProfit'] },
  operatingIncome: { kind: 'flow', unit: 'USD', tags: ['OperatingIncomeLoss'] },
  pretax: { kind: 'flow', unit: 'USD', tags: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'] },
  netIncome: { kind: 'flow', unit: 'USD', history: true, tags: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'] },
  eps: { kind: 'flow', unit: 'USD-per-shares', history: true, tags: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'] },

  cfo: { kind: 'annual', unit: 'USD', tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] },
  capex: { kind: 'annual', unit: 'USD', tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'] },
  da: { kind: 'annual', unit: 'USD', tags: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation'] },
  tax: { kind: 'annual', unit: 'USD', tags: ['IncomeTaxExpenseBenefit'] },
  dividendsPaid: { kind: 'annual', unit: 'USD', tags: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'] },
  dps: { kind: 'annual', unit: 'USD-per-shares', tags: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'] },

  assets: { kind: 'instant', unit: 'USD', tags: ['Assets'] },
  currentAssets: { kind: 'instant', unit: 'USD', tags: ['AssetsCurrent'] },
  cash: { kind: 'instant', unit: 'USD', tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'] },
  stInvest: { kind: 'instant', unit: 'USD', tags: ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'] },
  inventory: { kind: 'instant', unit: 'USD', tags: ['InventoryNet'] },
  currentLiabilities: { kind: 'instant', unit: 'USD', tags: ['LiabilitiesCurrent'] },
  equity: { kind: 'instant', unit: 'USD', tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  ltDebtNoncurrent: { kind: 'instant', unit: 'USD', tags: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermNotesPayable', 'ConvertibleNotesPayableNoncurrent'] },
  ltDebtTotal: { kind: 'instant', unit: 'USD', tags: ['LongTermDebt', 'DebtLongtermAndShorttermCombinedAmount'] },
  ltDebtCurrent: { kind: 'instant', unit: 'USD', tags: ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent'] },
  stDebt: { kind: 'instant', unit: 'USD', tags: ['DebtCurrent', 'ShortTermBorrowings', 'CommercialPaper'] },
  publicFloat: { kind: 'instant', unit: 'USD', tax: 'dei', tags: ['EntityPublicFloat'] },
};

export interface Fundamentals {
  cik: number;
  name: string;
  asOf: string | null;
  basis: 'TTM' | 'FY' | null;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  epsFy: number | null;
  ebitda: number | null;
  fcf: number | null;
  cfo: number | null;
  dps: number | null;
  payout: number | null;
  dividendGrowth: number | null;
  epsGrowthQoq: number | null;
  epsGrowthTtm: number | null;
  epsGrowth3y: number | null;
  epsGrowth5y: number | null;
  salesGrowthQoq: number | null;
  salesGrowthTtm: number | null;
  salesGrowth3y: number | null;
  salesGrowth5y: number | null;
  grossMargin: number | null;
  operMargin: number | null;
  netMargin: number | null;
  roa: number | null;
  roe: number | null;
  roic: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  ltDebtEq: number | null;
  debtEq: number | null;
  equity: number | null;
  cashAndInvestments: number | null;
  debt: number | null;
  assets: number | null;
  balanceAsOf: string | null;
  publicFloat: { date: string; value: number } | null;
}

interface CikData {
  name: string;
  d: Record<string, Fact[]>;
  i: Record<string, Fact[]>;
}

function quarterKey(y: number, q: number): { y: number; q: number } {
  while (q < 1) {
    q += 4;
    y -= 1;
  }
  return { y, q };
}

function buildRequests(now: Date) {
  const y = now.getUTCFullYear();
  const curQ = Math.floor(now.getUTCMonth() / 3) + 1;
  const completed = (back: number) => quarterKey(y, curQ - 1 - back);
  const quarters = Array.from({ length: 12 }, (_, k) => completed(k)).map((k) => `CY${k.y}Q${k.q}`);
  const instants = Array.from({ length: 5 }, (_, k) => completed(k)).map((k) => `CY${k.y}Q${k.q}I`);
  const floatInstants = Array.from({ length: 7 }, (_, k) => completed(k)).map((k) => `CY${k.y}Q${k.q}I`);
  const annualRecent = [y, y - 1, y - 2].map((v) => `CY${v}`);
  const annualHistory = [y - 3, y - 4, y - 5, y - 6, y - 7].map((v) => `CY${v}`);

  const reqs: { concept: string; tax: 'us-gaap' | 'dei'; tag: string; unit: string; period: string; instant: boolean; p: number }[] = [];
  for (const [concept, c] of Object.entries(CONCEPTS)) {
    c.tags.forEach((tag, p) => {
      const add = (period: string, instant: boolean) => reqs.push({ concept, tax: c.tax ?? 'us-gaap', tag, unit: c.unit, period, instant, p });
      if (c.kind === 'instant') (concept === 'publicFloat' ? floatInstants : instants).forEach((per) => add(per, true));
      else {
        annualRecent.forEach((per) => add(per, false));
        if (c.kind === 'flow') quarters.forEach((per) => add(per, false));
        if (c.history) annualHistory.forEach((per) => add(per, false));
      }
    });
  }
  return reqs;
}

const addDays = (d: string, n: number) => ymd(new Date(Date.parse(d) + n * 86_400_000));
const span = (f: Fact) => (f.s ? daysBetween(f.s, f.e) + 1 : 0);
const isQuarter = (f: Fact) => span(f) >= 75 && span(f) <= 105;
const isAnnual = (f: Fact) => span(f) >= 340 && span(f) <= 380;

/** Unique by period end, preferring the highest-priority tag; oldest first. */
function dedupe(facts: Fact[]): Fact[] {
  const m = new Map<string, Fact>();
  for (const f of facts) {
    const cur = m.get(f.e);
    if (!cur || f.p < cur.p) m.set(f.e, f);
  }
  return [...m.values()].sort((a, b) => (a.e < b.e ? -1 : 1));
}

/** Reported quarters plus fourth quarters derived from the annual figure. */
function quarterSeries(facts: Fact[]): Fact[] {
  const Q = dedupe(facts.filter(isQuarter));
  const A = dedupe(facts.filter(isAnnual));
  const out = new Map(Q.map((q) => [q.e, q]));
  for (const a of A) {
    if (out.has(a.e)) continue;
    const lo = addDays(a.s as string, -7);
    const hi = addDays(a.e, 7);
    const inside = Q.filter((q) => (q.s as string) >= lo && q.e <= hi);
    if (inside.length !== 3) continue;
    const lastEnd = inside[2].e;
    const gap = daysBetween(lastEnd, a.e);
    if (gap < 75 || gap > 125) continue; // the missing quarter is not the last one
    out.set(a.e, { s: addDays(lastEnd, 1), e: a.e, v: a.v - inside.reduce((s, q) => s + q.v, 0), p: a.p });
  }
  return [...out.values()].sort((x, y) => (x.e < y.e ? -1 : 1));
}

interface Ttm {
  v: number;
  end: string;
  prev: number | null;
  lastQ: number;
  lastQYearAgo: number | null;
}

function ttmOf(qs: Fact[]): Ttm | null {
  const sumRun = (endIdx: number): number | null => {
    if (endIdx < 3) return null;
    const run = qs.slice(endIdx - 3, endIdx + 1);
    for (let i = 1; i < run.length; i++) {
      const gap = daysBetween(run[i - 1].e, run[i].s as string);
      if (gap < -6 || gap > 12) return null;
    }
    const total = daysBetween(run[0].s as string, run[3].e) + 1;
    if (total < 350 || total > 380) return null;
    return run.reduce((s, q) => s + q.v, 0);
  };
  const last = qs.length - 1;
  const v = sumRun(last);
  if (v == null) return null;
  return { v, end: qs[last].e, prev: sumRun(last - 4), lastQ: qs[last].v, lastQYearAgo: last >= 4 && Math.abs(daysBetween(qs[last - 4].e, qs[last].e) - 365) <= 20 ? qs[last - 4].v : null };
}

/** Try each tag on its own first so a derived Q4 never mixes two definitions. */
function ttmForConcept(facts: Fact[] | undefined): Ttm | null {
  if (!facts?.length) return null;
  const ps = [...new Set(facts.map((f) => f.p))].sort((a, b) => a - b);
  let best: Ttm | null = null;
  for (const p of ps) {
    const t = ttmOf(quarterSeries(facts.filter((f) => f.p === p)));
    if (t && (!best || t.end > best.end)) best = t;
  }
  const mixed = ttmOf(quarterSeries(facts));
  if (mixed && (!best || mixed.end > best.end)) best = mixed;
  return best;
}

const annualSeries = (facts: Fact[] | undefined) => (facts ? dedupe(facts.filter(isAnnual)) : []);
const latest = (facts: Fact[]) => (facts.length ? facts[facts.length - 1] : null);

function instantAt(facts: Fact[] | undefined, date: string): number | null {
  if (!facts) return null;
  let best: Fact | null = null;
  for (const f of facts) if (Math.abs(daysBetween(f.e, date)) <= 4 && (!best || f.p < best.p)) best = f;
  return best ? best.v : null;
}

const SPLIT_RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50];

/**
 * Bulk data carries one EPS figure per fiscal year, and years before a stock split are
 * never restated, so EPS appears to collapse at the split. Net income ÷ EPS gives the
 * share count each year was stated on; when it jumps between two years by a
 * conventional split ratio while profit did not move in step, the earlier years are
 * converted to the later basis. (Companies analysed individually get an exact
 * adjustment from their own restated filings instead.)
 */
function splitAdjustedEps(eps: Fact[], income: Fact[]): Fact[] {
  if (eps.length < 2) return eps;
  const niByEnd = new Map(income.map((f) => [f.e, f.v]));
  const out = eps.map((f) => ({ ...f }));
  let factor = 1;
  for (let i = out.length - 1; i > 0; i--) {
    const niNew = niByEnd.get(eps[i].e);
    const niOld = niByEnd.get(eps[i - 1].e);
    if (isNum(niNew) && isNum(niOld) && eps[i].v !== 0 && eps[i - 1].v !== 0) {
      const sharesNew = niNew / eps[i].v;
      const sharesOld = niOld / eps[i - 1].v;
      if (sharesNew > 0 && sharesOld > 0) {
        const jump = sharesNew / sharesOld;
        const snapped = SPLIT_RATIOS.find((r) => Math.abs(jump / r - 1) < 0.05) ?? (SPLIT_RATIOS.find((r) => Math.abs(jump * r - 1) < 0.05) ? 1 / (SPLIT_RATIOS.find((r) => Math.abs(jump * r - 1) < 0.05) as number) : null);
        // A merger or share issue moves profit along with the share count; a split does not.
        const profitMove = niOld > 0 && niNew > 0 ? Math.abs(Math.log(niNew / niOld)) : 0;
        if (snapped != null && profitMove < Math.abs(Math.log(jump)) * 0.6) factor *= snapped;
      }
    }
    out[i - 1].v = eps[i - 1].v / factor;
  }
  return out;
}

function nYearGrowth(series: Fact[], years: number): number | null {
  const last = latest(series);
  if (!last) return null;
  const target = Date.parse(last.e) - years * 365.25 * 86_400_000;
  const base = series.find((f) => Math.abs(Date.parse(f.e) - target) <= 40 * 86_400_000);
  return base ? cagr(base.v, last.v, years) : null;
}

function compute(cik: number, data: CikData, today: string): Fundamentals | null {
  const stale = (end: string | null | undefined) => !end || daysBetween(end, today) > 460;
  const flow = (concept: string) => {
    const t = ttmForConcept(data.d[concept]);
    const a = latest(annualSeries(data.d[concept]));
    if (t && !stale(t.end) && (!a || t.end >= a.e)) return { v: t.v, end: t.end, basis: 'TTM' as const, t };
    if (a && !stale(a.e)) return { v: a.v, end: a.e, basis: 'FY' as const, t: null };
    return null;
  };
  const fy = (concept: string) => {
    const a = latest(annualSeries(data.d[concept]));
    return a && !stale(a.e) ? a : null;
  };

  const rev = flow('revenue');
  const ni = flow('netIncome');
  const eps = flow('eps');
  const op = flow('operatingIncome');
  const gp = flow('grossProfit');
  const cor = flow('costOfRevenue');
  const pre = flow('pretax');

  const balanceDate = latest(dedupe(data.i.assets ?? []))?.e ?? null;
  const bal = (concept: string) => (balanceDate && !stale(balanceDate) ? instantAt(data.i[concept], balanceDate) : null);
  if (!rev && !ni && !balanceDate) return null;

  const revenue = rev?.v ?? null;
  const netIncome = ni?.v ?? null;
  const operatingIncome = op?.v ?? null;
  // Use a gross-profit figure only when it covers the same period as revenue.
  let grossProfit: number | null = null;
  if (rev && gp && gp.end === rev.end && gp.basis === rev.basis) grossProfit = gp.v;
  else if (rev && cor && cor.end === rev.end && cor.basis === rev.basis) grossProfit = rev.v - cor.v;

  const cfo = fy('cfo')?.v ?? null;
  const capexRaw = fy('capex')?.v ?? null;
  const fcf = isNum(cfo) ? cfo - Math.abs(capexRaw ?? 0) : null;
  const da = fy('da')?.v ?? null;
  const ebitda = isNum(operatingIncome) && isNum(da) ? operatingIncome + da : null;

  const assets = bal('assets');
  const equity = bal('equity');
  const cash = bal('cash');
  const stInvest = bal('stInvest');
  const currentAssets = bal('currentAssets');
  const currentLiabilities = bal('currentLiabilities');
  const inventory = bal('inventory');
  const ltNon = bal('ltDebtNoncurrent');
  const ltTotal = bal('ltDebtTotal');
  const ltCur = bal('ltDebtCurrent');
  const st = bal('stDebt');
  let ltDebt: number | null = null;
  if (ltNon != null) ltDebt = ltNon;
  else if (ltTotal != null) ltDebt = Math.max(0, ltTotal - (ltCur ?? 0));
  const debtKnown = ltNon != null || ltTotal != null || ltCur != null || st != null;
  const debt = debtKnown ? (ltNon != null ? ltNon + (ltCur ?? 0) : ltTotal ?? ltCur ?? 0) + (st ?? 0) : null;

  const taxFact = fy('tax');
  const preFy = latest(annualSeries(data.d.pretax));
  let taxRate = 0.21;
  if (taxFact && preFy && preFy.e === taxFact.e && preFy.v > 0) taxRate = Math.min(0.35, Math.max(0, taxFact.v / preFy.v));
  const invested = isNum(equity) && isNum(debt) ? equity + debt : null;
  const roic = isNum(operatingIncome) && isNum(invested) && invested > 0 ? (operatingIncome * (1 - taxRate)) / invested : null;

  const dpsSeries = annualSeries(data.d.dps);
  const dpsFact = latest(dpsSeries);
  const dps = dpsFact && !stale(dpsFact.e) ? dpsFact.v : null;
  const dpsPrev = dpsSeries.length >= 2 ? dpsSeries[dpsSeries.length - 2].v : null;
  const epsFy = fy('eps')?.v ?? null;
  const divPaid = fy('dividendsPaid')?.v ?? null;
  const niFy = fy('netIncome')?.v ?? null;
  let payout: number | null = null;
  if (isNum(dps) && isNum(epsFy) && epsFy > 0) payout = dps / epsFy;
  else if (isNum(divPaid) && isNum(niFy) && niFy > 0) payout = Math.abs(divPaid) / niFy;

  const pf = latest(dedupe(data.i.publicFloat ?? []));
  const revAnnual = annualSeries(data.d.revenue);
  const epsAnnual = splitAdjustedEps(annualSeries(data.d.eps), annualSeries(data.d.netIncome));
  const asOf = rev?.end ?? ni?.end ?? balanceDate;

  return {
    cik,
    name: data.name,
    asOf: asOf ?? null,
    basis: rev?.basis ?? ni?.basis ?? null,
    revenue,
    grossProfit,
    operatingIncome,
    netIncome,
    eps: eps?.v ?? null,
    epsFy,
    ebitda,
    fcf,
    cfo,
    dps,
    payout,
    dividendGrowth: isNum(dps) && isNum(dpsPrev) && dpsPrev > 0 ? dps / dpsPrev - 1 : null,
    epsGrowthQoq: eps?.t ? growth(eps.t.lastQYearAgo, eps.t.lastQ) : null,
    epsGrowthTtm: eps?.t ? growth(eps.t.prev, eps.t.v) : null,
    epsGrowth3y: nYearGrowth(epsAnnual, 3),
    epsGrowth5y: nYearGrowth(epsAnnual, 5),
    salesGrowthQoq: rev?.t ? growth(rev.t.lastQYearAgo, rev.t.lastQ) : null,
    salesGrowthTtm: rev?.t ? growth(rev.t.prev, rev.t.v) : null,
    salesGrowth3y: nYearGrowth(revAnnual, 3),
    salesGrowth5y: nYearGrowth(revAnnual, 5),
    grossMargin: isNum(revenue) && revenue > 0 ? div(grossProfit, revenue) : null,
    operMargin: isNum(revenue) && revenue > 0 && op && rev && op.end === rev.end ? div(operatingIncome, revenue) : null,
    netMargin: isNum(revenue) && revenue > 0 && ni && rev && ni.end === rev.end ? div(netIncome, revenue) : null,
    roa: isNum(assets) && assets > 0 ? div(netIncome, assets) : null,
    roe: isNum(equity) && equity > 0 ? div(netIncome, equity) : null,
    roic,
    currentRatio: div(currentAssets, currentLiabilities),
    quickRatio: isNum(currentAssets) ? div(currentAssets - (inventory ?? 0), currentLiabilities) : null,
    ltDebtEq: isNum(equity) && equity > 0 && debtKnown ? div(ltDebt ?? 0, equity) : null,
    debtEq: isNum(equity) && equity > 0 ? div(debt, equity) : null,
    equity,
    cashAndInvestments: isNum(cash) ? cash + (stInvest ?? 0) : null,
    debt,
    assets,
    balanceAsOf: balanceDate && !stale(balanceDate) ? balanceDate : null,
    publicFloat: pf && pf.v > 0 ? { date: pf.e, value: pf.v } : null,
  };
}

export async function fetchAllFundamentals(onProgress?: (done: number, total: number) => void): Promise<Fundamentals[]> {
  const now = new Date();
  const reqs = buildRequests(now);
  const store = new Map<number, CikData>();
  let done = 0;
  await mapLimit(reqs, 4, async (r) => {
    try {
      const facts = await sec.frame(r.tax, r.tag, r.unit, r.period);
      for (const f of facts) {
        if (!isNum(f.val)) continue;
        let d = store.get(f.cik);
        if (!d) {
          d = { name: f.entityName, d: {}, i: {} };
          store.set(f.cik, d);
        }
        const bucket = r.instant ? d.i : d.d;
        (bucket[r.concept] ??= []).push({ s: f.start, e: f.end, v: f.val, p: r.p });
      }
    } catch {
      // A missing frame just means fewer data points for that concept/period.
    }
    done++;
    onProgress?.(done, reqs.length);
  });
  const today = ymd(now);
  const out: Fundamentals[] = [];
  for (const [cik, data] of store) {
    const f = compute(cik, data, today);
    if (f) out.push(f);
  }
  return out;
}

export const frameRequestCount = () => buildRequests(new Date()).length;
