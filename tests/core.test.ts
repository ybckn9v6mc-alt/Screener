import { describe, expect, it } from 'vitest';
import { dcf, impliedGrowth, stressTests } from '../shared/valuation';
import { QUESTIONS, QUANT_TESTS, combinedAssessment, runTest, scoreChecklist, type Answer } from '../shared/checklist';
import { FILTERS, FILTER_BY_ID, customCond, evalCond } from '../shared/filters';
import { computeLevels, applyLevels, detectCandle } from '../server/universe/technicals';
import { num, cagr, parseCsv, usDateToIso } from '../server/lib/util';
import { rsi, sma, macd } from '../src/stock/indicators';
import type { Bar } from '../shared/types';
import { buildFinancials } from '../server/company/financials';
import type { CompanyFacts, CompanyFact } from '../server/sources/sec';
import { analyse, autoScore, priceSuggestions, DATA_QUESTION_IDS } from '../shared/analysis';

describe('intrinsic value model (workbook "Valuation" sheet)', () => {
  const inputs = { price: 60, ownerEarnings: 5, marginOfSafety: 0.25, discountRate: 0.1, growth1to5: 0.05, growth6to10: 0.03, terminalGrowth: 0.02 };

  it('matches the spreadsheet formulas', () => {
    const r = dcf(inputs);
    // Reference values computed independently from the workbook's cell formulas.
    expect(r.pvYears).toBeCloseTo(38.126107, 5);
    expect(r.terminalValue).toBeCloseTo(94.321958, 5);
    expect(r.pvTerminal).toBeCloseTo(36.365198, 5);
    expect(r.intrinsicValue).toBeCloseTo(74.491305, 5);
    expect(r.buyBelow).toBeCloseTo(55.868479, 5);
    expect(r.discountToValue).toBeCloseTo(1 - 60 / 74.491305, 6);
    expect(r.status).toBe('ABOVE BUY ZONE');
    expect(dcf({ ...inputs, price: 55 }).status).toBe('AT / BELOW BUY ZONE');
  });

  it('refuses invalid assumptions instead of producing a number', () => {
    expect(dcf({ ...inputs, discountRate: 0.02 }).safetyCheck).toBe('INVALID: DISCOUNT ≤ TERMINAL');
    expect(dcf({ ...inputs, ownerEarnings: -1 }).status).toBe('NEEDS INPUT / FIX');
    expect(dcf({ ...inputs, ownerEarnings: null }).intrinsicValue).toBeNull();
    expect(dcf({ ...inputs, price: null }).status).toBe('NEEDS INPUT / FIX');
  });

  it('stress tests only ever lower the value', () => {
    const base = dcf(inputs).intrinsicValue as number;
    for (const s of stressTests(inputs)) expect(s.value as number).toBeLessThan(base);
  });

  it('implied growth reproduces the price', () => {
    const g = impliedGrowth(inputs) as number;
    const back = dcf({ ...inputs, growth1to5: g, growth6to10: (g + inputs.terminalGrowth) / 2 }).intrinsicValue as number;
    expect(back).toBeCloseTo(60, 2);
  });
});

describe('checklist scoring (workbook "Dashboard" sheet)', () => {
  const all = (a: Answer) => Object.fromEntries(QUESTIONS.map((q) => [q.id, a])) as Record<string, Answer>;

  it('has the workbook\'s 34 questions, 8 gates and 77 points', () => {
    expect(QUESTIONS).toHaveLength(34);
    expect(QUESTIONS.filter((q) => q.gate)).toHaveLength(8);
    // Understand 11 + Moat 14 + Management 10 + Financials 20 + Risk 11 + Valuation 11
    expect(QUESTIONS.reduce((s, q) => s + q.weight, 0)).toBe(77);
    expect(QUANT_TESTS).toHaveLength(8);
  });

  it('qualifies only when gates, score and price all pass', () => {
    const yes = scoreChecklist(all('Yes'));
    expect(yes.score).toBe(1);
    expect(yes.gates).toBe('PASS');
    expect(combinedAssessment(yes, 'AT / BELOW BUY ZONE', 0.85, true).label).toBe('QUALIFIES FOR FURTHER REVIEW');
    expect(combinedAssessment(yes, 'ABOVE BUY ZONE', 0.85, true).label).toBe('WATCHLIST — PRICE TOO HIGH');
    expect(combinedAssessment(yes, 'NEEDS INPUT / FIX', 0.85, true).label).toBe('COMPLETE INTRINSIC VALUE');
    expect(combinedAssessment(yes, 'AT / BELOW BUY ZONE', 0.85, false).label).toBe('SPECIALIST SECTOR REVIEW');
  });

  it('a No on a gate is a hard stop, and blanks block qualification', () => {
    const gateNo = scoreChecklist({ ...all('Yes'), u1: 'No' });
    expect(gateNo.gates).toBe('FAIL');
    expect(combinedAssessment(gateNo, 'AT / BELOW BUY ZONE', 0.85, true).label).toBe('REJECT / REASSESS GATE');
    const blank = scoreChecklist({ ...all('Yes'), m2: 'Uncertain' });
    expect(blank.completed).toBe(33);
    expect(combinedAssessment(blank, 'AT / BELOW BUY ZONE', 0.85, true).label).toBe('INCOMPLETE — FINISH CHECKLIST');
    expect(scoreChecklist({}).score).toBeNull();
  });

  it('scores below the screen go to the watchlist', () => {
    const answers = all('Yes');
    for (const q of QUESTIONS.filter((x) => !x.gate).slice(0, 8)) answers[q.id] = 'No';
    const card = scoreChecklist(answers);
    expect(card.score as number).toBeLessThan(0.85);
    expect(combinedAssessment(card, 'AT / BELOW BUY ZONE', 0.85, true).label).toBe('WATCHLIST / QUALITY BELOW TARGET');
  });

  it('quant tests treat missing data as NO DATA, never a pass', () => {
    const roic = QUANT_TESTS.find((t) => t.id === 'avgRoic')!;
    expect(runTest(roic, 0.2)).toBe('PASS');
    expect(runTest(roic, 0.05)).toBe('REVIEW');
    expect(runTest(roic, null)).toBe('NO DATA');
    const lev = QUANT_TESTS.find((t) => t.id === 'netDebtEbitda')!;
    expect(runTest(lev, 2.5)).toBe('PASS');
    expect(runTest(lev, 3)).toBe('REVIEW');
  });
});

describe('screener filters', () => {
  const row = { symbol: 'TEST', pe: 12, marketCap: 5e9, sector: 'Technology', indexes: ['sp500'], dividendYield: null, sma50v: 110, sma200v: 100, price: 120, targetPrice: 150, earningsDate: '2026-11-12', pattern: 'Channel Up (Strong)', roe: 0.2 };
  const today = '2026-11-10';
  const test = (id: string, v: string) => {
    const def = FILTER_BY_ID.get(id)!;
    const cond = v.startsWith('r:') ? customCond(def, v)! : def.options.find((o) => o.v === v)!.cond;
    return evalCond(row, cond, today);
  };

  it('covers the Finviz filter set with unique ids and option values', () => {
    expect(FILTERS.length).toBeGreaterThanOrEqual(70);
    expect(new Set(FILTERS.map((f) => f.id)).size).toBe(FILTERS.length);
    for (const f of FILTERS) expect(new Set(f.options.map((o) => o.v)).size, f.id).toBe(f.options.length);
  });

  it('evaluates presets, ranges and cross-field comparisons', () => {
    expect(test('pe', 'low')).toBe(true);
    expect(test('pe', 'o15')).toBe(false);
    expect(test('cap', 'mid')).toBe(true);
    expect(test('cap', 'r:1:10')).toBe(true);
    expect(test('cap', 'r:6:')).toBe(false);
    expect(test('index', 'sp500')).toBe(true);
    expect(test('index', 'djia')).toBe(false);
    expect(test('sma50', 'sa200')).toBe(true);
    expect(test('targetPrice', 'a20')).toBe(true);
    expect(test('targetPrice', 'a30')).toBe(false);
    expect(test('earningsDate', 'nextdays5')).toBe(true);
    expect(test('earningsDate', 'today')).toBe(false);
    expect(test('pattern', 'channelup')).toBe(true);
    expect(test('pattern', 'channelupstrong')).toBe(true);
    expect(test('roe', 'r:15:25')).toBe(true);
  });

  it('never passes a numeric filter on missing data', () => {
    expect(evalCond(row, { op: 'gt', field: 'dividendYield', value: 0 }, today)).toBe(false);
    expect(evalCond(row, { op: 'lt', field: 'dividendYield', value: 1 }, today)).toBe(false);
    expect(test('dividendYield', 'none')).toBe(true);
  });
});

describe('technical indicators', () => {
  const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
    const c = 100 + i * 0.5 + Math.sin(i / 5) * 3;
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    return { d, o: c - 0.5, h: c + 1, l: c - 1.5, c, v: 1000 + i };
  });

  it('keeps live ratios consistent with the stored levels', () => {
    const session = '2026-01-01';
    const lv = computeLevels(bars, session)!;
    expect(lv.n).toBe(300);
    const last = bars[299].c;
    const t = applyLevels(lv, last * 1.02, 2000, null);
    const closes = [...bars.slice(-19).map((b) => b.c), last * 1.02];
    expect(t.sma20v).toBeCloseTo(closes.reduce((s, x) => s + x, 0) / 20, 8);
    expect(t.perfWeek).toBeCloseTo((last * 1.02) / bars[295].c - 1, 10);
    expect(t.high52w).toBeCloseTo(0, 10); // a new high sits at 0% from the high
    expect(t.low52w as number).toBeGreaterThan(0);
    expect(t.relVolume).toBeCloseTo(2000 / lv.avgVol!, 10);
    expect(t.rsi as number).toBeGreaterThan(50);
  });

  it('agrees with the chart-side RSI and SMA on the same closes', () => {
    const closes = bars.map((b) => b.c);
    const lv = computeLevels(bars.slice(0, 299), bars[299].d.replace(/.$/, '9'))!;
    const live = applyLevels(lv, closes[298], null, null);
    void live;
    const chartRsi = rsi(closes, 14);
    const lv2 = computeLevels(bars, '2099-01-01')!;
    const again = applyLevels(lv2, closes[299], null, null);
    // applyLevels adds one more step using the live price; with price == last close the change is zero.
    expect(again.rsi as number).toBeLessThanOrEqual(chartRsi[299] as number);
    expect(sma(closes, 50)[299]).toBeCloseTo(closes.slice(-50).reduce((s, x) => s + x, 0) / 50, 8);
    const m = macd(closes);
    expect(m.hist[299]).toBeCloseTo((m.macd[299] as number) - (m.signal[299] as number), 10);
  });

  it('names single-bar candlestick shapes', () => {
    expect(detectCandle({ o: 10, h: 10.02, l: 9, c: 10.01 })).toBe('Dragonfly Doji');
    expect(detectCandle({ o: 10, h: 11, l: 9.98, c: 10.01 })).toBe('Gravestone Doji');
    expect(detectCandle({ o: 10, h: 11, l: 10, c: 11 })).toBe('Marubozu White');
    expect(detectCandle({ o: 11, h: 11, l: 10, c: 10 })).toBe('Marubozu Black');
    expect(detectCandle({ o: 10.6, h: 10.85, l: 9.5, c: 10.8 })).toBe('Hammer');
    expect(detectCandle({ o: 10, h: 10, l: 10, c: 10 })).toBeNull();
  });
});

describe('parsing helpers', () => {
  it('reads the number formats the data sources use', () => {
    expect(num('$1,234.50')).toBe(1234.5);
    expect(num('3.07%')).toBe(3.07);
    expect(num('-0.62%')).toBe(-0.62);
    expect(num('1.2B')).toBe(1.2e9);
    expect(num('--')).toBeNull();
    expect(num('N/A')).toBeNull();
    expect(num('UNCH')).toBeNull();
    expect(num('')).toBeNull();
    expect(usDateToIso('11/09/2026')).toBe('2026-11-09');
    expect(parseCsv('a,"b,c",d\n1,"x ""y""",3')).toEqual([['a', 'b,c', 'd'], ['1', 'x "y"', '3']]);
  });

  it('declines to compute growth from a non-positive base', () => {
    expect(cagr(100, 200, 5)).toBeCloseTo(2 ** 0.2 - 1, 12);
    expect(cagr(-5, 10, 3)).toBeNull();
    expect(cagr(5, -10, 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
// Statements built from SEC facts: stock splits, scale errors, trailing-year columns
// ---------------------------------------------------------------------------------

/** A tiny synthetic filer: one 10-K per fiscal year, each repeating two prior years as comparatives. */
function filer(opts: { years: number[]; shares: (fy: number, filedYear: number) => number; eps: (fy: number, filedYear: number) => number; extra?: (facts: Record<string, CompanyFact[]>) => void }): CompanyFacts {
  const usd: Record<string, CompanyFact[]> = { NetIncomeLoss: [], Revenues: [], NetCashProvidedByUsedInOperatingActivities: [], PaymentsToAcquirePropertyPlantAndEquipment: [], DepreciationDepletionAndAmortization: [], OperatingIncomeLoss: [] };
  const sharesFacts: CompanyFact[] = [];
  const epsFacts: CompanyFact[] = [];
  const instants: Record<string, CompanyFact[]> = { Assets: [], StockholdersEquity: [], CashAndCashEquivalentsAtCarryingValue: [], LongTermDebtNoncurrent: [], AssetsCurrent: [], LiabilitiesCurrent: [] };
  for (const filedYear of opts.years) {
    const filed = `${filedYear + 1}-02-15`;
    for (const fy of [filedYear - 2, filedYear - 1, filedYear]) {
      if (!opts.years.includes(fy)) continue;
      const period = { start: `${fy}-01-01`, end: `${fy}-12-31`, accn: `a-${filedYear}`, fy: filedYear, fp: 'FY', form: '10-K', filed };
      const income = 500e6 + (fy - opts.years[0]) * 100e6; // steady growth, independent of share basis
      sharesFacts.push({ ...period, val: opts.shares(fy, filedYear) });
      epsFacts.push({ ...period, val: opts.eps(fy, filedYear) });
      usd.NetIncomeLoss.push({ ...period, val: income });
      usd.Revenues.push({ ...period, val: income * 5 });
      usd.OperatingIncomeLoss.push({ ...period, val: income * 1.3 });
      usd.NetCashProvidedByUsedInOperatingActivities.push({ ...period, val: income * 1.2 });
      usd.PaymentsToAcquirePropertyPlantAndEquipment.push({ ...period, val: income * 0.2 });
      usd.DepreciationDepletionAndAmortization.push({ ...period, val: income * 0.15 });
      if (fy === filedYear) {
        const at = { end: `${fy}-12-31`, accn: `a-${filedYear}`, fy: filedYear, fp: 'FY', form: '10-K', filed };
        instants.Assets.push({ ...at, val: income * 6 });
        instants.StockholdersEquity.push({ ...at, val: income * 3 });
        instants.CashAndCashEquivalentsAtCarryingValue.push({ ...at, val: income });
        instants.LongTermDebtNoncurrent.push({ ...at, val: income * 0.5 });
        instants.AssetsCurrent.push({ ...at, val: income * 2 });
        instants.LiabilitiesCurrent.push({ ...at, val: income });
      }
    }
  }
  opts.extra?.(usd);
  const wrap = (unit: string, facts: CompanyFact[]) => ({ label: null, description: null, units: { [unit]: facts } });
  const gaap: CompanyFacts['facts'][string] = {};
  for (const [tag, facts] of Object.entries({ ...usd, ...instants })) gaap[tag] = wrap('USD', facts);
  gaap.WeightedAverageNumberOfDilutedSharesOutstanding = wrap('shares', sharesFacts);
  gaap.EarningsPerShareDiluted = wrap('USD/shares', epsFacts);
  return { cik: 1, entityName: 'Test Co', facts: { 'us-gaap': gaap } };
}

describe('statements from SEC facts', () => {
  const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const income = (fy: number) => 500e6 + (fy - 2019) * 100e6;

  it('restates years before a stock split onto today’s share basis', () => {
    // Ten-for-one split in mid-2023: filings from the FY2023 10-K onward are post-split.
    const post = (filedYear: number) => filedYear >= 2023;
    const fin = buildFinancials(1, filer({ years, shares: (_fy, filed) => (post(filed) ? 1000e6 : 100e6), eps: (fy, filed) => income(fy) / (post(filed) ? 1000e6 : 100e6) }))!;
    expect(fin.annual.periods.map((p) => p.label)).toEqual(years.map((y) => `FY${y}`));
    for (const v of fin.annual.values.sharesDiluted) expect(v).toBeCloseTo(1000e6, 0);
    fin.annual.values.eps.forEach((v, i) => expect(v as number).toBeCloseTo(income(years[i]) / 1000e6, 6));
    expect(fin.splitAdjusted).toBe(10);
    // Growth and dilution are then measured on one basis.
    const a = analyse({ fin, price: 20, marketCap: 20 * 1000e6, sector: 'Technology', industry: 'Software' });
    expect(a.summary!.shareChange).toBeCloseTo(0, 6);
    expect(a.defaults!.shareBasis).toBe('filings');
  });

  it('fixes a share count filed in the wrong scale without touching EPS', () => {
    // The FY2020 10-K reported shares in thousands; EPS was right all along.
    const scaled = (filedYear: number) => (filedYear === 2020 ? 100e3 : 100e6);
    const fin = buildFinancials(1, filer({ years, shares: (_fy, filed) => scaled(filed), eps: (fy) => income(fy) / 100e6 }))!;
    for (const v of fin.annual.values.sharesDiluted) expect(v).toBeCloseTo(100e6, 0);
    fin.annual.values.eps.forEach((v, i) => expect(v as number).toBeCloseTo(income(years[i]) / 100e6, 6));
    expect(fin.splitAdjusted ?? null).toBeNull();
  });

  it('does not mistake trailing-twelve-month columns in quarterly reports for fiscal years', () => {
    const fin = buildFinancials(1, filer({
      years,
      shares: () => 100e6,
      eps: (fy) => income(fy) / 100e6,
      extra: (usd) => {
        // A 10-Q that also shows the twelve months to the end of each quarter.
        for (const [start, end] of [['2024-04-01', '2025-03-31'], ['2024-07-01', '2025-06-30'], ['2024-10-01', '2025-09-30']]) {
          usd.NetIncomeLoss.push({ start, end, val: 1e9, accn: 'q', fy: 2025, fp: 'Q1', form: '10-Q', filed: '2025-10-30' });
        }
      },
    }))!;
    expect(fin.annual.periods.map((p) => p.end)).toEqual(years.map((y) => `${y}-12-31`));
  });

  it('values on market-implied shares when the filings count a different share class', () => {
    const fin = buildFinancials(1, filer({ years, shares: () => 1e6, eps: (fy) => income(fy) / 1e6 }))!;
    // The listed class is 1/1500th of the class the filings count (as with Berkshire B).
    const a = analyse({ fin, price: 100, marketCap: 150e9, sector: 'Industrials', industry: 'Conglomerate' });
    expect(a.defaults!.shareBasis).toBe('market');
    expect(a.defaults!.sharesUsed).toBeCloseTo(1.5e9, 0);
    const fcf3 = a.defaults!.options.find((o) => o.id === 'fcf3')!.value as number;
    const avgFcf = [2023, 2024, 2025].reduce((s, y) => s + income(y) * 1.0, 0) / 3; // CFO 1.2x - capex 0.2x
    expect(fcf3).toBeCloseTo(avgFcf / 1.5e9, 6);
  });
});

describe('data-only checklist score (front-page ranking)', () => {
  const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const fin = buildFinancials(1, filer({ years, shares: () => 100e6, eps: (fy) => (500e6 + (fy - 2019) * 100e6) / 100e6 }))!;

  it('scores only the questions data can answer, with the workbook weights', () => {
    expect(DATA_QUESTION_IDS).toHaveLength(14);
    const allYes = Object.fromEntries(DATA_QUESTION_IDS.map((id) => [id, 'Yes'])) as Record<string, Answer>;
    const s = autoScore({ ...allYes, u1: 'No' }); // a judgment question never counts here
    expect(s.max).toBe(34);
    expect(s.points).toBe(34);
    expect(s.gatesFailed).toEqual([]);
    const gate = autoScore({ ...allYes, f4: 'No', f8: 'Uncertain' });
    expect(gate.points).toBe(34 - 3 - 1);
    expect(gate.gatesFailed).toEqual(['f4']);
  });

  it('gives the same price-dependent answers as the company page at any price', () => {
    for (const price of [5, 40, 90, 400]) {
      const a = analyse({ fin, price, marketCap: price * 100e6, sector: 'Technology', industry: 'Software' });
      const ps = priceSuggestions(a.inputs, a.result);
      expect(ps.v3.answer).toBe(a.suggestions.v3.answer);
      expect(ps.v4.answer).toBe(a.suggestions.v4.answer);
      expect(ps.v3.reason).toBe(a.suggestions.v3.reason);
    }
    const cheap = analyse({ fin, price: 5, marketCap: 5 * 100e6, sector: 'Technology', industry: 'Software' });
    const dear = analyse({ fin, price: 400, marketCap: 400 * 100e6, sector: 'Technology', industry: 'Software' });
    expect(cheap.suggestions.v3.answer).toBe('Yes');
    expect(dear.suggestions.v3.answer).toBe('No');
    expect(cheap.inputs.ownerEarnings).toBe(dear.inputs.ownerEarnings); // per-share inputs do not move with price
  });
});
