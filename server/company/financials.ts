import { cached, HOUR } from '../lib/cache.ts';
import * as sec from '../sources/sec.ts';
import { daysBetween, div, growth, isNum, ymd } from '../lib/util.ts';
import { LINE_ITEMS, type Financials, type Period, type StatementSet } from '../../shared/financials.ts';
import { CAPEX_TAGS, DEBT_TAGS, combineCapex, combineDebt, type Get } from '../../shared/captions.ts';

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
  form: string;
  p: number;
  accn?: string;
  /** For a combined debt reading: the largest caption behind it, and every debt caption the filing tagged for that date. */
  main?: string;
  tags?: Set<string>;
}

const FLOW: Record<string, { tags: string[]; unit?: string }> = {
  revenue: { tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet', 'RevenuesNetOfInterestExpense', 'RegulatedAndUnregulatedOperatingRevenue'] },
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
  leaseTotal: { tags: ['OperatingLeaseLiability'] },
  leaseCurrent: { tags: ['OperatingLeaseLiabilityCurrent'] },
  leaseNoncurrent: { tags: ['OperatingLeaseLiabilityNoncurrent'] },
};


interface Basis {
  /** Multiply a share count from a filing made on this date to put it on today's basis. */
  shares: (filed: string) => number;
  /** Divide a per-share figure (EPS, dividends) from a filing made on this date. */
  perShare: (filed: string) => number;
}

const SPLIT_RATIOS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50];

/** Nearest conventional split ratio (or its reciprocal, for reverse splits) within 6%, else null. */
function snapSplit(f: number): number | null {
  for (const r of SPLIT_RATIOS) {
    if (Math.abs(f / r - 1) < 0.06) return r;
    if (Math.abs(f * r - 1) < 0.06) return 1 / r;
  }
  return null;
}

/**
 * Stock splits. A filing reports share counts on the share basis in force when
 * it was filed, and older filings are never restated, so a ten-for-one split
 * makes the years before it look like a tenfold jump in shares and a collapse
 * in EPS. Companies do restate the comparative periods inside later filings,
 * which gives the conversion exactly: when the same period's weighted share
 * count appears in two filings and differs, the ratio is what changed between
 * those two filing dates.
 *
 * Two different things produce such a ratio, and they are kept apart:
 *  - a real split, which also moves EPS by the same ratio, and
 *  - a reporting-scale error (shares filed in thousands one year, units the
 *    next), which changes the share count a thousandfold but leaves EPS alone.
 * Share counts are corrected in both cases; per-share figures only when EPS
 * confirms the split, or, where EPS was not restated alongside, when the ratio
 * is a conventional split ratio.
 */
function shareBasis(cf: sec.CompanyFacts): Basis {
  const gaap = cf.facts['us-gaap'] ?? {};
  const sharePairs: { from: string; to: string; factor: number }[] = [];
  // raw = older EPS / newer EPS for the same period, i.e. the share factor EPS implies.
  const epsPairs: { from: string; to: string; raw: number }[] = [];
  const dates = new Set<string>();
  const restated = (tag: string, unit: string, onPair: (from: string, to: string, older: number, newer: number) => void) => {
    const byPeriod = new Map<string, { filed: string; v: number }[]>();
    for (const f of gaap[tag]?.units?.[unit] ?? []) {
      if (!f.start || !isNum(f.val) || f.val === 0 || !f.filed || !USABLE_FORM.test(f.form ?? '')) continue;
      dates.add(f.filed);
      const key = `${f.start}|${f.end}`;
      const list = byPeriod.get(key);
      if (list) list.push({ filed: f.filed, v: f.val });
      else byPeriod.set(key, [{ filed: f.filed, v: f.val }]);
    }
    for (const list of byPeriod.values()) {
      list.sort((a, b) => (a.filed < b.filed ? -1 : 1));
      for (let k = 1; k < list.length; k++) if (list[k].filed !== list[k - 1].filed) onPair(list[k - 1].filed, list[k].filed, list[k - 1].v, list[k].v);
    }
  };
  for (const tag of FLOW.sharesDiluted.tags) {
    restated(tag, 'shares', (from, to, older, newer) => {
      // Restatements of a few percent are corrections, not a change of basis.
      if (older > 0 && newer > 0) sharePairs.push({ from, to, factor: Math.abs(newer / older - 1) < 0.045 ? 1 : newer / older });
    });
  }
  for (const tag of FLOW.eps.tags) {
    restated(tag, 'USD/shares', (from, to, older, newer) => {
      if (older / newer > 0) epsPairs.push({ from, to, raw: older / newer });
    });
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const sorted = [...dates].sort().reverse(); // newest first
  const sFactor = new Map<string, number>();
  const pFactor = new Map<string, number>();
  let laterS = 1;
  let laterP = 1;
  for (const d of sorted) {
    const sp = sharePairs.filter((x) => x.from === d && sFactor.has(x.to));
    const ep = epsPairs.filter((x) => x.from === d && pFactor.has(x.to));
    let fs = laterS;
    let fp = laterP;
    if (sp.length) {
      fs = median(sp.map((x) => (sFactor.get(x.to) as number) * x.factor));
      fp = median(
        sp.map((x) => {
          const base = pFactor.get(x.to) as number;
          if (x.factor === 1) return base;
          const same = ep.filter((y) => y.to === x.to);
          if (same.length) return Math.abs(median(same.map((y) => y.raw)) / x.factor - 1) < 0.12 ? base * x.factor : base;
          return snapSplit(x.factor) != null ? base * x.factor : base;
        }),
      );
    } else if (ep.length) {
      // No share count in this filing (some multi-class companies): restated EPS carries the
      // split on its own. EPS is also restated for accounting reasons, so only a change that
      // lands on a conventional split ratio counts.
      fp = median(
        ep.map((y) => {
          const base = pFactor.get(y.to) as number;
          if (Math.abs(y.raw - 1) < 0.045 || (y.raw < 1.4 && y.raw > 0.72)) return base;
          const snapped = snapSplit(y.raw);
          return snapped != null ? base * snapped : base;
        }),
      );
    }
    sFactor.set(d, fs);
    pFactor.set(d, fp);
    laterS = fs;
    laterP = fp;
  }
  const asc = [...sorted].reverse();
  const lookup = (m: Map<string, number>) => (filed: string) => {
    const exact = m.get(filed);
    if (exact != null) return exact;
    // A filing with no share or EPS facts of its own shares the basis of the next filing after it.
    const next = asc.find((d) => d >= filed);
    return next ? (m.get(next) as number) : 1;
  };
  return { shares: lookup(sFactor), perShare: lookup(pFactor) };
}

/**
 * Only a company's own periodic reports (and the registration statement of a newly listed
 * one) are read. Other filings carry XBRL too, and it is not the company's statements:
 * proxy statements repeat net income in the pay-versus-performance table, sometimes in
 * thousands; a current report (8-K) or merger registration can contain another company's
 * full financial statements.
 */
const USABLE_FORM = /^(10-K|10-Q|20-F|40-F|6-K|S-1|F-1)/;
const ANNUAL_FORM = /^(10-K|20-F|40-F)/;

function collect(cf: sec.CompanyFacts, tags: string[], unit = 'USD', basis?: Basis): Raw[] {
  const out: Raw[] = [];
  const gaap = cf.facts['us-gaap'] ?? {};
  tags.forEach((tag, p) => {
    for (const f of gaap[tag]?.units?.[unit] ?? []) {
      if (!isNum(f.val) || !USABLE_FORM.test(f.form ?? '')) continue;
      let v = f.val;
      if (basis && unit === 'shares') v *= basis.shares(f.filed);
      else if (basis && unit === 'USD/shares') v /= basis.perShare(f.filed);
      out.push({ s: f.start, e: f.end, v, filed: f.filed, form: f.form ?? '', p, accn: f.accn });
    }
  });
  return out;
}

/**
 * One series built from several captions, combined one filing at a time (see
 * shared/captions.ts for why). Each filing's captions for a period give one figure; the
 * usual rules then choose between filings.
 */
function combinedFacts(cf: sec.CompanyFacts, tags: string[], kind: 'flow' | 'instant', combine: (get: Get) => { v: number; p?: number } | null, context: string[] = []): Raw[] {
  const gaap = cf.facts['us-gaap'] ?? {};
  const groups = new Map<string, { s?: string; e: string; filed: string; form: string; accn: string; vals: Map<string, number> }>();
  // `context` captions are read alongside (total liabilities, for a sanity cap) but are not part of the series.
  for (const tag of [...tags, ...context]) {
    for (const f of gaap[tag]?.units?.USD ?? []) {
      if (!isNum(f.val) || !USABLE_FORM.test(f.form ?? '') || (kind === 'flow') !== Boolean(f.start)) continue;
      const key = `${f.accn}|${f.start ?? ''}|${f.end}`;
      let g = groups.get(key);
      if (!g) {
        g = { s: f.start, e: f.end, filed: f.filed, form: f.form ?? '', accn: f.accn, vals: new Map() };
        groups.set(key, g);
      }
      g.vals.set(tag, f.val);
    }
  }
  const out: Raw[] = [];
  for (const g of groups.values()) {
    const r = combine((tag) => g.vals.get(tag) ?? null);
    if (!r) continue;
    let main: string | undefined;
    const own = new Set<string>();
    for (const [tag, val] of g.vals) {
      if (context.includes(tag)) continue;
      own.add(tag);
      if (val > 0 && (main == null || val > (g.vals.get(main) as number))) main = tag;
    }
    out.push({ s: g.s, e: g.e, v: r.v, filed: g.filed, form: g.form, p: r.p ?? 0, accn: g.accn, main, tags: own });
  }
  return out;
}

/**
 * Cash raised from borrowing less cash repaid, per filing and period. Used only as evidence:
 * when the debt captions shrink sharply, net repayments on the cash-flow statement show
 * whether debt was really repaid or the captions are simply missing.
 */
const BORROWED = ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromIssuanceOfDebt', 'ProceedsFromDebtNetOfIssuanceCosts', 'ProceedsFromDebtMaturingInMoreThanThreeMonths', 'ProceedsFromLinesOfCredit', 'ProceedsFromLongTermLinesOfCredit',
  'ProceedsFromIssuanceOfSeniorLongTermDebt', 'ProceedsFromNotesPayable', 'ProceedsFromConvertibleNotesPayable', 'ProceedsFromIssuanceOfSecuredDebt', 'ProceedsFromIssuanceOfUnsecuredDebt', 'ProceedsFromBankDebt',
  'ProceedsFromShortTermDebt', 'ProceedsFromIssuanceOfCommercialPaper', 'ProceedsFromOtherDebt', 'ProceedsFromIssuanceOfOtherLongTermDebt', 'ProceedsFromIssuanceOfMediumTermNotes', 'ProceedsFromSecuredLinesOfCredit', 'ProceedsFromUnsecuredLinesOfCredit'];
const REPAID = ['RepaymentsOfLongTermDebt', 'RepaymentsOfDebt', 'RepaymentsOfDebtMaturingInMoreThanThreeMonths', 'RepaymentsOfLinesOfCredit', 'RepaymentsOfLongTermLinesOfCredit', 'RepaymentsOfSeniorDebt', 'RepaymentsOfNotesPayable',
  'RepaymentsOfConvertibleDebt', 'RepaymentsOfSecuredDebt', 'RepaymentsOfUnsecuredDebt', 'RepaymentsOfBankDebt', 'RepaymentsOfShortTermDebt', 'RepaymentsOfCommercialPaper', 'RepaymentsOfOtherDebt', 'RepaymentsOfOtherLongTermDebt',
  'RepaymentsOfMediumTermNotes', 'RepaymentsOfLongTermDebtAndCapitalSecurities', 'EarlyRepaymentOfSeniorDebt', 'RepaymentsOfSubordinatedDebt'];
const NET_BORROWED = ['ProceedsFromRepaymentsOfShortTermDebt', 'ProceedsFromRepaymentsOfCommercialPaper', 'ProceedsFromRepaymentsOfLinesOfCredit', 'ProceedsFromRepaymentsOfDebt', 'ProceedsFromRepaymentsOfNotesPayable',
  'ProceedsFromRepaymentsOfOtherDebt', 'ProceedsFromRepaymentsOfBankOverdrafts', 'ProceedsFromRepaymentsOfLongTermDebtAndCapitalSecurities', 'ProceedsFromRepaymentsOfOtherLongTermDebt', 'ProceedsFromRepaymentsOfShortTermDebtMaturingInThreeMonthsOrLess'];

function netBorrowingFacts(cf: sec.CompanyFacts): Raw[] {
  return combinedFacts(cf, [...BORROWED, ...REPAID, ...NET_BORROWED], 'flow', (get) => {
    const sum = (tags: string[], abs: boolean) => tags.reduce((s, t) => s + (isNum(get(t)) ? (abs ? Math.abs(get(t) as number) : (get(t) as number)) : 0), 0);
    return { v: sum(BORROWED, true) - sum(REPAID, true) + sum(NET_BORROWED, false) };
  });
}

/** Debt captions are tagged but give no credible figure. */
const UNREADABLE = -1;
const LIABILITY_TAGS = ['Liabilities', 'LiabilitiesAndStockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'StockholdersEquity'];

/** The reading each row's debt figure came from, so a later row can tell whether the same captions are still tagged. */
const DEBT_SOURCE = new WeakMap<object, Raw>();

/**
 * The debt reading for a balance-sheet date. Several filings show the same date (the annual
 * report, the next year's comparative column, the quarterly reports in between) and they do
 * not tag it in the same detail, so: an annual report for a year-end, then the reading with
 * the most agreement behind it, then the larger figure (the smaller one comes from a filing
 * that tagged fewer captions), then the most recent.
 */
function pickDebt(facts: Raw[], end: string, yearEnd: boolean): Raw | null {
  let best: Raw | null = null;
  for (const f of facts) {
    if (!near(f.e, end, 4)) continue;
    if (!best) best = f;
    else if (yearEnd && ANNUAL_FORM.test(f.form) !== ANNUAL_FORM.test(best.form)) best = ANNUAL_FORM.test(f.form) ? f : best;
    else if (f.p !== best.p) best = f.p < best.p ? f : best;
    else if (f.v !== best.v) best = f.v > best.v ? f : best;
    else if (f.filed > best.filed) best = f;
  }
  return best;
}

function debtFacts(cf: sec.CompanyFacts): Raw[] {
  return combinedFacts(cf, DEBT_TAGS, 'instant', (get) => {
    const all = get('LiabilitiesAndStockholdersEquity');
    const equity = get('StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest') ?? get('StockholdersEquity');
    const liabilities = get('Liabilities') ?? (isNum(all) && isNum(equity) ? all - equity : null);
    const r = combineDebt(get, liabilities);
    if (!r) return null;
    // Between filings, the reading with more agreement behind it wins.
    return { v: r.value ?? UNREADABLE, p: 10 - Math.min(9, r.support) };
  }, LIABILITY_TAGS);
}

const near = (a: string, b: string, tol = 5) => Math.abs(daysBetween(a, b)) <= tol;
const addDays = (d: string, n: number) => ymd(new Date(Date.parse(d) + n * 86_400_000));
const len = (f: Raw) => (f.s ? daysBetween(f.s, f.e) + 1 : 0);
/** A 52/53-week year that ends in the first days of January belongs to the calendar year before. */
const fiscalYearOf = (end: string) => Number(addDays(end, -7).slice(0, 4));

/**
 * Which of two facts for the same period to use. For a full fiscal year (or a fiscal
 * year-end balance sheet) a figure from an annual report beats one from any other filing:
 * quarterly reports do not report fiscal years, and the few that carry one are mistakes.
 * Then the preferred tag, then the most recently filed value (restatements win).
 */
function better(f: Raw, best: Raw | null, preferAnnual: boolean): boolean {
  if (!best) return true;
  if (preferAnnual && ANNUAL_FORM.test(f.form) !== ANNUAL_FORM.test(best.form)) return ANNUAL_FORM.test(f.form);
  if (f.p !== best.p) return f.p < best.p;
  return f.filed > best.filed;
}

function pickFlow(facts: Raw[], start: string, end: string): number | null {
  const fullYear = daysBetween(start, end) > 300;
  let best: Raw | null = null;
  for (const f of facts) {
    if (!f.s || !near(f.e, end) || !near(f.s, start, 8)) continue;
    if (better(f, best, fullYear)) best = f;
  }
  return best ? best.v : null;
}

function pickInstant(facts: Raw[], end: string, yearEnd = false): number | null {
  let best: Raw | null = null;
  for (const f of facts) {
    if (f.s || !near(f.e, end, 4)) continue;
    if (better(f, best, yearEnd)) best = f;
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
  const yearLong = base.filter((f) => len(f) >= 340 && len(f) <= 380);
  // Some companies (Amazon, for one) also publish trailing-twelve-month columns every quarter.
  // Only periods that appear in an annual report are fiscal years.
  const fromAnnualReports = yearLong.filter((f) => /^(10-K|20-F|40-F)/.test(f.form));
  const byEnd = new Map<string, FY>();
  for (const f of fromAnnualReports.length ? fromAnnualReports : yearLong) byEnd.set(f.e, { start: f.s as string, end: f.e, complete: true });
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
  const open: FY = { start: addDays(last.end, 1), end: addDays(last.end, 366), complete: false, year: fiscalYearOf(last.end) + 1 };
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

interface DebtContext {
  /** Use this figure as it stands (the trailing-twelve-month column takes the latest quarter's). */
  fixed?: { totalDebt: number | null };
  /** For a quarter: the latest fiscal year-end row before it. */
  anchor?: Record<string, number | null> | null;
}

function derive(v: Record<string, number | null>, prev: Record<string, number | null> | null, annualized: boolean, ctx: DebtContext = {}): void {
  const n = (k: string) => (isNum(v[k]) ? (v[k] as number) : null);
  const scale = annualized ? 1 : 4;
  if (n('grossProfit') == null && n('revenue') != null && n('costOfRevenue') != null) v.grossProfit = (v.revenue as number) - (v.costOfRevenue as number);
  if (n('pretaxIncome') == null && n('netIncome') != null && n('incomeTax') != null) v.pretaxIncome = (v.netIncome as number) + (v.incomeTax as number);
  // Free cash flow needs a capital-spending figure; without one it is unknown, not equal to operating cash flow.
  v.fcf = n('cfo') != null && n('capex') != null ? (v.cfo as number) - (v.capex as number) : null;
  v.ebitda = n('operatingIncome') != null && n('da') != null ? (v.operatingIncome as number) + (v.da as number) : null;
  v.cash = n('cashOnly') != null ? (v.cashOnly as number) + (n('stInvest') ?? 0) : null;
  v.goodwill = n('goodwillOnly') != null || n('intangibles') != null ? (n('goodwillOnly') ?? 0) + (n('intangibles') ?? 0) : null;
  if (n('liabilities') == null && n('assets') != null && n('equity') != null) v.liabilities = (v.assets as number) - (v.equity as number);
  // What the debt captions say, or null when none is tagged (see debtFacts).
  const read = n('debtRead');
  // Cash interest for a year; for a single quarter the expense, because coupons are paid on a
  // few dates a year and one quarter's cash interest says little.
  const interest = annualized ? n('interestPaid') ?? n('interestExpense') : n('interestExpense') ?? n('interestPaid');
  const assets = n('assets') ?? 0;
  const interestYear = interest != null ? Math.abs(interest) * scale : null;
  // The last full-year balance sheet before this one: the previous year for an annual row,
  // the latest fiscal year-end for a quarter.
  const anchor = annualized ? prev : ctx.anchor ?? null;
  const anchorDebt = anchor != null && isNum(anchor.totalDebt) ? anchor.totalDebt : null;
  if (ctx.fixed) v.totalDebt = ctx.fixed.totalDebt;
  else if (read != null && read >= 0) {
    // A figure was read. Two checks catch a reading that covers only part of the debt, which
    // happens when the rest sits under a caption of the company's own or the filing is tagged
    // in less detail than the annual report (quarterly reports often are):
    //  - the interest bill is far too large for the debt shown;
    //  - debt appears to have more than halved since the last year-end and nothing confirms
    //    that it was repaid: the caption that carried most of it is no longer tagged, total
    //    liabilities did not fall to match, the cash-flow statement shows no net repayment
    //    of that size, and the interest bill has not fallen.
    // Either way the figure is unknown, not small.
    let credible = true;
    if (interestYear != null && interestYear > Math.max(5e6, 0.003 * assets) && interestYear > (annualized ? 0.35 : 0.5) * Math.max(read, anchorDebt ?? 0)) credible = false;
    else if (anchor != null && anchorDebt != null && anchorDebt > Math.max(3e6, 0.01 * assets) && read < 0.5 * anchorDebt) {
      const before = DEBT_SOURCE.get(anchor)?.main;
      const stillTagged = before != null && DEBT_SOURCE.get(v)?.tags?.has(before) === true;
      const now = n('liabilities');
      const then = isNum(anchor.liabilities) ? anchor.liabilities : null;
      const liabilitiesFell = now != null && then != null && now <= then - 0.5 * (anchorDebt - read);
      const interestThen = isNum(anchor.interestPaid) ? Math.abs(anchor.interestPaid) : isNum(anchor.interestExpense) ? Math.abs(anchor.interestExpense) : null;
      // Only a full year's interest is evidence; a single quarter's figure is too noisy.
      const interestGone = annualized && interestYear != null && (interestThen != null && interestThen > 0 ? interestYear < 0.5 * interestThen : interestYear < 0.02 * anchorDebt);
      // Net borrowing since the last year-end, from the cash-flow statement (negative = repaid).
      const repaid = isNum(v.netBorrowing) && -v.netBorrowing >= 0.5 * (anchorDebt - read);
      if (!stillTagged && !liabilitiesFell && !interestGone && !repaid) credible = false;
    }
    v.totalDebt = credible ? read : null;
  } else if (read != null) v.totalDebt = null;
  else {
    // No debt caption in this period. That means "no debt" only when nothing says otherwise:
    //  - a company paying meaningful interest has borrowings the standard captions do not capture;
    //  - a company whose last full-year balance sheet showed material debt (or debt that could not
    //    be read) has not repaid it as far as the data can tell, unless a full year's interest
    //    figure says so.
    // In those cases the figure is unknown, not zero.
    const anchorUnknown = anchor != null && isNum(anchor.assets) && !isNum(anchor.totalDebt);
    const hadDebt = anchorDebt != null && anchorDebt > Math.max(3e6, 0.01 * assets);
    // A single quarter's interest is noisy (fees, tax interest), so the bar is higher there.
    const paysInterest = interestYear != null && interestYear > Math.max(3e6, (annualized ? 0.0015 : 0.003) * assets);
    const unknown = paysInterest || ((anchorUnknown || hadDebt) && (interest == null || !annualized));
    v.totalDebt = n('assets') != null && !unknown ? 0 : null;
  }
  // Whatever the captions say, borrowings cannot exceed total liabilities.
  if (isNum(v.totalDebt) && n('liabilities') != null && v.totalDebt > (v.liabilities as number) * 1.02 && !ctx.fixed) v.totalDebt = null;
  v.debtReported = read != null && read >= 0 ? 1 : 0;
  const leaseParts = n('leaseCurrent') != null || n('leaseNoncurrent') != null ? (n('leaseCurrent') ?? 0) + (n('leaseNoncurrent') ?? 0) : null;
  v.operatingLeases = n('leaseTotal') ?? leaseParts;
  v.netDebt = n('totalDebt') != null && n('cash') != null ? (v.totalDebt as number) - (v.cash as number) : null;
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
  const avg = (k: string) => (n(k) != null ? (prev && isNum(prev[k]) ? ((v[k] as number) + (prev[k] as number)) / 2 : (v[k] as number)) : null);
  const eqAvg = avg('equity');
  v.roe = eqAvg != null && eqAvg > 0 && n('netIncome') != null ? ((v.netIncome as number) * scale) / eqAvg : null;
  v.roa = avg('assets') ? div((n('netIncome') ?? NaN) * scale, avg('assets')) : null;
  let taxRate = 0.21;
  // Clamped to 15-35%: a year with a one-off tax benefit should not flatter the return on capital.
  if (n('incomeTax') != null && n('pretaxIncome') != null && (v.pretaxIncome as number) > 0) taxRate = Math.min(0.35, Math.max(0.15, (v.incomeTax as number) / (v.pretaxIncome as number)));
  const capital = n('equity') != null && n('totalDebt') != null ? (v.equity as number) + (v.totalDebt as number) : null;
  const prevCapital = prev && isNum(prev.equity) && isNum(prev.totalDebt) ? (prev.equity as number) + (prev.totalDebt as number) : null;
  const capAvg = capital != null ? (prevCapital != null ? (capital + prevCapital) / 2 : capital) : null;
  // Capped at 100%: once buybacks have shrunk equity to almost nothing the ratio stops meaning anything.
  v.roic = capAvg != null && capAvg > 0 && n('operatingIncome') != null ? Math.min(1, ((v.operatingIncome as number) * (1 - taxRate) * scale) / capAvg) : null;
  v.debtEq = n('equity') != null && (v.equity as number) > 0 ? div(v.totalDebt, v.equity) : null;
  v.netDebtEbitda = n('ebitda') != null && (v.ebitda as number) > 0 && n('netDebt') != null ? Math.max(0, v.netDebt as number) / ((v.ebitda as number) * scale) : null;
  v.interestCoverage = n('operatingIncome') != null && interest != null ? (interest === 0 ? ((v.operatingIncome as number) > 0 ? 100 : null) : Math.min(100, (v.operatingIncome as number) / Math.abs(interest))) : null;
  v.currentRatio = div(v.currentAssets, v.currentLiabilities);
  v.payout = n('netIncome') != null && (v.netIncome as number) > 0 && n('dividendsPaid') != null ? Math.abs(v.dividendsPaid as number) / (v.netIncome as number) : null;
  v.capexToCfo = n('cfo') != null && (v.cfo as number) > 0 ? div(v.capex, v.cfo) : null;
}

/** Bump when the way statements are built changes, so older cached copies are ignored. */
const CACHE_NS = 'financials-v5';

const FLOW_KEYS = [...Object.keys(FLOW), 'capex'];
const INSTANT_KEYS = Object.keys(INSTANT);

function toSet(periods: Period[], rows: Record<string, number | null>[]): StatementSet {
  const values: Record<string, (number | null)[]> = {};
  const keys = new Set<string>([...LINE_ITEMS.map((l) => l.key), 'debtReported']);
  for (const k of keys) values[k] = rows.map((r) => (isNum(r[k]) ? (r[k] as number) : null));
  return { periods, values };
}

async function build(cik: number, background = false): Promise<Financials | null> {
  const cf = await sec.companyFacts(cik, background);
  return cf ? buildFinancials(cik, cf) : null;
}

/** Pure: turn one company's XBRL facts into statements (exported for tests). */
export function buildFinancials(cik: number, cf: sec.CompanyFacts): Financials | null {
  if (!cf?.facts?.['us-gaap']) return null;
  const basis = shareBasis(cf);
  const flowFacts: Record<string, Raw[]> = {};
  for (const [k, def] of Object.entries(FLOW)) flowFacts[k] = collect(cf, def.tags, def.unit ?? 'USD', basis);
  const instFacts: Record<string, Raw[]> = {};
  for (const [k, def] of Object.entries(INSTANT)) instFacts[k] = collect(cf, def.tags, def.unit ?? 'USD');
  flowFacts.capex = combinedFacts(cf, CAPEX_TAGS, 'flow', (get) => {
    const v = combineCapex(get);
    return v == null ? null : { v };
  });
  const debtSeries = debtFacts(cf);
  const borrowing = netBorrowingFacts(cf);
  const readDebt = (v: Record<string, number | null>, end: string, yearEnd: boolean) => {
    const src = pickDebt(debtSeries, end, yearEnd);
    v.debtRead = src ? src.v : null;
    if (src) DEBT_SOURCE.set(v, src);
  };
  // A share count filed in the wrong scale and never restated (thousands for units) stands a
  // thousandfold away from every other period. EPS is unaffected, so only the count is fixed.
  const counts = flowFacts.sharesDiluted.filter((f) => f.v > 0).map((f) => f.v).sort((a, b) => a - b);
  const typical = counts[counts.length >> 1];
  if (typical) {
    for (const f of flowFacts.sharesDiluted) {
      const r = f.v / typical;
      if (r > 600 && r < 1700) f.v /= 1000;
      else if (r > 1 / 1700 && r < 1 / 600) f.v *= 1000;
    }
  }

  const years = fiscalYears(cf);
  if (!years.length) return null;

  // ---- annual
  const annualYears = years.slice(-13);
  const annualRows: Record<string, number | null>[] = [];
  const annualPeriods: Period[] = [];
  annualYears.forEach((fy, i) => {
    const v: Record<string, number | null> = {};
    for (const k of FLOW_KEYS) v[k] = pickFlow(flowFacts[k], fy.start, fy.end);
    for (const k of INSTANT_KEYS) v[k] = pickInstant(instFacts[k], fy.end, true);
    readDebt(v, fy.end, true);
    v.netBorrowing = pickFlow(borrowing, fy.start, fy.end);
    derive(v, i > 0 ? annualRows[i - 1] : null, true);
    annualRows.push(v);
    const year = fiscalYearOf(fy.end);
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
      const perShare = FLOW[k]?.unit === 'USD/shares';
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
    const yearEnd = q.fy.complete && near(q.end, q.fy.end);
    for (const k of INSTANT_KEYS) v[k] = pickInstant(instFacts[k], q.end, yearEnd);
    readDebt(v, q.end, yearEnd);
    // Year to date, i.e. since the balance sheet the quarter is compared with.
    v.netBorrowing = pickFlow(borrowing, q.fy.start, q.end);
    // Year-over-year comparisons use the same quarter a year earlier.
    const yearAgo = qRows.find((_, j) => Math.abs(daysBetween(qp[j].end, q.end) - 365) <= 20) ?? null;
    let anchor: Record<string, number | null> | null = null;
    annualYears.forEach((fy, j) => {
      if (fy.end <= q.end) anchor = annualRows[j];
    });
    derive(v, i > 0 ? qRows[i - 1] : null, false, { anchor });
    v.revenueGrowth = yearAgo ? growth(yearAgo.revenue, v.revenue) : null;
    v.epsGrowth = yearAgo ? growth(yearAgo.eps, v.eps) : null;
    qRows.push(v);
    const fyYear = q.fy.year ?? fiscalYearOf(q.fy.end);
    qPeriods.push({ start: q.start, end: q.end, label: `Q${q.q} FY${fyYear}`, fiscalYear: fyYear, kind: 'quarter' });
  });
  const keep = Math.min(qRows.length, 16);
  const quarterly = toSet(qPeriods.slice(-keep), qRows.slice(-keep));

  // ---- trailing twelve months
  let ttm: Financials['ttm'] = null;
  const last4 = qRows.slice(-4);
  const last4p = qPeriods.slice(-4);
  // Quarters that stop before the latest fiscal year-end (a company that no longer files them)
  // would give a "trailing" year older than the annual figures.
  const current = last4p.length === 4 && last4p[3].end >= addDays(annualYears[annualYears.length - 1].end, -5);
  if (current && daysBetween(last4p[0].start as string, last4p[3].end) <= 385 && daysBetween(last4p[0].start as string, last4p[3].end) >= 345) {
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
    // The balance sheet is the latest quarter's, so its debt figure is used as it stands.
    derive(v, yearAgoRow, true, { fixed: { totalDebt: last4[3].totalDebt ?? null } });
    const clean: Record<string, number | null> = {};
    for (const l of LINE_ITEMS) clean[l.key] = isNum(v[l.key]) ? (v[l.key] as number) : null;
    clean.debtReported = v.debtReported ?? null;
    ttm = { period: { start: last4p[0].start, end: last4p[3].end, label: 'TTM', fiscalYear: last4p[3].fiscalYear, kind: 'ttm' }, values: clean };
  }

  // Largest split adjustment applied to any year shown, so the page can say that history was restated.
  let splitFactor = 1;
  for (const f of [...collect(cf, FLOW.sharesDiluted.tags, 'shares'), ...collect(cf, FLOW.eps.tags, 'USD/shares')]) {
    if (f.e < annualYears[0].start) continue;
    const b = basis.perShare(f.filed);
    if (Math.abs(Math.log(b)) > Math.abs(Math.log(splitFactor))) splitFactor = b;
  }

  const scoredFrom = annualYears[Math.max(0, annualYears.length - 5)].start;
  let recentFactor = 1;
  for (const f of [...collect(cf, FLOW.sharesDiluted.tags, 'shares'), ...collect(cf, FLOW.eps.tags, 'USD/shares')]) {
    if (f.e < scoredFrom) continue;
    const b = basis.perShare(f.filed);
    if (Math.abs(Math.log(b)) > Math.abs(Math.log(recentFactor))) recentFactor = b;
  }

  return {
    cik,
    name: cf.entityName,
    currency: 'USD',
    fiscalYearEnd: annualYears.length ? annualYears[annualYears.length - 1].end.slice(5).replace('-', '') : null,
    lineItems: LINE_ITEMS,
    annual,
    quarterly,
    ttm,
    filings: [],
    splitAdjusted: Math.abs(splitFactor - 1) > 0.045 ? Math.round(splitFactor * 1000) / 1000 : null,
    splitAdjustedRecent: Math.abs(recentFactor - 1) > 0.045 ? Math.round(recentFactor * 1000) / 1000 : null,
    source: 'SEC EDGAR XBRL company facts (10-K / 10-Q filings)',
  };
}

async function loadFilings(cik: number): Promise<{ filings: Financials['filings']; fiscalYearEnd: string | null }> {
  const sub = await sec.submission(cik, 300).catch(() => null);
  const filings = (sub?.filings ?? [])
    .filter((f) => ['10-K', '10-Q', '20-F', '40-F', 'DEF 14A', '8-K'].includes(f.form))
    .slice(0, 40)
    .map((f) => ({ form: f.form, filed: f.filed, reportDate: f.reportDate, url: sec.filingUrl(cik, f.accn, f.doc) }));
  return { filings, fiscalYearEnd: sub?.fiscalYearEnd ?? null };
}

/**
 * Statements only (one SEC request). Used by the background checklist ranking,
 * which accepts an older copy as long as the company has not reported since.
 */
export function companyFinancialsCore(cik: number, ttlMs = 12 * HOUR, background = false): Promise<Financials | null> {
  return cached(CACHE_NS, String(cik), ttlMs, () => build(cik, background), { noMemory: true });
}

/** Statements plus the list of recent filings, for the company page. */
export async function companyFinancials(cik: number): Promise<Financials | null> {
  const [core, extra] = await Promise.all([companyFinancialsCore(cik), cached('filings', String(cik), 12 * HOUR, () => loadFilings(cik)).catch(() => null)]);
  if (!core) return null;
  return { ...core, filings: extra?.filings ?? [], fiscalYearEnd: extra?.fiscalYearEnd ?? core.fiscalYearEnd };
}
