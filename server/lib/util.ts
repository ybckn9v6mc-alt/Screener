/** Parse "$1,234.50", "3.07%", "1.2B", "--", "N/A" style strings into numbers. */
export function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || s === '--' || s === '-' || /^n\/?a$/i.test(s) || /^unch/i.test(s)) return null;
  let mult = 1;
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[$,%\s()+]/g, '');
  const suffix = s.slice(-1).toUpperCase();
  if ('KMBT'.includes(suffix) && s.length > 1 && /[\d.]/.test(s.slice(-2, -1))) {
    mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[suffix as 'K' | 'M' | 'B' | 'T'];
    s = s.slice(0, -1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return (neg ? -n : n) * mult;
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function round(v: number | null | undefined, dp = 4): number | null {
  if (!isNum(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function mean(a: number[]): number {
  return a.reduce((s, x) => s + x, 0) / a.length;
}

export function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

export function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Compound annual growth; null when either end is non-positive (not meaningful). */
export function cagr(first: number | null | undefined, last: number | null | undefined, years: number): number | null {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || years <= 0) return null;
  return (last / first) ** (1 / years) - 1;
}

/** Growth that stays meaningful when the base is negative (turnarounds). */
export function growth(prev: number | null | undefined, cur: number | null | undefined): number | null {
  if (!isNum(prev) || !isNum(cur) || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

export function div(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return a / b;
}

export const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** "11/09/2026" -> "2026-11-09" */
export function usDateToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
