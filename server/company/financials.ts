import { cached, HOUR } from '../lib/cache.ts';
import * as sec from '../sources/sec.ts';
import { daysBetween, div, growth, isNum, ymd } from '../lib/util.ts';
import { LINE_ITEMS, type Financials, type Period, type StatementSet } from '../../shared/financials.ts';

/**
 * Build annual and quarterly statements from a company's full XBRL history
 * (data.sec.gov companyfacts). Quarterly cash-flow items are reported
 * year-to-date in 10-Q filings, so single quarters are derived by differencing.
 */

interface Raw {
  s?: string;
  e: string;
  v: number;
  filed: string;
  p: number;
}

const FLOW: Record<string, { tags: string[]; unit?: string }> = {
  revenue: { tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense'] },
  costOfRevenue: { tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices'] },
  grossProfit: { tags: ['GrossProfit'] },
  rnd: { tags: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'] },
  sga: { tags: ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'] },
  operatingIncome: { tags: ['OperatingIncomeLoss'] },
  interestExpense: { tags: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestAndDebtExpense'] },
  pretaxIncome: { tags: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'] },
  incomeTax: { tags: ['IncomeTaxExpenseBenefit'] },
  netIncome: { tags: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'] },
  eps: { tags: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'], unit: 'USD/shares' },
  dps: { tags: ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'], unit: 'USD/shares' },
  sharesDiluted: { tags: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasicAndDiluted', 'WeightedAverageNumberOfSharesOutstandingBasic'], unit: 'shares' },
  cfo: { tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'] },
  capex: { tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'] },
  da: { tags: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation'] },
  sbc: { tags: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'] },
  dividendsPaid: { tags: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'] },
  buybacks: { tags: ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity'] },
  acquisitions: { tags: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross'] },
  interestPaid: { tags: ['InterestPaidNet', 'InterestPaid'] },
};

const INSTANT: Record<string, { tags: string[]; unit?: string }> = {
  cashOnly: { tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'] },
  stInvest: { tags: ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'] },
  receivables: { tags: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'] },
  inventory: { tags: ['InventoryNet'] },
  currentAssets: { tags: ['AssetsCurrent'] },
  ppe: { tags: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization'] },
  goodwillOnly: { tags: ['Goodwill'] },
  intangibles: { tags: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'] },
  assets: { tags: ['Assets'] },
  currentLiabilities: { tags: ['LiabilitiesCurrent'] },
  liabilities: { tags: ['Liabilities'] },
  equity: { tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
  ltDebtNoncurrent: { tags: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermNotesPayable', 'ConvertibleNotesPayableNoncurrent'] },
  ltDebtTotal: { tags: ['LongTermDebt', 'DebtLongtermAndShorttermCombinedAmount'] },
  ltDebtCurrent: { tags: ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent'] },
  stDebt: { tags: ['DebtCurrent', 'ShortTermBorrowings', 'CommercialPaper'] },
};

function collect(cf: sec.CompanyFacts, tags: string[], unit = 'USD'): Raw[] {
  const out: Raw[] = [];
  const gaap = cf.facts['us-gaap'] ?? {};
  tags.forEach((tag, p) => {
    for (const f of gaap[tag]?.units?.[unit] ?? []) {
      if (isNum(f.val)) out.push({ s: f.start, e: f.end, v: f.val, filed: f.filed, p });
    }
  });
  return out;
}

const near = (a: string, b: string, tol = 5) => Math.abs(daysBetween(a, b)) <= tol;
const addDays = (d: string, n: number) => ymd(new Date(Date.parse(d) + n * 86_400_000));
const len = (f: Raw) => (f.s ? daysBetween(f.s, f.e) + 1 : 0);

/** Best fact for an exact period: preferred tag first, then the most recently filed value (restatements win). */
function pickFlow(facts: Raw[], start: string, end: string): number | null {
  let best: Raw | null = null;
  for (const f of facts) {
    if (!f.s || !near(f.e, end) || !near(f.s, start, 8)) continue;
    if (!best || f.p < best.p || (f.p === best.p && f.filed > best.filed)) best = f;
  }
  return best ? best.v : null;
}

function pickInstant(facts: Raw[], end: string): number | null {
  let best: Raw | null = null;
  for (const f of facts) {
    if (f.s || !near(f.e, end, 4)) continue;
    if (!best || f.p < best.p || (f.p === best.p && f.filed > best.filed)) best = f;
  }
  return best ? best.v : null;
}

interface FY {
  start: string;
  end: string;
  complete: boolean;
  year?: number;
}

function fiscalYears(cf: sec.CompanyFacts): FY[] {
  const base = [...collect(cf, FLOW.netIncome.tags), ...collect(cf, FLOW.revenue.tags)];
  const byEnd = new Map<string, FY>();
  for (const f of base) {
    const l = len(f);
    if (l >= 340 && l <= 380) byEnd.set(f.e, { start: f.s as string, end: f.e, complete: true });
  }
  const years = [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
  // Collapse near-duplicate ends (52/53-week calendars restated by a few days).
  const out: FY[] = [];
  for (const y of years) {
    const prev = out[out.length - 1];
    if (prev && daysBetween(prev.end, y.end) < 300) out[out.length - 1] = y;
    else out.push(y);
  }
  return out;
}

function quarterPeriods(cf: sec.CompanyFacts, years: FY[]): { start: string; end: string; fy: FY; q: number }[] {
  if (!years.length) return [];
  const base = [...collect(cf, FLOW.netIncome.tags), ...collect(cf, FLOW.revenue.tags)];
  const last = years[years.length - 1];
  const open: FY = { start: addDays(last.end, 1), end: addDays(last.end, 366), complete: false, year: Number(last.end.slice(0, 4)) + 1 };
  const out: { start: string; end: string; fy: FY; q: number }[] = [];
  for (const fy of [...years, open]) {
    const ends = new Set<string>();
    for (const f of base) {
      if (!f.s || f.e > fy.end || !near(f.e, fy.end, 400)) continue;
      const startsAtFy = near(f.s, fy.start, 8);
      const inside = f.s >= addDays(fy.start, -8) && f.e <= addDays(fy.end, 8);
      const l = len(f);
      if ((startsAtFy && l >= 75 && l <= 380) || (inside && l >= 75 && l <= 125)) ends.add(f.e);
    }
    if (fy.complete) ends.add(fy.end);
    const sorted = [...ends].sort();
    const uniq: string[] = [];
    for (const e of sorted) if (!uniq.length || daysBetween(uniq[uniq.length - 1], e) > 40) uniq.push(e);
    let start = fy.start;
    uniq.forEach((e, i) => {
      const l = daysBetween(start, e) + 1;
      if (l >= 75 && l <= 130) out.push({ start, end: e, fy, q: i + 1 });
      start = addDays(e, 1);
    });
  }
  return out;
}

function quarterFlow(facts: Raw[], q: { start: string; end: string; fy: FY; q: number }, isPerShare = false): number | null {
  const direct = pickFlow(facts, q.start, q.end);
  if (direct != null) return direct;
  if (q.q === 1) return null;
  // Year-to-date at this quarter end minus year-to-date at the previous quarter end.
  const ytd = pickFlow(facts, q.fy.start, q.end);
  const prevEnd = addDays(q.start, -1);
  const ytdPrev = pickFlow(facts, q.fy.start, prevEnd);
  if (ytd != null && ytdPrev != null) return isPerShare ? Math.round((ytd - ytdPrev) * 100) / 100 : ytd - ytdPrev;
  return null;
}

function derive(v: Record<string, number | null>, prev: Record<string, number | null> | null, annualized: boolean): void {
  const n = (k: string) => (isNum(v[k]) ? (v[k] as number) : null);
  if (n('capex') != null) v.capex = Math.abs(v.capex as number);
  if (n('grossProfit') == null && n('revenue') != null && n('costOfRevenue') != null) v.grossProfit = (v.revenue as number) - (v.costOfRevenue as number);
  v.fcf = n('cfo') != null ? (v.cfo as number) - (n('capex') ?? 0) : null;
  v.ebitda = n('operatingIncome') != null && n('da') != null ? (v.operatingIncome as number) + (v.da as number) : null;
  v.cash = n('cashOnly') != null ? (v.cashOnly as number) + (n('stInvest') ?? 0) : null;
  v.goodwill = n('goodwillOnly') != null || n('intangibles') != null ? (n('goodwillOnly') ?? 0) + (n('intangibles') ?? 0) : null;
  const ltNon = n('ltDebtNoncurrent');
  const ltTotal = n('ltDebtTotal');
  const ltCur = n('ltDebtCurrent');
  const st = n('stDebt');
  const known = ltNon != null || ltTotal != null || ltCur != null || st != null;
  v.totalDebt = known ? (ltNon != null ? ltNon + (ltCur ?? 0) : ltTotal ?? ltCur ?? 0) + (st ?? 0) : n('assets') != null ? 0 : null;
  v.debtReported = known ? 1 : 0;
  v.netDebt = n('totalDebt') != null && n('cash') != null ? (v.totalDebt as number) - (v.cash as number) : null;
  if (n('liabilities') == null && n('assets') != null && n('equity') != null) v.liabilities = (v.assets as number) - (v.equity as number);
  // Maintenance capex is unknowable from filings; the lesser of capex and D&A is a common conservative stand-in.
  const maint = n('capex') != null && n('da') != null ? Math.min(v.capex as number, v.da as number) : n('capex');
  v.ownerEarnings = n('netIncome') != null && n('da') != null && maint != null ? (v.netIncome as number) + (v.da as number) - maint : null;
  const sh = n('sharesDiluted');
  v.fcfPerShare = sh ? div(v.fcf, sh) : null;
  v.ownerEarningsPerShare = sh ? div(v.ownerEarnings, sh) : null;
  v.bookPerShare = sh ? div(v.equity, sh) : null;
  const rev = n('revenue');
  v.grossMargin = rev && rev > 0 ? div(v.grossProfit, rev) : null;
  v.operMargin = rev && rev > 0 ? div(v.operatingIncome, rev) : null;
  v.netMargin = rev && rev > 0 ? div(v.netIncome, rev) : null;
  v.fcfMargin = rev && rev > 0 ? div(v.fcf, rev) : null;
  v.revenueGrowth = prev ? growth(prev.revenue, v.revenue) : null;
  v.epsGrowth = prev ? growth(prev.eps, v.eps) : null;
  const scale = annualized ? 1 : 4;
  const avg = (k: string) => (n(k) != null ? (prev && isNum(prev[k]) ? ((v[k] as number) + (prev[k] as number)) / 2 : (v[k] as number)) : null);
  const eqAvg = avg('equity');
  v.roe = eqAvg != null && eqAvg > 0 && n('netIncome') != null ? ((v.netIncome as number) * scale) / eqAvg : null;
  v.roa = avg('assets') ? div((n('netIncome') ?? NaN) * scale, avg('assets')) : null;
  let taxRate = 0.21;
  if (n('incomeTax') != null && n('pretaxIncome') != null && (v.pretaxIncome as number) > 0) taxRate = Math.min(0.35, Math.max(0, (v.incomeTax as number) / (v.pretaxIncome as number)));
  const capital = n('equity') != null && n('totalDebt') != null ? (v.equity as number) + (v.totalDebt as number) : null;
  const prevCapital = prev && isNum(prev.equity) && isNum(prev.totalDebt) ? (prev.equity as number) + (prev.totalDebt as number) : null;
  const capAvg = capital != null ? (prevCapital != null ? (capital + prevCapital) / 2 : capital) : null;
  v.roic = capAvg != null && capAvg > 0 && n('operatingIncome') != null ? ((v.operatingIncome as number) * (1 - taxRate) * scale) / capAvg : null;
  v.debtEq = n('equity') != null && (v.equity as number) > 0 ? div(v.totalDebt, v.equity) : null;
  v.netDebtEbitda = n('ebitda') != null && (v.ebitda as number) > 0 && n('netDebt') != null ? Math.max(0, v.netDebt as number) / ((v.ebitda as number) * scale) : null;
  const interest = n('interestPaid') ?? n('interestExpense');
  v.interestCoverage = n('operatingIncome') != null && interest != null ? (interest === 0 ? ((v.operatingIncome as number) > 0 ? 100 : null) : Math.min(100, (v.operatingIncome as number) / Math.abs(interest))) : null;
  v.currentRatio = div(v.currentAssets, v.currentLiabilities);
  v.payout = n('netIncome') != null && (v.netIncome as number) > 0 && n('dividendsPaid') != null ? Math.abs(v.dividendsPaid as number) / (v.netIncome as number) : null;
  v.capexToCfo = n('cfo') != null && (v.cfo as number) > 0 ? div(v.capex, v.cfo) : null;
}

const FLOW_KEYS = Object.keys(FLOW);
const INSTANT_KEYS = Object.keys(INSTANT);

function toSet(periods: Period[], rows: Record<string, number | null>[]): StatementSet {
  const values: Record<string, (number | null)[]> = {};
  const keys = new Set<string>([...LINE_ITEMS.map((l) => l.key), 'debtReported']);
  for (const k of keys) values[k] = rows.map((r) => (isNum(r[k]) ? (r[k] as number) : null));
  return { periods, values };
}

async function build(cik: number): Promise<Financials | null> {
  const cf = await sec.companyFacts(cik);
  if (!cf?.facts?.['us-gaap']) return null;
  const flowFacts: Record<string, Raw[]> = {};
  for (const [k, def] of Object.entries(FLOW)) flowFacts[k] = collect(cf, def.tags, def.unit ?? 'USD');
  const instFacts: Record<string, Raw[]> = {};
  for (const [k, def] of Object.entries(INSTANT)) instFacts[k] = collect(cf, def.tags, def.unit ?? 'USD');

  const years = fiscalYears(cf);
  if (!years.length) return null;

  // ---- annual
  const annualYears = years.slice(-13);
  const annualRows: Record<string, number | null>[] = [];
  const annualPeriods: Period[] = [];
  annualYears.forEach((fy, i) => {
    const v: Record<string, number | null> = {};
    for (const k of FLOW_KEYS) v[k] = pickFlow(flowFacts[k], fy.start, fy.end);
    for (const k of INSTANT_KEYS) v[k] = pickInstant(instFacts[k], fy.end);
    derive(v, i > 0 ? annualRows[i - 1] : null, true);
    annualRows.push(v);
    const year = Number(fy.end.slice(0, 4));
    annualPeriods.push({ start: fy.start, end: fy.end, label: `FY${year}`, fiscalYear: year, kind: 'annual' });
  });
  // The first year only exists to seed growth and averages when there is plenty of history.
  const dropFirst = annualRows.length > 11;
  const annual = toSet(dropFirst ? annualPeriods.slice(1) : annualPeriods, dropFirst ? annualRows.slice(1) : annualRows);

  // ---- quarterly
  const qp = quarterPeriods(cf, years).slice(-21);
  const qRows: Record<string, number | null>[] = [];
  const qPeriods: Period[] = [];
  qp.forEach((q, i) => {
    const v: Record<string, number | null> = {};
    for (const k of FLOW_KEYS) {
      const perShare = FLOW[k].unit === 'USD/shares';
      // Weighted-average share counts are not additive, so they are never differenced:
      // use the quarter's own figure, else the year-to-date average at that date.
      let val = k === 'sharesDiluted' ? pickFlow(flowFacts[k], q.start, q.end) ?? pickFlow(flowFacts[k], q.fy.start, q.end) : quarterFlow(flowFacts[k], q, perShare);
      // A fiscal Q4 is rarely reported on its own: full year minus the first three quarters.
      if (val == null && q.fy.complete && near(q.end, q.fy.end)) {
        const full = pickFlow(flowFacts[k], q.fy.start, q.fy.end);
        const prior = pickFlow(flowFacts[k], q.fy.start, addDays(q.start, -1));
        if (full != null && prior != null && k !== 'sharesDiluted') val = perShare ? Math.round((full - prior) * 100) / 100 : full - prior;
        else if (k === 'sharesDiluted') val = full;
      }
      v[k] = val;
    }
    for (const k of INSTANT_KEYS) v[k] = pickInstant(instFacts[k], q.end);
    // Year-over-year comparisons use the same quarter a year earlier.
    const yearAgo = qRows.find((_, j) => Math.abs(daysBetween(qp[j].end, q.end) - 365) <= 20) ?? null;
    derive(v, i > 0 ? qRows[i - 1] : null, false);
    v.revenueGrowth = yearAgo ? growth(yearAgo.revenue, v.revenue) : null;
    v.epsGrowth = yearAgo ? growth(yearAgo.eps, v.eps) : null;
    qRows.push(v);
    const fyYear = q.fy.year ?? Number(q.fy.end.slice(0, 4));
    qPeriods.push({ start: q.start, end: q.end, label: `Q${q.q} FY${fyYear}`, fiscalYear: fyYear, kind: 'quarter' });
  });
  const keep = Math.min(qRows.length, 16);
  const quarterly = toSet(qPeriods.slice(-keep), qRows.slice(-keep));

  // ---- trailing twelve months
  let ttm: Financials['ttm'] = null;
  const last4 = qRows.slice(-4);
  const last4p = qPeriods.slice(-4);
  if (last4.length === 4 && daysBetween(last4p[0].start as string, last4p[3].end) <= 385 && daysBetween(last4p[0].start as string, last4p[3].end) >= 345) {
    const v: Record<string, number | null> = {};
    for (const k of FLOW_KEYS) {
      if (k === 'sharesDiluted') v[k] = last4[3][k] ?? null;
      else v[k] = last4.every((r) => isNum(r[k])) ? last4.reduce((s, r) => s + (r[k] as number), 0) : null;
    }
    for (const k of INSTANT_KEYS) v[k] = last4[3][k] ?? null;
    const yearAgoRow = qRows.length >= 8 ? (() => {
      const prior = qRows.slice(-8, -4);
      const p: Record<string, number | null> = {};
      for (const k of ['revenue', 'eps']) p[k] = prior.every((r) => isNum(r[k])) ? prior.reduce((s, r) => s + (r[k] as number), 0) : null;
      for (const k of ['equity', 'assets', 'totalDebt']) p[k] = prior[3][k] ?? null;
      return p;
    })() : null;
    derive(v, yearAgoRow, true);
    const clean: Record<string, number | null> = {};
    for (const l of LINE_ITEMS) clean[l.key] = isNum(v[l.key]) ? (v[l.key] as number) : null;
    clean.debtReported = v.debtReported ?? null;
    ttm = { period: { start: last4p[0].start, end: last4p[3].end, label: 'TTM', fiscalYear: last4p[3].fiscalYear, kind: 'ttm' }, values: clean };
  }

  const sub = await sec.submission(cik, 300).catch(() => null);
  const filings = (sub?.filings ?? [])
    .filter((f) => ['10-K', '10-Q', '20-F', '40-F', 'DEF 14A', '8-K'].includes(f.form))
    .slice(0, 40)
    .map((f) => ({ form: f.form, filed: f.filed, reportDate: f.reportDate, url: sec.filingUrl(cik, f.accn, f.doc) }));

  return {
    cik,
    name: cf.entityName,
    currency: 'USD',
    fiscalYearEnd: sub?.fiscalYearEnd ?? null,
    lineItems: LINE_ITEMS,
    annual,
    quarterly,
    ttm,
    filings,
    source: 'SEC EDGAR XBRL company facts (10-K / 10-Q filings)',
  };
}

export function companyFinancials(cik: number): Promise<Financials | null> {
  return cached('financials', String(cik), 12 * HOUR, () => build(cik));
}
