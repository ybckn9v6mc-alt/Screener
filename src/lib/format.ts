import type { Fmt } from '../../shared/columns';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const DASH = '–';

export function fmtNum(v: unknown, dp = 2): string {
  if (!isNum(v)) return DASH;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtPrice(v: unknown): string {
  if (!isNum(v)) return DASH;
  const dp = Math.abs(v) >= 1000 ? 2 : Math.abs(v) < 1 ? 4 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: dp });
}

export function fmtPct(v: unknown, dp = 2, signed = false): string {
  if (!isNum(v)) return DASH;
  const p = v * 100;
  const s = Math.abs(p) >= 1000 ? p.toFixed(0) : p.toFixed(dp);
  return `${signed && p > 0 ? '+' : ''}${s}%`;
}

/** Compact money / counts: 1.23T, 45.6B, 789M, 12.3K. */
export function fmtCompact(v: unknown, prefix = ''): string {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${prefix}${a.toFixed(a < 10 && a !== Math.round(a) ? 2 : 0)}`;
}

/** Short axis-tick form: $350B, $1.2T, 45M. Whole numbers where the value allows it. */
export function fmtAxis(v: unknown, prefix = ''): string {
  if (!isNum(v)) return '';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const short = (x: number, unit: string) => `${sign}${prefix}${x >= 100 || x === Math.round(x) ? x.toFixed(0) : x.toFixed(1)}${unit}`;
  if (a >= 1e12) return short(a / 1e12, 'T');
  if (a >= 1e9) return short(a / 1e9, 'B');
  if (a >= 1e6) return short(a / 1e6, 'M');
  if (a >= 1e3) return short(a / 1e3, 'K');
  return short(a, '');
}

export function fmtDate(v: unknown): string {
  if (typeof v !== 'string' || !v) return DASH;
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function recomLabel(v: unknown): string {
  if (!isNum(v)) return DASH;
  const name = v <= 1.5 ? 'Strong Buy' : v <= 2.5 ? 'Buy' : v <= 3.5 ? 'Hold' : v <= 4.5 ? 'Sell' : 'Strong Sell';
  return `${v.toFixed(2)} ${name}`;
}

const INDEX_NAMES: Record<string, string> = { sp500: 'S&P 500', ndx: 'NDX', djia: 'DJIA', r2000: 'RUT (est.)' };

export function fmtValue(v: unknown, fmt: Fmt): string {
  switch (fmt) {
    case 'text':
      return v == null || v === '' ? DASH : String(v);
    case 'list':
      return Array.isArray(v) && v.length ? v.map((x) => INDEX_NAMES[x] ?? x).join(', ') : DASH;
    case 'price':
      return fmtPrice(v);
    case 'pct':
      return fmtPct(v);
    case 'pct1':
      return fmtPct(v, 1);
    case 'signedPct':
      return fmtPct(v, 2, true);
    case 'x':
      return fmtNum(v, 2);
    case 'x1':
      return fmtNum(v, 1);
    case 'num':
      return fmtNum(v, 2);
    case 'int':
      return isNum(v) ? String(Math.round(v)) : DASH;
    case 'cap':
    case 'bigmoney':
    case 'vol':
      return fmtCompact(v);
    case 'date':
      return fmtDate(v);
    case 'recom':
      return isNum(v) ? v.toFixed(2) : DASH;
    case 'bool':
      return v === true ? 'Yes' : v === false ? 'No' : DASH;
    default:
      return String(v ?? DASH);
  }
}

export function signClass(v: unknown): string {
  if (!isNum(v) || v === 0) return '';
  return v > 0 ? 'up' : 'down';
}

/** "▲ +1.23%" — direction is never carried by colour alone. */
export function deltaText(pct: unknown, dp = 2): string {
  if (!isNum(pct)) return DASH;
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
  return `${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(dp)}%`;
}

export { isNum };
