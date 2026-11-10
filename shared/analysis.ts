import type { Financials, StatementSet } from './financials.ts';
import type { Answer } from './checklist.ts';
import { dcf, stressTests, type DcfInputs, type DcfResult } from './valuation.ts';

/**
 * Turns SEC financials into the workbook's "Financials" worksheet, its automatic
 * ratio summary, a starting set of valuation inputs, and data-driven suggestions
 * for the checklist questions that numbers can answer.
 */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const nums = (a: (number | null)[]) => a.filter(isNum);
const cagr = (first: number | null, last: number | null, years: number) => (isNum(first) && isNum(last) && first > 0 && last > 0 && years > 0 ? (last / first) ** (1 / years) - 1 : null);

export interface Worksheet {
  labels: string[];
  ends: string[];
  rows: Record<string, (number | null)[]>;
  ttm: Record<string, number | null> | null;
  ttmEnd: string | null;
}

export const WORKSHEET_ROWS: { key: string; label: string; fmt: 'money' | 'pct' | 'shares' }[] = [
  { key: 'revenue', label: 'Revenue', fmt: 'money' },
  { key: 'operatingIncome', label: 'Operating income / EBIT', fmt: 'money' },
  { key: 'netIncome', label: 'Net income', fmt: 'money' },
  { key: 'cfo', label: 'Operating cash flow', fmt: 'money' },
  { key: 'capex', label: 'Capital expenditures', fmt: 'money' },
  { key: 'fcf', label: 'Free cash flow = CFO − capex', fmt: 'money' },
  { key: 'totalDebt', label: 'Total debt', fmt: 'money' },
  { key: 'cash', label: 'Cash & equivalents', fmt: 'money' },
  { key: 'ebitda', label: 'EBITDA', fmt: 'money' },
  { key: 'roic', label: 'Return on invested capital (ROIC)', fmt: 'pct' },
  { key: 'roe', label: 'Return on equity (ROE)', fmt: 'pct' },
  { key: 'sharesDiluted', label: 'Diluted shares outstanding', fmt: 'shares' },
  { key: 'cashInterest', label: 'Cash interest expense', fmt: 'money' },
  { key: 'dividendsPaid', label: 'Cash dividends paid', fmt: 'money' },
];

function slice(set: StatementSet, key: string, n: number): (number | null)[] {
  return (set.values[key] ?? []).slice(-n);
}

export function buildWorksheet(fin: Financials): Worksheet {
  const n = Math.min(5, fin.annual.periods.length);
  const periods = fin.annual.periods.slice(-n);
  const rows: Record<string, (number | null)[]> = {};
  for (const r of WORKSHEET_ROWS) {
    if (r.key === 'cashInterest') {
      const paid = slice(fin.annual, 'interestPaid', n);
      const exp = slice(fin.annual, 'interestExpense', n);
      rows[r.key] = paid.map((v, i) => (isNum(v) ? Math.abs(v) : isNum(exp[i]) ? Math.abs(exp[i] as number) : null));
    } else if (r.key === 'dividendsPaid') rows[r.key] = slice(fin.annual, r.key, n).map((v) => (isNum(v) ? Math.abs(v) : null));
    else rows[r.key] = slice(fin.annual, r.key, n);
  }
  let ttm: Record<string, number | null> | null = null;
  if (fin.ttm) {
    const t = fin.ttm.values;
    ttm = {};
    for (const r of WORKSHEET_ROWS) {
      if (r.key === 'cashInterest') ttm[r.key] = isNum(t.interestPaid) ? Math.abs(t.interestPaid) : isNum(t.interestExpense) ? Math.abs(t.interestExpense) : null;
      else if (r.key === 'dividendsPaid') ttm[r.key] = isNum(t.dividendsPaid) ? Math.abs(t.dividendsPaid) : null;
      else ttm[r.key] = t[r.key] ?? null;
    }
  }
  return { labels: periods.map((p) => p.label), ends: periods.map((p) => p.end), rows, ttm, ttmEnd: fin.ttm?.period.end ?? null };
}

export interface RatioSummary {
  revCagr: number | null;
  niCagr: number | null;
  fcfCagr: number | null;
  avgRoic: number | null;
  avgRoe: number | null;
  positiveFcfYears: number | null;
  netDebtEbitda: number | null;
  fcfToNi: number | null;
  shareChange: number | null;
  ebitToInterest: number | null;
  positiveNiYears: number | null;
  revPositiveYears: number | null;
  avgFcf: number | null;
  yearsEntered: number;
  span: string;
}

/** The workbook's "Automatic ratio summary" (Financials!I11:J24), first to last fiscal year shown. */
export function ratioSummary(w: Worksheet): RatioSummary {
  const r = w.rows;
  const n = w.labels.length;
  const first = (k: string) => r[k]?.[0] ?? null;
  const last = (k: string) => r[k]?.[n - 1] ?? null;
  const intervals = Math.max(1, n - 1);
  const count = (k: string, f: (v: number) => boolean) => (nums(r[k] ?? []).length ? nums(r[k]).filter(f).length : null);
  const debt = last('totalDebt');
  const cash = last('cash');
  const ebitda = last('ebitda');
  const fcf = last('fcf');
  const ni = last('netIncome');
  const ebit = last('operatingIncome');
  const interest = last('cashInterest');
  let ebitToInterest: number | null = null;
  if (isNum(ebit) && isNum(interest) && interest >= 0) ebitToInterest = interest === 0 ? (ebit > 0 ? 100 : null) : Math.min(100, ebit / interest);
  return {
    revCagr: cagr(first('revenue'), last('revenue'), intervals),
    niCagr: cagr(first('netIncome'), last('netIncome'), intervals),
    fcfCagr: cagr(first('fcf'), last('fcf'), intervals),
    avgRoic: avg(nums(r.roic ?? [])),
    avgRoe: avg(nums(r.roe ?? [])),
    positiveFcfYears: count('fcf', (v) => v > 0),
    netDebtEbitda: isNum(debt) && isNum(cash) && isNum(ebitda) && ebitda > 0 ? Math.max(0, debt - cash) / ebitda : null,
    fcfToNi: isNum(fcf) && isNum(ni) && ni > 0 ? fcf / ni : null,
    shareChange: isNum(first('sharesDiluted')) && isNum(last('sharesDiluted')) && (first('sharesDiluted') as number) > 0 ? (last('sharesDiluted') as number) / (first('sharesDiluted') as number) - 1 : null,
    ebitToInterest,
    positiveNiYears: count('netIncome', (v) => v > 0),
    revPositiveYears: count('revenue', (v) => v > 0),
    avgFcf: avg(nums(r.fcf ?? [])),
    yearsEntered: nums(r.revenue ?? []).length,
    span: n ? `${w.labels[0]}–${w.labels[n - 1]}` : '',
  };
}

// ---------------------------------------------------------------------------------
// Valuation defaults
// ---------------------------------------------------------------------------------

export interface OwnerEarningsOption {
  id: string;
  label: string;
  value: number | null;
  how: string;
}

export interface ValuationDefaults {
  inputs: DcfInputs;
  options: OwnerEarningsOption[];
  chosen: string;
  ownerEarningsWhy: string;
  growthWhy: string;
  history: { label: string; value: number | null }[];
  latestFcfPerShare: number | null;
  eps: number | null;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export function valuationDefaults(fin: Financials, price: number | null): ValuationDefaults {
  const a = fin.annual;
  const n = a.periods.length;
  const sharesNow = [fin.ttm?.values.sharesDiluted, a.values.sharesDiluted?.[n - 1]].find((v) => isNum(v) && v > 0) ?? null;
  const perShare = (total: number | null) => (isNum(total) && isNum(sharesNow) && sharesNow > 0 ? total / sharesNow : null);
  const lastN = (key: string, k: number) => nums((a.values[key] ?? []).slice(-k));
  const meanOf = (key: string, k: number) => (lastN(key, k).length === k ? avg(lastN(key, k)) : null);

  const fcfLatest = a.values.fcf?.[n - 1] ?? null;
  const oeLatest = a.values.ownerEarnings?.[n - 1] ?? null;
  const options: OwnerEarningsOption[] = [
    { id: 'fcf3', label: '3-year average free cash flow', value: perShare(meanOf('fcf', 3)), how: 'Average of the last three fiscal years of (cash from operations − capex), divided by today’s diluted shares.' },
    { id: 'oe3', label: '3-year average owner earnings', value: perShare(meanOf('ownerEarnings', 3)), how: 'Average of the last three fiscal years of (net income + D&A − maintenance capex), with maintenance capex taken as the lesser of capex and D&A.' },
    { id: 'fcf1', label: 'Latest fiscal year free cash flow', value: perShare(fcfLatest), how: 'Cash from operations − capex for the latest fiscal year.' },
    { id: 'oe1', label: 'Latest fiscal year owner earnings', value: perShare(oeLatest), how: 'Net income + D&A − maintenance capex for the latest fiscal year.' },
    { id: 'fcf5', label: '5-year average free cash flow', value: perShare(meanOf('fcf', 5)), how: 'Average of the last five fiscal years, divided by today’s diluted shares.' },
    { id: 'fcfttm', label: 'Trailing twelve months free cash flow', value: perShare(fin.ttm?.values.fcf ?? null), how: 'Last four reported quarters.' },
    { id: 'eps', label: 'Diluted EPS (latest fiscal year)', value: a.values.eps?.[n - 1] ?? null, how: 'Reported earnings per share — shown for reference; it ignores capital spending.' },
  ];
  // Conservative default: the lowest positive figure among the 3-year averages and latest-year values.
  const core = options.filter((o) => ['fcf3', 'oe3', 'fcf1', 'oe1'].includes(o.id) && isNum(o.value));
  const positive = core.filter((o) => (o.value as number) > 0);
  let chosen = '';
  let oe: number | null = null;
  let why: string;
  if (core.length && positive.length === core.length) {
    const pick = positive.reduce((m, o) => ((o.value as number) < (m.value as number) ? o : m));
    chosen = pick.id;
    oe = Math.round((pick.value as number) * 100) / 100;
    why = `Started from the lowest of the four core estimates (${pick.label.toLowerCase()}), so the figure leans conservative. Replace it with your own cycle-normalized estimate.`;
  } else if (positive.length) {
    why = 'Some recent years show negative free cash flow or owner earnings, so no figure is filled in automatically. Enter a normalized estimate only if you can justify one.';
  } else {
    why = 'Free cash flow and owner earnings have been negative, so this cash-flow model does not apply as it stands.';
  }

  const k = Math.min(5, n) - 1;
  const firstIdx = n - 1 - k;
  const hist = [
    { label: `Revenue CAGR (${k}y)`, value: k > 0 ? cagr(a.values.revenue?.[firstIdx] ?? null, a.values.revenue?.[n - 1] ?? null, k) : null },
    { label: `EPS CAGR (${k}y)`, value: k > 0 ? cagr(a.values.eps?.[firstIdx] ?? null, a.values.eps?.[n - 1] ?? null, k) : null },
    { label: `FCF/share CAGR (${k}y)`, value: k > 0 ? cagr(a.values.fcfPerShare?.[firstIdx] ?? null, a.values.fcfPerShare?.[n - 1] ?? null, k) : null },
  ];
  const defined = nums(hist.map((h) => h.value)).sort((x, y) => x - y);
  let g1 = 0.03;
  let growthWhy: string;
  if (defined.length) {
    const med = defined[Math.floor((defined.length - 1) / 2)];
    g1 = Math.min(0.12, Math.max(0, roundTo(med * 0.75, 0.005)));
    growthWhy = `Years 1–5 start at three-quarters of the lower-middle historical growth rate (${(med * 100).toFixed(1)}%), capped at 12% and floored at 0%. Years 6–10 fade halfway toward the 2% terminal rate.`;
  } else {
    growthWhy = 'No clean five-year growth history is available, so years 1–5 default to 3%.';
  }
  const terminal = 0.02;
  const g2 = Math.max(terminal, roundTo((g1 + terminal) / 2, 0.005));
  return {
    inputs: { price, ownerEarnings: oe, marginOfSafety: 0.25, discountRate: 0.1, growth1to5: g1, growth6to10: g2, terminalGrowth: terminal },
    options,
    chosen,
    ownerEarningsWhy: why,
    growthWhy,
    history: hist,
    latestFcfPerShare: perShare(fin.ttm?.values.fcf ?? fcfLatest),
    eps: fin.ttm?.values.eps ?? a.values.eps?.[n - 1] ?? null,
  };
}

// ---------------------------------------------------------------------------------
// Checklist suggestions
// ---------------------------------------------------------------------------------

export interface Suggestion {
  /** 'data' answers are applied automatically; 'lean' is a hint; 'judgment' needs the reader. */
  kind: 'data' | 'lean' | 'judgment';
  answer: Answer;
  reason: string;
  facts: { label: string; value: string }[];
  verify: string;
}

const pc = (v: number | null | undefined, dp = 1) => (isNum(v) ? `${(v * 100).toFixed(dp)}%` : 'n/a');
const xx = (v: number | null | undefined, dp = 1) => (isNum(v) ? `${v.toFixed(dp)}x` : 'n/a');
const money = (v: number | null | undefined) => {
  if (!isNum(v)) return 'n/a';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toFixed(0)}`;
};

export interface SuggestContext {
  fin: Financials | null;
  worksheet: Worksheet | null;
  summary: RatioSummary | null;
  thresholds: Record<string, number>;
  dcfInputs: DcfInputs;
  dcfResult: DcfResult;
  sector: string;
  industry: string;
}

export function suggestAnswers(c: SuggestContext): Record<string, Suggestion> {
  const out: Record<string, Suggestion> = {};
  const judgment = (id: string, reason: string, verify: string, facts: Suggestion['facts'] = []) => {
    out[id] = { kind: 'judgment', answer: '', reason, facts, verify };
  };
  const data = (id: string, answer: Answer, reason: string, facts: Suggestion['facts'], verify: string, kind: 'data' | 'lean' = 'data') => {
    out[id] = { kind, answer, reason, facts, verify };
  };
  const s = c.summary;
  const w = c.worksheet;
  const a = c.fin?.annual;
  const n = a?.periods.length ?? 0;
  const series = (k: string, m = 10) => (a ? nums((a.values[k] ?? []).slice(-m)) : []);
  const th = (id: string, d: number) => c.thresholds[id] ?? d;
  const noData = 'Financial statements are not available from SEC XBRL data for this company, so this cannot be assessed automatically.';

  // -- Understand
  judgment('u1', 'Only you can say whether you understand the business. Read how revenue, costs and unit economics are described before answering.', '10-K Item 1 (Business) and Item 7 (MD&A); revenue note in the financial statements.', [
    { label: 'Sector / industry', value: [c.sector, c.industry].filter(Boolean).join(' · ') || 'n/a' },
    { label: 'Gross margin (latest FY)', value: pc(a?.values.grossMargin?.[n - 1]) },
  ]);
  judgment('u2', 'A judgment about durability. The record below shows how long and how steadily the business has grown, which is context, not an answer.', '10-K risk factors; ten-year revenue and margin history on the Financials tab.', [
    { label: 'Fiscal years of data', value: String(n) },
    { label: 'Years revenue grew', value: a ? `${nums(a.values.revenueGrowth ?? []).filter((v) => v > 0).length} of ${nums(a.values.revenueGrowth ?? []).length}` : 'n/a' },
  ]);
  {
    const g = series('revenueGrowth');
    const gm = series('grossMargin');
    if (g.length >= 5) {
      const worst = Math.min(...g);
      const steady = worst > -0.1 && sd(gm) < 0.05;
      data('u3', steady ? 'Yes' : 'Uncertain', steady ? 'Revenue has not fallen sharply in any year on record and gross margin has been steady — consistent with a stable industry. Confirm that the stability is structural.' : 'Revenue or gross margin has swung meaningfully, which can signal a less stable industry. Check whether the swings were one-offs.', [
        { label: 'Worst annual revenue change', value: pc(worst) },
        { label: 'Gross margin variability (std. dev.)', value: gm.length ? `${(sd(gm) * 100).toFixed(1)} pts` : 'n/a' },
      ], 'Industry sections of the 10-K; competitor filings.', 'lean');
    } else judgment('u3', 'Not enough history to gauge industry stability from the numbers.', 'Industry sections of the 10-K; competitor filings.');
  }
  {
    const cfo = series('cfo', 5);
    const ni = series('netIncome', 5);
    const sbc = a?.values.sbc?.[n - 1];
    const rev = a?.values.revenue?.[n - 1];
    judgment('u4', 'Transparency is a reading judgment. Large gaps between profit and cash, or heavy stock compensation, are worth understanding first.', '10-K accounting policies note, segment note and auditor’s report.', [
      { label: '5-yr cash from operations / net income', value: cfo.length && ni.length && ni.reduce((x, y) => x + y, 0) > 0 ? xx(cfo.reduce((x, y) => x + y, 0) / ni.reduce((x, y) => x + y, 0), 2) : 'n/a' },
      { label: 'Stock compensation / revenue', value: isNum(sbc) && isNum(rev) && rev > 0 ? pc(sbc / rev) : 'n/a' },
    ]);
  }
  judgment('u5', 'Who buys, why, and what could change demand is not in the numbers.', '10-K Item 1 (customers, concentration), investor presentations.');

  // -- Moat
  {
    const roic = series('roic');
    const gm = series('grossMargin');
    if (roic.length >= 5) {
      const strong = roic.filter((v) => v >= 0.15).length >= Math.ceil(roic.length * 0.8) && sd(gm) < 0.05;
      data('m1', strong ? 'Yes' : 'Uncertain', strong ? 'Returns on capital have stayed above 15% almost every year with steady gross margins — the financial footprint a moat usually leaves. Name the source of the advantage before accepting this.' : 'The numbers alone do not show a persistent excess return. A moat may still exist; identify it explicitly.', [
        { label: `Years with ROIC ≥ 15%`, value: `${roic.filter((v) => v >= 0.15).length} of ${roic.length}` },
        { label: 'Average ROIC', value: pc(avg(roic)) },
      ], 'Competitive position in 10-K Item 1; market share data; peer comparison on the Compare tab.', 'lean');
    } else judgment('m1', 'Not enough return-on-capital history to infer a moat.', 'Competitive position in 10-K Item 1; peer comparison on the Compare tab.');
  }
  {
    const gm = series('grossMargin', 5);
    const rc = s?.revCagr;
    if (gm.length >= 4 && isNum(rc)) {
      const held = gm[gm.length - 1] >= (avg(gm) as number) - 0.01;
      const ok = held && rc > 0;
      data('m2', ok ? 'Yes' : 'Uncertain', ok ? 'Gross margin has held or widened while revenue grew, which is what pricing power looks like in the accounts. Verify with actual price actions.' : 'Gross margin has slipped or revenue has not grown, so pricing power is not evident from the accounts.', [
        { label: 'Gross margin, latest vs 5-yr average', value: `${pc(gm[gm.length - 1])} vs ${pc(avg(gm))}` },
        { label: 'Revenue CAGR', value: pc(rc) },
      ], 'MD&A discussion of price vs volume; earnings call commentary.', 'lean');
    } else judgment('m2', 'Gross margin history is not available to gauge pricing power.', 'MD&A discussion of price vs volume.');
  }
  if (w && s) {
    const roic = nums(w.rows.roic);
    const t = th('avgRoic', 0.12);
    if (roic.length >= 3) {
      const yearsAbove = roic.filter((v) => v >= t).length;
      const ans: Answer = isNum(s.avgRoic) && s.avgRoic >= t && yearsAbove >= roic.length - 1 ? 'Yes' : isNum(s.avgRoic) && s.avgRoic < t * 0.66 ? 'No' : 'Uncertain';
      data('m3', ans, ans === 'Yes' ? `ROIC averaged ${pc(s.avgRoic)} and cleared ${pc(t, 0)} in ${yearsAbove} of ${roic.length} years.` : ans === 'No' ? `ROIC averaged only ${pc(s.avgRoic)}, well under the ${pc(t, 0)} screen.` : `ROIC averaged ${pc(s.avgRoic)} but was above ${pc(t, 0)} in only ${yearsAbove} of ${roic.length} years.`, [
        { label: 'ROIC by year', value: roic.map((v) => pc(v, 0)).join(' · ') },
      ], 'Quant Tests; compare with the cost of capital and with peers.');
    } else data('m3', 'Uncertain', 'ROIC cannot be computed for enough years.', [], 'Quant Tests.');
  } else data('m3', 'Uncertain', noData, [], 'Quant Tests.');
  judgment('m4', 'Look for retention, repeat purchase, share stability or other behavior that shows customers prefer this company.', 'Company KPIs (retention, churn, same-store sales), market-share studies.');
  {
    const roic = series('roic', 6);
    if (roic.length >= 5) {
      const early = avg(roic.slice(0, 3)) as number;
      const late = avg(roic.slice(-3)) as number;
      const holding = late >= early - 0.02;
      data('m5', holding ? 'Yes' : 'Uncertain', holding ? 'Returns on capital have not eroded over the last several years. Structural barriers still need to be identified.' : 'Returns on capital have drifted down, which is what competitive erosion looks like.', [{ label: 'ROIC, earlier vs recent 3-yr average', value: `${pc(early)} → ${pc(late)}` }], 'Competitor filings; new-entrant activity.', 'lean');
    } else judgment('m5', 'Not enough history to see whether returns are being competed away.', 'Competitor filings; new-entrant activity.');
  }
  judgment('m6', 'Retention and expansion of valuable customers is a company-specific metric.', 'Retention / net revenue retention disclosures, cohort data, investor days.');

  // -- Management
  judgment('g1', 'Integrity cannot be scored from financial data. Read how management has communicated bad news and whether past promises were kept.', 'Shareholder letters, proxy statement (DEF 14A), 8-K history, any SEC enforcement or restatements.');
  {
    const fcf = series('fcf', 5);
    const div = series('dividendsPaid', 5).map(Math.abs);
    const bb = series('buybacks', 5).map(Math.abs);
    const acq = series('acquisitions', 5).map(Math.abs);
    const totalFcf = fcf.reduce((x, y) => x + y, 0);
    const returned = div.reduce((x, y) => x + y, 0) + bb.reduce((x, y) => x + y, 0);
    if (fcf.length >= 3 && s) {
      const ok = totalFcf > 0 && returned <= totalFcf * 1.15 && isNum(s.avgRoic) && s.avgRoic >= 0.1;
      data('g2', ok ? 'Yes' : 'Uncertain', ok ? 'Dividends and buybacks have been funded out of free cash flow and reinvested capital has earned a healthy return. Review acquisitions individually.' : 'Shareholder distributions have exceeded free cash flow, or returns on reinvested capital are modest. Look closely at how cash has been deployed.', [
        { label: '5-yr free cash flow', value: money(totalFcf) },
        { label: '5-yr dividends + buybacks', value: money(returned) },
        { label: '5-yr acquisitions', value: money(acq.reduce((x, y) => x + y, 0)) },
      ], 'Cash flow statement (financing and investing sections), acquisition history, MD&A.', 'lean');
    } else judgment('g2', 'Cash deployment history is not available.', 'Cash flow statement, acquisition history.');
  }
  {
    const bb = series('buybacks', 5).map(Math.abs);
    const total = bb.reduce((x, y) => x + y, 0);
    const sc = s?.shareChange;
    if (total > 0 && isNum(sc)) {
      const reduced = sc < -0.01;
      data('g3', reduced ? 'Uncertain' : 'No', reduced ? `The share count fell ${pc(-sc)} over five years, so repurchases did more than offset dilution. Whether the prices paid were attractive is still your call — compare buyback years with the valuation then.` : `${money(total)} was spent on repurchases over five years yet the share count ${sc > 0.01 ? `rose ${pc(sc)}` : 'barely moved'}: buybacks mostly offset dilution.`, [
        { label: '5-yr buyback spend', value: money(total) },
        { label: 'Diluted share count change', value: pc(sc) },
      ], 'Repurchase table in 10-K Item 5; average price paid per share by quarter.', 'lean');
    } else judgment('g3', total > 0 ? 'Repurchase data is incomplete.' : 'No meaningful share repurchases in the last five years, so there is nothing to judge. Answer on whether that restraint was sensible.', '10-K Item 5 (issuer purchases of equity securities).', [{ label: 'Diluted share count change (5y)', value: pc(sc) }]);
  }
  judgment('g4', 'Pay design is disclosed in the proxy statement, not the financials.', 'Proxy statement (DEF 14A): compensation discussion and analysis, performance metrics.');
  judgment('g5', 'Read the letters: do they explain mistakes and trade-offs, or only good news?', 'Annual shareholder letters over several years.');

  // -- Financials
  if (w && s) {
    const t = th('avgRoic', 0.12);
    data('f1', isNum(s.avgRoic) ? (s.avgRoic >= t ? 'Yes' : 'No') : 'Uncertain', isNum(s.avgRoic) ? `Five-year average ROIC is ${pc(s.avgRoic)} against a ${pc(t, 0)} screen.` : 'ROIC could not be computed.', [
      { label: 'Average ROIC', value: pc(s.avgRoic) },
      { label: 'Average ROE', value: pc(s.avgRoe) },
    ], 'Quant Tests; check the ROIC definition, acquisitions and accounting.');

    const tf = th('positiveFcfYears', 4);
    const years = nums(w.rows.fcf).length;
    data('f2', isNum(s.positiveFcfYears) && years >= 3 ? (s.positiveFcfYears >= Math.min(tf, years) && (s.avgFcf ?? 0) > 0 ? 'Yes' : s.positiveFcfYears <= years / 2 ? 'No' : 'Uncertain') : 'Uncertain', isNum(s.positiveFcfYears) ? `Free cash flow was positive in ${s.positiveFcfYears} of ${years} years, averaging ${money(s.avgFcf)}.` : 'Free cash flow history is not available.', [
      { label: 'FCF by year', value: w.rows.fcf.map((v) => money(v)).join(' · ') },
    ], 'Cash flow statement over a full cycle.');

    const cumF = nums(w.rows.fcf).reduce((x, y) => x + y, 0);
    const cumN = nums(w.rows.netIncome).reduce((x, y) => x + y, 0);
    const cumC = nums(w.rows.cfo).reduce((x, y) => x + y, 0);
    const conv = cumN > 0 ? cumF / cumN : null;
    const tc = th('fcfToNi', 0.8);
    data('f3', isNum(conv) ? (conv >= tc || cumC / cumN >= 1.1 ? 'Yes' : conv < tc * 0.6 ? 'No' : 'Uncertain') : 'Uncertain', isNum(conv) ? `Over five years, free cash flow was ${xx(conv, 2)} of net income and operating cash flow ${xx(cumC / cumN, 2)}.` : 'Cumulative net income is not positive, so conversion is not meaningful.', [
      { label: '5-yr FCF / net income', value: xx(conv, 2) },
      { label: 'Latest-year FCF / net income', value: xx(s.fcfToNi, 2) },
    ], 'Cash flow statement; working-capital movements.');

    const tl = th('netDebtEbitda', 2.5);
    const ti = th('ebitToInterest', 5);
    const lev = s.netDebtEbitda;
    const cov = s.ebitToInterest;
    let f4: Answer = 'Uncertain';
    if (isNum(lev)) {
      if (lev <= tl && (!isNum(cov) || cov >= ti)) f4 = 'Yes';
      else if (lev > tl * 1.6 || (isNum(cov) && cov < ti / 2)) f4 = 'No';
    }
    data('f4', f4, isNum(lev) ? `Net debt is ${xx(lev)} EBITDA (screen ≤ ${xx(tl)}); EBIT covers cash interest ${isNum(cov) ? xx(cov) : 'n/a'} (screen ≥ ${xx(ti, 0)}).` : 'Leverage could not be computed (EBITDA is missing or negative).', [
      { label: 'Total debt / cash', value: `${money(w.rows.totalDebt.at(-1))} / ${money(w.rows.cash.at(-1))}` },
      { label: 'Net debt / EBITDA', value: xx(lev) },
      { label: 'EBIT / cash interest', value: xx(cov) },
    ], 'Debt note and maturity schedule in the 10-K; covenant disclosures.');

    const om = series('operMargin', 5);
    const niYears = nums(w.rows.netIncome);
    let f5: Answer = 'Uncertain';
    if (niYears.length >= 3 && om.length >= 3) {
      const mean = avg(om) as number;
      if (niYears.every((v) => v > 0) && mean > 0 && Math.min(...om) >= mean * 0.6) f5 = 'Yes';
      else if (niYears.some((v) => v <= 0)) f5 = 'No';
    }
    data('f5', f5, f5 === 'Yes' ? 'Profitable in every one of the last five years, and the weakest operating margin stayed within reach of the average.' : f5 === 'No' ? 'At least one of the last five years was loss-making.' : 'Profits were positive but margins have moved around enough to warrant a closer look.', [
      { label: 'Operating margin by year', value: om.map((v) => pc(v, 0)).join(' · ') || 'n/a' },
      { label: 'Profitable years', value: `${s.positiveNiYears ?? 'n/a'} of ${niYears.length}` },
    ], 'Segment results through the last downturn.');

    const capex = nums(w.rows.capex).reduce((x, y) => x + y, 0);
    const intensity = cumC > 0 ? capex / cumC : null;
    data('f6', isNum(intensity) ? (intensity <= 0.5 ? 'Yes' : intensity > 0.75 ? 'No' : 'Uncertain') : 'Uncertain', isNum(intensity) ? `Capital spending absorbed ${pc(intensity, 0)} of operating cash flow over five years.` : 'Operating cash flow is not positive, so capital intensity is not meaningful.', [
      { label: '5-yr capex / operating cash flow', value: pc(intensity, 0) },
      { label: 'Capex vs D&A (latest)', value: `${money(w.rows.capex.at(-1))} vs ${money(a?.values.da?.[n - 1])}` },
    ], 'Capex breakdown (maintenance vs growth) in MD&A; PP&E note.');

    const ts = th('shareChange', 0.05);
    const sc = s.shareChange;
    const epsC = a ? cagr(a.values.eps?.[Math.max(0, n - 5)] ?? null, a.values.eps?.[n - 1] ?? null, Math.min(4, n - 1)) : null;
    let f7: Answer = 'Uncertain';
    if (isNum(sc)) {
      if (sc <= ts) f7 = 'Yes';
      else if (isNum(epsC) && epsC > sc / 4 + 0.03) f7 = 'Yes';
      else f7 = 'No';
    }
    data('f7', f7, isNum(sc) ? `Diluted shares ${sc <= 0 ? `fell ${pc(-sc)}` : `rose ${pc(sc)}`} over five years (screen ≤ +${pc(ts, 0)})${sc > ts && f7 === 'Yes' ? ', but per-share earnings grew faster than the dilution' : ''}.` : 'Share count history is not available.', [
      { label: 'Share count change', value: pc(sc) },
      { label: 'EPS CAGR', value: pc(epsC) },
    ], 'Equity note; stock-compensation disclosures.');

    let f8: Answer = 'Uncertain';
    if (om.length >= 4) {
      const mean = avg(om) as number;
      const latest = om[om.length - 1];
      if (latest >= mean - 0.02 && sd(om) <= 0.04 && latest > 0) f8 = 'Yes';
      else if (latest < mean - 0.05 || latest <= 0) f8 = 'No';
    }
    data('f8', f8, om.length >= 4 ? `Latest operating margin ${pc(om[om.length - 1])} vs five-year average ${pc(avg(om))}; year-to-year variability ${(sd(om) * 100).toFixed(1)} pts.` : 'Margin history is not available.', [
      { label: 'Gross margin (latest)', value: pc(a?.values.grossMargin?.[n - 1]) },
      { label: 'Net margin (latest)', value: pc(a?.values.netMargin?.[n - 1]) },
    ], 'Peer margins on the Compare tab; MD&A explanation of margin changes.');

    const cr = c.fin?.ttm?.values.currentRatio ?? a?.values.currentRatio?.[n - 1] ?? null;
    const fcfL = w.rows.fcf.at(-1);
    const nd = isNum(w.rows.totalDebt.at(-1)) && isNum(w.rows.cash.at(-1)) ? (w.rows.totalDebt.at(-1) as number) - (w.rows.cash.at(-1) as number) : null;
    const payback = isNum(nd) && isNum(fcfL) && fcfL > 0 ? Math.max(0, nd) / fcfL : null;
    let f9: Answer = 'Uncertain';
    if ((isNum(cr) && cr >= 1) || (isNum(payback) && payback <= 3)) f9 = 'Yes';
    else if (isNum(cr) && cr < 0.7 && isNum(lev) && lev > 3) f9 = 'No';
    data('f9', f9, `Current ratio ${xx(cr, 2)}; net debt would take ${isNum(payback) ? `${payback.toFixed(1)} years` : 'n/a'} of free cash flow to repay. The maturity schedule itself is in the 10-K debt note.`, [
      { label: 'Current ratio', value: xx(cr, 2) },
      { label: 'Net debt', value: money(nd) },
    ], 'Debt maturity table and liquidity section of the 10-K.');
  } else {
    for (const id of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9']) data(id, 'Uncertain', noData, [], 'Company filings.');
  }

  // -- Risk
  judgment('r1', 'Regulatory, legal and existential risks have to be read, not computed.', '10-K Item 1A (Risk Factors) and Item 3 (Legal Proceedings).');
  {
    const g = series('revenueGrowth', 12);
    const ni = series('netIncome', 12);
    if (g.length >= 7) {
      const worst = Math.min(...g);
      const ok = ni.every((v) => v > 0) && worst > -0.15;
      data('r2', ok ? 'Yes' : 'Uncertain', ok ? `Across ${ni.length} fiscal years the company stayed profitable and its worst revenue decline was ${pc(worst)}.` : `The record includes ${ni.filter((v) => v <= 0).length} loss year(s) and a worst revenue decline of ${pc(worst)}; check how the balance sheet coped.`, [
        { label: 'Worst annual revenue change', value: pc(worst) },
        { label: 'Loss-making years', value: `${ni.filter((v) => v <= 0).length} of ${ni.length}` },
      ], 'Results through 2020 and any earlier downturn in the Financials tab.', 'lean');
    } else judgment('r2', 'Not enough history to see a downturn in the data.', 'Results through the last recession.');
  }
  judgment('r3', 'Check the audit opinion, any restatements, related-party transactions and late filings.', 'Auditor’s report and Item 9A (Controls) in the 10-K; 8-K Item 4.02; NT filings.');
  judgment('r4', 'Customer and product concentration is disclosed in the segment and customer notes.', '10-K segment note; "major customers" disclosure.');
  judgment('r5', 'Displacement risk depends on technology and business-model change in the industry.', 'Industry research; R&D direction; competitor product road maps.');

  // -- Valuation
  const r = c.dcfResult;
  const i = c.dcfInputs;
  {
    const years = w ? nums(w.rows.fcf).length : 0;
    const pos = s?.positiveFcfYears ?? null;
    let v1: Answer = 'Uncertain';
    if (isNum(i.ownerEarnings) && i.ownerEarnings > 0 && isNum(pos) && years >= 3 && pos >= years - 1) v1 = 'Yes';
    else if (isNum(pos) && years >= 3 && pos <= years / 2) v1 = 'No';
    data('v1', v1, v1 === 'Yes' ? `Free cash flow was positive in ${pos} of ${years} years, so a normalized owner-earnings figure can be anchored in the record.` : v1 === 'No' ? 'Cash flow has been negative too often to anchor a conservative estimate.' : 'Enter a normalized owner-earnings figure on the Valuation tab; the record is too uneven to set one automatically.', [
      { label: 'Owner earnings / share used', value: isNum(i.ownerEarnings) ? `$${i.ownerEarnings.toFixed(2)}` : 'not set' },
    ], 'Valuation tab: how the owner-earnings figure was built.');
  }
  {
    const issues: string[] = [];
    if (i.discountRate < 0.08) issues.push('discount rate below 8%');
    if (i.terminalGrowth > 0.03) issues.push('perpetual growth above 3%');
    if (i.discountRate <= i.terminalGrowth) issues.push('discount rate not above perpetual growth');
    if (i.growth1to5 > 0.15) issues.push('years 1–5 growth above 15%');
    if (i.growth6to10 > i.growth1to5 + 1e-9) issues.push('growth does not fade after year 5');
    if (isNum(r.terminalShare) && r.terminalShare > 0.75) issues.push(`terminal value is ${pc(r.terminalShare, 0)} of the total`);
    data('v2', !r.valid ? 'Uncertain' : issues.length ? 'No' : 'Yes', !r.valid ? 'The valuation model needs valid inputs first.' : issues.length ? `Inputs to revisit: ${issues.join('; ')}.` : 'Discount rate, growth and terminal assumptions are all inside conservative bounds, and the terminal value does not dominate.', [
      { label: 'Discount / growth 1–5 / 6–10 / terminal', value: `${pc(i.discountRate)} / ${pc(i.growth1to5)} / ${pc(i.growth6to10)} / ${pc(i.terminalGrowth)}` },
      { label: 'Terminal value share', value: pc(r.terminalShare, 0) },
    ], 'Valuation tab.');
  }
  data('v3', r.status === 'AT / BELOW BUY ZONE' ? 'Yes' : r.status === 'ABOVE BUY ZONE' ? 'No' : 'Uncertain', r.status === 'NEEDS INPUT / FIX' ? 'The valuation model needs valid inputs first.' : `Price $${(i.price ?? 0).toFixed(2)} vs buy-below $${(r.buyBelow ?? 0).toFixed(2)} (intrinsic value $${(r.intrinsicValue ?? 0).toFixed(2)} less a ${pc(i.marginOfSafety, 0)} margin of safety).`, [
    { label: 'Discount to intrinsic value', value: pc(r.discountToValue) },
  ], 'Valuation tab.');
  {
    const st = r.valid ? stressTests(i) : [];
    const singles = st.slice(0, 3);
    const allHold = singles.length === 3 && singles.every((x) => x.holds === true);
    const anyKnown = singles.some((x) => x.holds != null);
    data('v4', !r.valid || !anyKnown ? 'Uncertain' : allHold ? 'Yes' : 'No', !r.valid ? 'The valuation model needs valid inputs first.' : allHold ? 'Intrinsic value stays above today’s price under each of the three stress tests.' : `Value falls below today’s price under: ${singles.filter((x) => x.holds === false).map((x) => x.label.toLowerCase()).join('; ')}.`, st.map((x) => ({ label: x.label, value: isNum(x.value) ? `$${x.value.toFixed(2)}` : 'n/a' })), 'Valuation tab: stress tests.');
  }
  return out;
}

export function isSpecialistSector(sector: string, sic?: string | null): boolean {
  const code = Number(sic ?? 0);
  if (code >= 6000 && code <= 6799) return true;
  return sector === 'Finance' || sector === 'Real Estate';
}

export { dcf };
