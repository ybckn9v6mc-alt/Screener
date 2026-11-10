/** Chart indicator maths. All functions return arrays aligned with the input (null where undefined). */
export type Num = number | null;

export function sma(v: number[], n: number): Num[] {
  const out: Num[] = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(v: number[], n: number): Num[] {
  const out: Num[] = new Array(v.length).fill(null);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let e = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = e;
  for (let i = n; i < v.length; i++) {
    e = v[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function bollinger(v: number[], n = 20, mult = 2): { mid: Num[]; upper: Num[]; lower: Num[] } {
  const mid = sma(v, n);
  const upper: Num[] = new Array(v.length).fill(null);
  const lower: Num[] = new Array(v.length).fill(null);
  for (let i = n - 1; i < v.length; i++) {
    const m = mid[i] as number;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += (v[k] - m) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export function rsi(v: number[], n = 14): Num[] {
  const out: Num[] = new Array(v.length).fill(null);
  if (v.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(v: number[], fast = 12, slow = 26, signal = 9): { macd: Num[]; signal: Num[]; hist: Num[] } {
  const f = ema(v, fast);
  const s = ema(v, slow);
  const line: Num[] = v.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  const start = line.findIndex((x) => x != null);
  const sig: Num[] = new Array(v.length).fill(null);
  if (start >= 0) {
    const e = ema(line.slice(start) as number[], signal);
    for (let i = 0; i < e.length; i++) sig[start + i] = e[i];
  }
  return { macd: line, signal: sig, hist: line.map((x, i) => (x != null && sig[i] != null ? x - (sig[i] as number) : null)) };
}

export interface OHLCV {
  t: string | number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Roll daily bars up to weekly (ISO week) or monthly bars. */
export function aggregate(bars: OHLCV[], by: 'W' | 'M'): OHLCV[] {
  const out: OHLCV[] = [];
  let key = '';
  for (const b of bars) {
    const d = new Date(`${b.t}T00:00:00Z`);
    let k: string;
    if (by === 'M') k = String(b.t).slice(0, 7);
    else {
      const day = (d.getUTCDay() + 6) % 7;
      const monday = new Date(d.getTime() - day * 86_400_000);
      k = monday.toISOString().slice(0, 10);
    }
    const last = out[out.length - 1];
    if (k !== key || !last) {
      out.push({ ...b });
      key = k;
    } else {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
      last.t = b.t;
    }
  }
  return out;
}
