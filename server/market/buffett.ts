import { cached, HOUR, MIN } from '../lib/cache.ts';
import * as fed from '../sources/fed.ts';
import { loadSeries, type Point } from './series.ts';
import { daysBetween, mean, stdev } from '../lib/util.ts';

/**
 * Buffett Indicator = total market value of US publicly traded equities / US GDP.
 *
 * Market value comes from the Federal Reserve's quarterly Financial Accounts
 * (Z.1, table "Corporate equities"): public corporate equities issued by all
 * domestic sectors, minus ETF and closed-end fund shares (which hold other
 * stocks and would be double counted). Between quarterly releases, and since
 * the latest one, the value is moved day by day with the S&P 500.
 */

const ID = {
  publicEquities: 'LM883164115.Q',
  closelyHeld: 'LM883164125.Q',
  etf: 'LM564090005.Q',
  closedEnd: 'LM554090005.Q',
  gdp: 'FA086902005.Q',
};

export interface Buffett {
  asOf: string;
  value: number; // percent
  marketValue: number; // USD
  gdp: number; // USD, annual rate
  rating: string;
  zScore: number;
  trendValue: number;
  percentile: number;
  lastOfficialQuarter: string;
  lastOfficialValue: number;
  stats: { mean: number; median: number; min: [string, number]; max: [string, number] };
  history: Point[]; // percent
  trend: { date: string; trend: number; p1: number; p2: number; m1: number; m2: number }[];
  quarterly: { date: string; marketValue: number; gdp: number; value: number }[];
  methodology: string[];
}

export function buffettRating(z: number): string {
  if (z > 2) return 'Strongly overvalued';
  if (z > 1) return 'Overvalued';
  if (z >= -1) return 'Fairly valued';
  if (z >= -2) return 'Undervalued';
  return 'Strongly undervalued';
}

async function compute(): Promise<Buffett> {
  const [eq, econ, spxSeries] = await Promise.all([
    cached('fed', 'z1-equities', 12 * HOUR, () => fed.z1CorporateEquities(), { noMemory: true }),
    cached('fed', 'z1-economy', 12 * HOUR, () => fed.z1TotalEconomy(), { noMemory: true }),
    loadSeries('spx'),
  ]);
  const gdpBy = new Map(econ.rows.map((r) => [r.period, r.values[ID.gdp]]));

  // Before the Fed splits out closely held equity, the "public" series includes it.
  // Scale those early quarters by the public share observed at the first split quarter.
  const firstSplit = eq.rows.find((r) => (r.values[ID.closelyHeld] ?? 0) > 0);
  const publicShare = firstSplit ? (firstSplit.values[ID.publicEquities] as number) / ((firstSplit.values[ID.publicEquities] as number) + (firstSplit.values[ID.closelyHeld] as number)) : 1;

  const quarterly: Buffett['quarterly'] = [];
  for (const r of eq.rows) {
    const pub = r.values[ID.publicEquities];
    const gdp = gdpBy.get(r.period);
    if (pub == null || gdp == null || gdp <= 0) continue;
    const preSplit = firstSplit != null && r.period < firstSplit.period;
    const mv = pub * (preSplit ? publicShare : 1) - (r.values[ID.etf] ?? 0) - (r.values[ID.closedEnd] ?? 0);
    quarterly.push({ date: fed.quarterEnd(r.period), marketValue: mv, gdp, value: (mv / gdp) * 100 });
  }
  if (quarterly.length < 40) throw new Error('Federal Reserve Z.1 data unavailable');

  const spx = spxSeries?.data ?? [];
  const lastQ = quarterly[quarterly.length - 1];

  // GDP at any date: linear between quarter-ends, then extrapolated at the trailing one-year growth rate.
  const gdpGrowth = quarterly.length > 4 ? lastQ.gdp / quarterly[quarterly.length - 5].gdp - 1 : 0.04;
  const qIndex = (date: string) => {
    let lo = 0;
    let hi = quarterly.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (quarterly[mid].date <= date) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const spxAtOrBefore = (date: string): number | null => {
    let lo = 0;
    let hi = spx.length - 1;
    if (!spx.length || spx[0][0] > date) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (spx[mid][0] <= date) lo = mid;
      else hi = mid - 1;
    }
    return spx[lo][1];
  };

  const history: Point[] = [];
  const firstDaily = spx[0]?.[0] ?? '9999';
  for (const q of quarterly) if (q.date < firstDaily) history.push([q.date, round2(q.value)]);

  let latest = { date: lastQ.date, mv: lastQ.marketValue, gdp: lastQ.gdp };
  for (const [date, s] of spx) {
    if (date < quarterly[0].date) continue;
    const i = qIndex(date);
    const q0 = quarterly[i];
    const s0 = spxAtOrBefore(q0.date);
    if (s0 == null) continue;
    let mv: number;
    let gdp: number;
    if (i < quarterly.length - 1) {
      const q1 = quarterly[i + 1];
      const s1 = spxAtOrBefore(q1.date) ?? s;
      const f = Math.min(1, Math.max(0, daysBetween(q0.date, date) / Math.max(1, daysBetween(q0.date, q1.date))));
      // Follow the S&P 500 inside the quarter, bending the path so it lands on the next official value.
      const drift = q1.marketValue / q0.marketValue / (s1 / s0);
      mv = q0.marketValue * (s / s0) * drift ** f;
      gdp = q0.gdp + (q1.gdp - q0.gdp) * f;
    } else {
      mv = q0.marketValue * (s / s0);
      gdp = q0.gdp * (1 + gdpGrowth) ** (daysBetween(q0.date, date) / 365.25);
    }
    history.push([date, round2((mv / gdp) * 100)]);
    latest = { date, mv, gdp };
  }

  // Long-run exponential trend of the ratio (log-linear fit on the official quarterly data).
  const t0 = Date.parse(quarterly[0].date);
  const xs = quarterly.map((q) => (Date.parse(q.date) - t0) / (365.25 * 86_400_000));
  const ys = quarterly.map((q) => Math.log(q.value));
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const resid = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const sigma = stdev(resid);
  const trendAt = (date: string) => Math.exp(intercept + (slope * (Date.parse(date) - t0)) / (365.25 * 86_400_000));
  const band = (date: string) => {
    const t = trendAt(date);
    return { date, trend: round2(t), p1: round2(t * Math.exp(sigma)), p2: round2(t * Math.exp(2 * sigma)), m1: round2(t * Math.exp(-sigma)), m2: round2(t * Math.exp(-2 * sigma)) };
  };
  const trend = [...quarterly.map((q) => band(q.date))];
  if (latest.date > lastQ.date) trend.push(band(latest.date));

  const value = (latest.mv / latest.gdp) * 100;
  const z = (Math.log(value) - Math.log(trendAt(latest.date))) / sigma;
  const qVals = quarterly.map((q) => q.value);
  const sorted = [...qVals].sort((a, b) => a - b);
  const minQ = quarterly.reduce((a, b) => (b.value < a.value ? b : a));
  const maxQ = quarterly.reduce((a, b) => (b.value > a.value ? b : a));

  return {
    asOf: latest.date,
    value: round2(value),
    marketValue: latest.mv,
    gdp: latest.gdp,
    rating: buffettRating(z),
    zScore: Math.round(z * 100) / 100,
    trendValue: round2(trendAt(latest.date)),
    percentile: Math.round((sorted.filter((v) => v <= value).length / sorted.length) * 100),
    lastOfficialQuarter: lastQ.date,
    lastOfficialValue: round2(lastQ.value),
    stats: { mean: round2(mean(qVals)), median: round2(sorted[sorted.length >> 1]), min: [minQ.date, round2(minQ.value)], max: [maxQ.date, round2(maxQ.value)] },
    history,
    trend,
    quarterly: quarterly.map((q) => ({ ...q, value: round2(q.value) })),
    methodology: [
      'Buffett Indicator = market value of US publicly traded equities / US gross domestic product (annual rate).',
      'Market value: Federal Reserve Financial Accounts (Z.1), "All domestic sectors; public corporate equities; liability", minus ETF and closed-end fund shares, which hold other stocks and would otherwise be counted twice.',
      `GDP: nominal, seasonally adjusted annual rate, from the same release. After the latest official quarter (${lastQ.date}) GDP is extended at its trailing one-year growth rate (${(gdpGrowth * 100).toFixed(1)}%).`,
      'Daily values: the Fed publishes quarterly with a lag of about ten weeks. Inside each quarter, and since the latest one, market value is moved in line with the S&P 500; historical quarters are bent so each lands exactly on the next official figure.',
      `Before ${firstSplit ? fed.quarterEnd(firstSplit.period).slice(0, 4) : 'the split'} the Fed series also includes closely held companies; those quarters are scaled by the public share measured at the first quarter the two are reported separately (${(publicShare * 100).toFixed(0)}%).`,
      'Valuation zone: the ratio has drifted upward for decades, so it is judged against its own long-run exponential trend. Within one standard deviation of trend is "fairly valued"; one to two is "overvalued"/"undervalued"; beyond two is "strongly" so.',
      'The ratio is a rough gauge. It ignores interest rates, profit margins and the growing share of sales US companies earn abroad.',
    ],
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function buffettIndicator(): Promise<Buffett> {
  return cached('market', 'buffett', 10 * MIN, compute);
}
