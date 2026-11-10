import { cached, MIN } from '../lib/cache.ts';
import { loadSeries, type Point } from './series.ts';
import { mean, normCdf, stdev } from '../lib/util.ts';

/**
 * A Fear & Greed index computed from public data, modelled on the seven-indicator
 * method CNN describes for its index: each indicator is scored 0-100 by how far
 * it sits from its own recent norm, and the scores are averaged with equal weight.
 *
 * CNN does not publish its data for automated use, and three of its inputs
 * (NYSE new highs/lows, the McClellan volume summation, the put/call ratio) are
 * not freely available, so those are replaced by the closest public stand-ins.
 * The values will therefore track, but not equal, CNN's published number.
 */

const WINDOW = 504; // two years of trading days: the "recent norm"
const MIN_OBS = 252;

export interface FgComponent {
  id: string;
  name: string;
  description: string;
  score: number | null;
  rating: string;
  value: number | null;
  valueLabel: string;
  since: string | null;
}

export interface FearGreed {
  asOf: string;
  score: number;
  rating: string;
  previous: { label: string; date: string; score: number; rating: string }[];
  components: FgComponent[];
  /** [date, composite score, number of components available] */
  history: [string, number, number][];
  componentHistory: Record<string, Point[]>;
  methodology: string[];
}

export function ratingFor(score: number): string {
  if (score < 25) return 'Extreme Fear';
  if (score < 45) return 'Fear';
  if (score <= 55) return 'Neutral';
  if (score <= 75) return 'Greed';
  return 'Extreme Greed';
}

const sma = (vals: number[], n: number, i: number) => {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += vals[k];
  return s / n;
};

/** Rolling z-score -> 0..100 through the normal CDF. */
function scoreSeries(raw: Point[], invert = false): Point[] {
  const out: Point[] = [];
  const vals = raw.map((p) => p[1]);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    sumSq += vals[i] * vals[i];
    if (i >= WINDOW) {
      sum -= vals[i - WINDOW];
      sumSq -= vals[i - WINDOW] * vals[i - WINDOW];
    }
    const n = Math.min(i + 1, WINDOW);
    if (n < MIN_OBS) continue;
    const m = sum / n;
    const variance = Math.max(0, (sumSq - n * m * m) / (n - 1));
    const sd = Math.sqrt(variance);
    if (sd === 0) continue;
    let z = (vals[i] - m) / sd;
    if (invert) z = -z;
    out.push([raw[i][0], Math.round(normCdf(z) * 1000) / 10]);
  }
  return out;
}

/** Inner-join two series on date and combine them. */
function join(a: Point[], b: Point[], f: (x: number, y: number) => number): Point[] {
  const m = new Map(b);
  const out: Point[] = [];
  for (const [d, x] of a) {
    const y = m.get(d);
    if (y != null) out.push([d, f(x, y)]);
  }
  return out;
}

function vsAverage(p: Point[], n: number): Point[] {
  const vals = p.map((x) => x[1]);
  const out: Point[] = [];
  for (let i = n - 1; i < vals.length; i++) out.push([p[i][0], vals[i] / sma(vals, n, i) - 1]);
  return out;
}

function trailingReturn(p: Point[], n: number): Point[] {
  const out: Point[] = [];
  for (let i = n; i < p.length; i++) out.push([p[i][0], p[i][1] / p[i - n][1] - 1]);
  return out;
}

function rangePosition(p: Point[], n: number): Point[] {
  const out: Point[] = [];
  for (let i = n - 1; i < p.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - n + 1; k <= i; k++) {
      if (p[k][1] > hi) hi = p[k][1];
      if (p[k][1] < lo) lo = p[k][1];
    }
    out.push([p[i][0], hi === lo ? 0.5 : (p[i][1] - lo) / (hi - lo)]);
  }
  return out;
}

const pct = (v: number, dp = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

async function compute(): Promise<FearGreed> {
  const ids = ['spx', 'vix', 'vix3m', 'sym:SPY', 'sym:TLT', 'sym:HYG', 'sym:LQD', 'sym:RSP'];
  const loaded = await Promise.all(ids.map((id) => loadSeries(id).catch(() => null)));
  const get = (id: string): Point[] => loaded[ids.indexOf(id)]?.data ?? [];
  const spx = get('spx');
  if (spx.length < MIN_OBS + 130) throw new Error('S&P 500 history unavailable');
  const vix = get('vix');
  const spy = get('sym:SPY');
  const tlt = get('sym:TLT');

  const defs: { id: string; name: string; description: string; raw: Point[]; invert?: boolean; label: (v: number) => string }[] = [
    {
      id: 'momentum',
      name: 'Market momentum',
      description: 'S&P 500 versus its 125-day moving average. Well above the average signals greed; below it, fear.',
      raw: vsAverage(spx, 125),
      label: (v) => `S&P 500 is ${pct(v)} vs its 125-day average`,
    },
    {
      id: 'strength',
      name: 'Stock price strength',
      description: 'Where the S&P 500 sits inside its 52-week high-low range (public stand-in for NYSE net new 52-week highs).',
      raw: rangePosition(spx, 252),
      label: (v) => `${(v * 100).toFixed(0)}% of the way from the 52-week low to the high`,
    },
    {
      id: 'breadth',
      name: 'Stock price breadth',
      description: 'Equal-weight S&P 500 versus the cap-weighted index over 20 days (stand-in for the McClellan volume summation). When the average stock keeps up, participation is broad.',
      raw: join(trailingReturn(get('sym:RSP'), 20), trailingReturn(spy, 20), (a, b) => a - b),
      label: (v) => `Equal-weight ${pct(v)} vs cap-weight over 20 days`,
    },
    {
      id: 'options',
      name: 'Options market',
      description: '3-month VIX relative to 1-month VIX (stand-in for the put/call ratio). A steep upward curve means little demand for near-term protection; an inverted curve means stress.',
      raw: join(get('vix3m'), vix, (a, b) => a / b - 1),
      label: (v) => `3-month VIX is ${pct(v)} vs 1-month VIX`,
    },
    {
      id: 'volatility',
      name: 'Market volatility',
      description: 'VIX versus its 50-day moving average. A rising VIX signals fear.',
      raw: vsAverage(vix, 50),
      invert: true,
      label: (v) => `VIX is ${pct(v)} vs its 50-day average`,
    },
    {
      id: 'safehaven',
      name: 'Safe-haven demand',
      description: 'Stocks (SPY) minus long Treasury bonds (TLT), 20-day return. Bonds beating stocks signals fear.',
      raw: join(trailingReturn(spy, 20), trailingReturn(tlt, 20), (a, b) => a - b),
      label: (v) => `Stocks ${pct(v)} vs bonds over 20 days`,
    },
    {
      id: 'junk',
      name: 'Junk-bond demand',
      description: 'High-yield bonds (HYG) relative to investment-grade bonds (LQD) versus the 125-day norm (stand-in for the junk/investment-grade yield spread).',
      raw: vsAverage(join(get('sym:HYG'), get('sym:LQD'), (a, b) => a / b), 125),
      label: (v) => `High-yield/investment-grade ratio ${pct(v, 2)} vs 125-day average`,
    },
  ];

  const componentHistory: Record<string, Point[]> = {};
  const byDate = new Map<string, number[]>();
  const components: FgComponent[] = defs.map((d) => {
    const scored = d.raw.length ? scoreSeries(d.raw, d.invert) : [];
    componentHistory[d.id] = scored;
    for (const [date, s] of scored) {
      const arr = byDate.get(date);
      if (arr) arr.push(s);
      else byDate.set(date, [s]);
    }
    const last = scored[scored.length - 1];
    const lastRaw = d.raw[d.raw.length - 1];
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      score: last ? last[1] : null,
      rating: last ? ratingFor(last[1]) : 'No data',
      value: lastRaw ? lastRaw[1] : null,
      valueLabel: lastRaw ? d.label(lastRaw[1]) : 'No data',
      since: scored[0]?.[0] ?? null,
    };
  });

  const history: [string, number, number][] = [...byDate.entries()]
    .filter(([, arr]) => arr.length >= 3)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([d, arr]) => [d, Math.round(mean(arr) * 10) / 10, arr.length]);
  if (!history.length) throw new Error('Not enough data to compute the index');

  const lastDate = history[history.length - 1][0];
  // The headline uses only components that have a reading on the latest date.
  const current = components.filter((c) => componentHistory[c.id].at(-1)?.[0] === lastDate && c.score != null);
  const score = Math.round(mean(current.map((c) => c.score as number)));

  const back = (days: number, label: string) => {
    const i = history.length - 1 - days;
    if (i < 0) return null;
    const s = Math.round(history[i][1]);
    return { label, date: history[i][0], score: s, rating: ratingFor(s) };
  };
  const previous = [back(1, 'Previous close'), back(5, '1 week ago'), back(21, '1 month ago'), back(252, '1 year ago')].filter((x): x is NonNullable<typeof x> => x != null);

  void stdev;
  return {
    asOf: lastDate,
    score,
    rating: ratingFor(score),
    previous,
    components,
    history,
    componentHistory,
    methodology: [
      'Seven market indicators are each converted to a 0-100 score, then averaged with equal weight. 0 is extreme fear, 100 is extreme greed.',
      'Scoring: each indicator is compared with its own trailing two-year average and variability (a z-score) and mapped through the normal distribution, so 50 means "typical for the last two years".',
      'Bands: 0-24 Extreme Fear, 25-44 Fear, 45-55 Neutral, 56-75 Greed, 76-100 Extreme Greed.',
      'This follows the method CNN describes for its Fear & Greed Index, but it is an independent calculation. CNN does not offer its values for automated use, and three of its inputs are not freely available, so price strength, breadth and options sentiment use the public stand-ins described on each component.',
      'History: momentum and strength start in 1976, volatility in 1991, breadth and safe-haven demand in 2005, junk-bond demand in 2008 and the options component in 2010. Earlier dates average the components available at the time (minimum three).',
    ],
  };
}

export function fearGreed(): Promise<FearGreed> {
  return cached('market', 'feargreed', 10 * MIN, compute, { noMemory: false });
}
