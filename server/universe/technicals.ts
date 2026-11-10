import type { Bar } from '../../shared/types.ts';
import { mean } from '../lib/util.ts';

/**
 * Everything the screener needs from price history, split in two:
 *  - Levels: values computed from completed sessions *before* the current one.
 *  - applyLevels(): combines the levels with the live price so that ratios such as
 *    "distance from the 50-day average" stay correct as the price moves intraday.
 */
export interface Levels {
  asOf: string; // date of the last bar included (the previous session)
  n: number;
  prevClose: number;
  c5: number | null;
  c21: number | null;
  c63: number | null;
  c126: number | null;
  c252: number | null;
  cYtd: number | null;
  s19: number | null; // sum of the last 19 closes
  s49: number | null;
  s199: number | null;
  hi19: number | null;
  lo19: number | null;
  hi49: number | null;
  lo49: number | null;
  hi251: number | null;
  lo251: number | null;
  rsiGain: number | null; // Wilder averages up to prevClose
  rsiLoss: number | null;
  atr: number | null;
  volW: number | null;
  volM: number | null;
  avgVol: number | null;
  beta: number | null;
  pattern: string | null;
  firstDate: string;
  spark: number[];
  // The current session's bar when it is already in the history file.
  today: { o: number; h: number; l: number; c: number; v: number } | null;
  prevBar: { o: number; h: number; l: number; c: number } | null;
  prev2Close: number | null;
}

const at = (c: number[], back: number): number | null => (c.length >= back ? c[c.length - back] : null);
const sumLast = (c: number[], k: number): number | null => {
  if (c.length < k) return null;
  let s = 0;
  for (let i = c.length - k; i < c.length; i++) s += c[i];
  return s;
};
const maxLast = (a: number[], k: number): number | null => (a.length ? Math.max(...a.slice(-k)) : null);
const minLast = (a: number[], k: number): number | null => (a.length ? Math.min(...a.slice(-k)) : null);

export function computeLevels(all: Bar[], sessionDate: string, benchmark?: Map<string, number>): Levels | null {
  const todayBar = all.find((b) => b.d === sessionDate) ?? null;
  const bars = all.filter((b) => b.d < sessionDate);
  if (bars.length < 2) return null;
  const c = bars.map((b) => b.c);
  const h = bars.map((b) => b.h);
  const l = bars.map((b) => b.l);
  const n = bars.length;
  const last = bars[n - 1];

  // Wilder RSI(14) state
  let rsiGain: number | null = null;
  let rsiLoss: number | null = null;
  if (n >= 15) {
    let g = 0;
    let ls = 0;
    for (let i = 1; i <= 14; i++) {
      const d = c[i] - c[i - 1];
      if (d > 0) g += d;
      else ls -= d;
    }
    g /= 14;
    ls /= 14;
    for (let i = 15; i < n; i++) {
      const d = c[i] - c[i - 1];
      g = (g * 13 + Math.max(d, 0)) / 14;
      ls = (ls * 13 + Math.max(-d, 0)) / 14;
    }
    rsiGain = g;
    rsiLoss = ls;
  }

  // Wilder ATR(14)
  let atr: number | null = null;
  if (n >= 15) {
    const tr = (i: number) => Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    let a = 0;
    for (let i = 1; i <= 14; i++) a += tr(i);
    a /= 14;
    for (let i = 15; i < n; i++) a = (a * 13 + tr(i)) / 14;
    atr = a;
  }

  const range = (k: number) => {
    const s = bars.slice(-k).filter((b) => b.c > 0);
    return s.length ? mean(s.map((b) => (b.h - b.l) / b.c)) : null;
  };

  const year = sessionDate.slice(0, 4);
  let cYtd: number | null = null;
  for (let i = n - 1; i >= 0; i--) {
    if (bars[i].d.slice(0, 4) < year) {
      cYtd = bars[i].c;
      break;
    }
  }

  // Beta against the benchmark on up to 252 daily returns.
  let beta: number | null = null;
  if (benchmark) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = Math.max(1, n - 252); i < n; i++) {
      const b0 = benchmark.get(bars[i - 1].d);
      const b1 = benchmark.get(bars[i].d);
      if (b0 && b1 && c[i - 1] > 0) {
        xs.push(b1 / b0 - 1);
        ys.push(c[i] / c[i - 1] - 1);
      }
    }
    if (xs.length >= 60) {
      const mx = mean(xs);
      const my = mean(ys);
      let cov = 0;
      let varx = 0;
      for (let i = 0; i < xs.length; i++) {
        cov += (xs[i] - mx) * (ys[i] - my);
        varx += (xs[i] - mx) ** 2;
      }
      if (varx > 0) beta = cov / varx;
    }
  }

  const sparkSrc = c.slice(-90);
  const step = Math.max(1, Math.floor(sparkSrc.length / 45));
  const spark: number[] = [];
  for (let i = sparkSrc.length - 1; i >= 0; i -= step) spark.unshift(Number(sparkSrc[i].toPrecision(5)));

  return {
    asOf: last.d,
    n,
    prevClose: last.c,
    c5: at(c, 5),
    c21: at(c, 21),
    c63: at(c, 63),
    c126: at(c, 126),
    c252: at(c, 252),
    cYtd,
    s19: sumLast(c, 19),
    s49: sumLast(c, 49),
    s199: sumLast(c, 199),
    hi19: maxLast(h, 19),
    lo19: minLast(l, 19),
    hi49: maxLast(h, 49),
    lo49: minLast(l, 49),
    hi251: maxLast(h, 251),
    lo251: minLast(l, 251),
    rsiGain,
    rsiLoss,
    atr,
    volW: range(5),
    volM: range(21),
    avgVol: n >= 5 ? mean(bars.slice(-63).map((b) => b.v)) : null,
    beta,
    pattern: detectPattern(bars.slice(-120)),
    firstDate: all[0].d,
    spark,
    today: todayBar ? { o: todayBar.o, h: todayBar.h, l: todayBar.l, c: todayBar.c, v: todayBar.v } : null,
    prevBar: { o: last.o, h: last.h, l: last.l, c: last.c },
    prev2Close: n >= 2 ? c[n - 2] : null,
  };
}

export interface LiveTech {
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  gap: number | null;
  changeFromOpen: number | null;
  perfWeek: number | null;
  perfMonth: number | null;
  perfQuarter: number | null;
  perfHalf: number | null;
  perfYear: number | null;
  perfYtd: number | null;
  volatilityWeek: number | null;
  volatilityMonth: number | null;
  rsi: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  sma20v: number | null;
  sma50v: number | null;
  sma200v: number | null;
  high20: number | null;
  low20: number | null;
  high50: number | null;
  low50: number | null;
  high52w: number | null;
  low52w: number | null;
  beta: number | null;
  atr: number | null;
  avgVolume: number | null;
  relVolume: number | null;
  pattern: string | null;
  candle: string | null;
  barsAsOf: string | null;
  spark: number[];
}

const rel = (p: number, ref: number | null): number | null => (ref && ref > 0 ? p / ref - 1 : null);

/** Combine stored levels with the live price / volume and optional live open-high-low. */
export function applyLevels(lv: Levels, price: number | null, volume: number | null, live?: { o: number | null; h: number | null; l: number | null } | null): LiveTech {
  const p = price ?? lv.today?.c ?? lv.prevClose;
  const o = live?.o ?? lv.today?.o ?? null;
  const hi = live?.h ?? lv.today?.h ?? null;
  const lo = live?.l ?? lv.today?.l ?? null;
  const dayHi = Math.max(p, hi ?? p);
  const dayLo = Math.min(p, lo ?? p);
  const sma = (s: number | null, k: number) => (s == null ? null : (s + p) / k);
  const sma20v = sma(lv.s19, 20);
  const sma50v = sma(lv.s49, 50);
  const sma200v = sma(lv.s199, 200);

  let rsi: number | null = null;
  if (lv.rsiGain != null && lv.rsiLoss != null) {
    const d = p - lv.prevClose;
    const g = (lv.rsiGain * 13 + Math.max(d, 0)) / 14;
    const ls = (lv.rsiLoss * 13 + Math.max(-d, 0)) / 14;
    rsi = ls === 0 ? 100 : 100 - 100 / (1 + g / ls);
  }
  let atr = lv.atr;
  if (atr != null && hi != null && lo != null) {
    const tr = Math.max(dayHi - dayLo, Math.abs(dayHi - lv.prevClose), Math.abs(dayLo - lv.prevClose));
    atr = (atr * 13 + tr) / 14;
  }
  const vol = volume ?? lv.today?.v ?? null;
  const candleBar = o != null && hi != null && lo != null ? { o, h: dayHi, l: dayLo, c: p } : lv.prevBar;

  return {
    open: o,
    high: hi,
    low: lo,
    prevClose: lv.prevClose,
    // Until the current session's open/high/low are known, these three describe the last completed session.
    gap: o != null ? rel(o, lv.prevClose) : lv.prevBar ? rel(lv.prevBar.o, lv.prev2Close) : null,
    changeFromOpen: o != null ? rel(p, o) : lv.prevBar && lv.prevBar.o > 0 ? lv.prevBar.c / lv.prevBar.o - 1 : null,
    perfWeek: rel(p, lv.c5),
    perfMonth: rel(p, lv.c21),
    perfQuarter: rel(p, lv.c63),
    perfHalf: rel(p, lv.c126),
    perfYear: rel(p, lv.c252),
    perfYtd: rel(p, lv.cYtd),
    volatilityWeek: lv.volW,
    volatilityMonth: lv.volM,
    rsi,
    sma20: rel(p, sma20v),
    sma50: rel(p, sma50v),
    sma200: rel(p, sma200v),
    sma20v,
    sma50v,
    sma200v,
    high20: lv.hi19 != null ? p / Math.max(lv.hi19, dayHi) - 1 : null,
    low20: lv.lo19 != null ? p / Math.min(lv.lo19, dayLo) - 1 : null,
    high50: lv.hi49 != null ? p / Math.max(lv.hi49, dayHi) - 1 : null,
    low50: lv.lo49 != null ? p / Math.min(lv.lo49, dayLo) - 1 : null,
    high52w: lv.hi251 != null ? p / Math.max(lv.hi251, dayHi) - 1 : null,
    low52w: lv.lo251 != null ? p / Math.min(lv.lo251, dayLo) - 1 : null,
    beta: lv.beta,
    atr,
    avgVolume: lv.avgVol,
    relVolume: vol != null && lv.avgVol ? vol / lv.avgVol : null,
    pattern: lv.pattern,
    candle: candleBar ? detectCandle(candleBar) : null,
    barsAsOf: lv.today ? lv.asOf : lv.asOf,
    spark: lv.spark,
  };
}

/** Single-bar candlestick shapes, matching the names used by Finviz's candlestick filter. */
export function detectCandle(b: { o: number; h: number; l: number; c: number }): string | null {
  const range = b.h - b.l;
  if (!(range > 0)) return null;
  const body = Math.abs(b.c - b.o);
  const upper = b.h - Math.max(b.o, b.c);
  const lower = Math.min(b.o, b.c) - b.l;
  const bodyPct = body / range;
  const up = b.c >= b.o;
  if (bodyPct <= 0.05) {
    if (upper <= range * 0.1 && lower >= range * 0.6) return 'Dragonfly Doji';
    if (lower <= range * 0.1 && upper >= range * 0.6) return 'Gravestone Doji';
    return 'Doji';
  }
  if (bodyPct >= 0.95) return up ? 'Marubozu White' : 'Marubozu Black';
  if (bodyPct <= 0.35 && lower >= body * 2 && upper <= body * 0.5) return 'Hammer';
  if (bodyPct <= 0.35 && upper >= body * 2 && lower <= body * 0.5) return 'Inverted Hammer';
  if (bodyPct <= 0.3 && upper >= body * 0.7 && lower >= body * 0.7) return up ? 'Spinning Top White' : 'Spinning Top Black';
  if (lower >= range * 0.6) return 'Long Lower Shadow';
  if (upper >= range * 0.6) return 'Long Upper Shadow';
  return null;
}

interface Pivot {
  i: number;
  v: number;
}

function pivots(bars: Bar[], w: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = w; i < bars.length - w; i++) {
    let isH = true;
    let isL = true;
    for (let k = i - w; k <= i + w; k++) {
      if (bars[k].h > bars[i].h) isH = false;
      if (bars[k].l < bars[i].l) isL = false;
    }
    if (isH) highs.push({ i, v: bars[i].h });
    if (isL) lows.push({ i, v: bars[i].l });
  }
  return { highs, lows };
}

function fit(p: Pivot[]): { slope: number; intercept: number; r2: number } | null {
  if (p.length < 2) return null;
  const mx = mean(p.map((q) => q.i));
  const my = mean(p.map((q) => q.v));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const q of p) {
    sxy += (q.i - mx) * (q.v - my);
    sxx += (q.i - mx) ** 2;
    syy += (q.v - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

/**
 * Heuristic chart-pattern detection on roughly six months of bars: fit one line
 * through the swing highs and one through the swing lows, then classify by the
 * two slopes. Reversal shapes are checked first on the most recent swings.
 */
export function detectPattern(bars: Bar[]): string | null {
  if (bars.length < 60) return null;
  const { highs, lows } = pivots(bars, 4);
  const avg = mean(bars.map((b) => b.c));
  if (!(avg > 0)) return null;
  const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) / avg <= tol;
  const lastClose = bars[bars.length - 1].c;

  // Head and shoulders: three recent swing highs, middle highest, shoulders alike.
  if (highs.length >= 3) {
    const [a, b, c] = highs.slice(-3);
    if (b.v > a.v * 1.03 && b.v > c.v * 1.03 && near(a.v, c.v, 0.04) && c.i - a.i >= 20 && lastClose < c.v) return 'Head & Shoulders';
  }
  if (lows.length >= 3) {
    const [a, b, c] = lows.slice(-3);
    if (b.v < a.v * 0.97 && b.v < c.v * 0.97 && near(a.v, c.v, 0.04) && c.i - a.i >= 20 && lastClose > c.v) return 'Head & Shoulders Inverse';
  }
  // Double / multiple tops and bottoms.
  const recentHighs = highs.slice(-4);
  const recentLows = lows.slice(-4);
  const top = Math.max(...bars.slice(-90).map((b) => b.h));
  const bottom = Math.min(...bars.slice(-90).map((b) => b.l));
  const topsNear = recentHighs.filter((p) => near(p.v, top, 0.025));
  const botsNear = recentLows.filter((p) => near(p.v, bottom, 0.025));
  const spread = (p: Pivot[]) => (p.length ? p[p.length - 1].i - p[0].i : 0);
  if (topsNear.length >= 3 && spread(topsNear) >= 20 && lastClose < top * 0.97) return 'Multiple Top';
  if (botsNear.length >= 3 && spread(botsNear) >= 20 && lastClose > bottom * 1.03) return 'Multiple Bottom';
  if (topsNear.length === 2 && spread(topsNear) >= 15 && lastClose < top * 0.96) return 'Double Top';
  if (botsNear.length === 2 && spread(botsNear) >= 15 && lastClose > bottom * 1.04) return 'Double Bottom';

  const hf = fit(highs.slice(-5));
  const lf = fit(lows.slice(-5));
  if (!hf || !lf || highs.length < 3 || lows.length < 3) return null;
  // Slopes as % of price per 20 sessions.
  const hs = (hf.slope * 20) / avg;
  const ls = (lf.slope * 20) / avg;
  const flat = 0.012;
  const strong = hf.r2 >= 0.5 && lf.r2 >= 0.5;
  const hFlat = Math.abs(hs) < flat;
  const lFlat = Math.abs(ls) < flat;
  const tag = (name: string) => (strong ? `${name} (Strong)` : name);

  if (hFlat && lFlat) return 'Horizontal S/R';
  if (hFlat && ls > flat) return tag('Triangle Ascending');
  if (lFlat && hs < -flat) return tag('Triangle Descending');
  if (hs < -flat && ls > flat) return tag('Wedge');
  if (hs > flat && ls > flat) {
    if (Math.abs(hs - ls) < Math.max(flat, Math.abs(hs) * 0.4)) return tag('Channel Up');
    return ls > hs ? tag('Wedge Up') : 'Trendline Support';
  }
  if (hs < -flat && ls < -flat) {
    if (Math.abs(hs - ls) < Math.max(flat, Math.abs(hs) * 0.4)) return tag('Channel Down');
    return hs < ls ? tag('Wedge Down') : 'Trendline Resistance';
  }
  if (hFlat && ls < -flat) return 'Trendline Resistance';
  if (lFlat && hs > flat) return 'Trendline Support';
  return null;
}
